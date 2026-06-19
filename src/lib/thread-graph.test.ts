import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { KIND_NIP22_COMMENT, KIND_TEXT_NOTE } from '@hyprgate/utils';
import { buildThreadGraph, visibleThreadNodes } from './thread-graph.js';

const root = makeEvent({ id: 'root', kind: KIND_TEXT_NOTE, pubkey: 'root-author' });

describe('thread graph', () => {
  it('dedupes events and builds nested kind 1 replies', () => {
    const first = makeKind1Reply('first', root.id, root.id, 10);
    const second = makeKind1Reply('second', root.id, first.id, 11);
    const graph = buildThreadGraph(root, [first, second, first]);

    expect(graph.nodes.size).toBe(2);
    expect(graph.rootChildren.map((node) => node.id)).toEqual(['first']);
    expect(graph.rootChildren[0]!.children.map((node) => node.id)).toEqual(['second']);
  });

  it('renders bounded depth until a branch is expanded', () => {
    const first = makeKind1Reply('first', root.id, root.id, 10);
    const second = makeKind1Reply('second', root.id, first.id, 11);
    const third = makeKind1Reply('third', root.id, second.id, 12);
    const graph = buildThreadGraph(root, [first, second, third]);

    expect(visibleThreadNodes(graph, new Set(), 2).map((item) => [item.node.id, item.expandable])).toEqual([
      ['first', false],
      ['second', true],
    ]);
    expect(visibleThreadNodes(graph, new Set(['second']), 2).map((item) => item.node.id)).toEqual(['first', 'second', 'third']);
  });

  it('places missing parents in the orphan bucket', () => {
    const orphan = makeKind1Reply('orphan', root.id, 'missing-parent', 10);
    const graph = buildThreadGraph(root, [orphan]);

    expect(graph.rootChildren).toHaveLength(0);
    expect(graph.orphans.map((node) => [node.id, node.orphaned])).toEqual([['orphan', true]]);
  });

  it('breaks cycles into orphan nodes', () => {
    const a = makeKind1Reply('a', root.id, 'b', 10);
    const b = makeKind1Reply('b', root.id, 'a', 11);
    const graph = buildThreadGraph(root, [a, b]);

    expect(graph.orphans.map((node) => [node.id, node.cycle])).toEqual([['a', true], ['b', true]]);
  });

  it('keeps NIP-22 descendants rooted at arbitrary note kinds', () => {
    const article = makeEvent({ id: 'article', kind: 30023, pubkey: 'author' });
    const comment = makeEvent({
      id: 'comment',
      kind: KIND_NIP22_COMMENT,
      tags: [['E', article.id], ['K', '30023'], ['P', article.pubkey]],
    });
    const graph = buildThreadGraph(article, [comment]);

    expect(graph.rootChildren.map((node) => node.id)).toEqual(['comment']);
  });

  it('keeps NIP-22 comments rooted by address tags', () => {
    const article = makeEvent({
      id: 'article',
      kind: 30023,
      pubkey: 'author',
      tags: [['d', 'post']],
    });
    const comment = makeEvent({
      id: 'comment',
      kind: KIND_NIP22_COMMENT,
      tags: [
        ['A', '30023:author:post'],
        ['K', '30023'],
        ['P', article.pubkey],
      ],
    });
    const child = makeEvent({
      id: 'child-comment',
      kind: KIND_NIP22_COMMENT,
      tags: [
        ['A', '30023:author:post'],
        ['K', '30023'],
        ['P', article.pubkey],
        ['e', comment.id],
        ['k', String(KIND_NIP22_COMMENT)],
        ['p', comment.pubkey],
      ],
    });

    const graph = buildThreadGraph(article, [comment, child]);

    expect(graph.rootChildren.map((node) => node.id)).toEqual(['comment']);
    expect(graph.rootChildren[0]!.children.map((node) => node.id)).toEqual(['child-comment']);
  });

  it('shows replies to an opened kind 1 reply even when their NIP-10 root is an older thread root', () => {
    const opened = makeKind1Reply('opened', 'original-root', 'original-root', 10);
    const child = makeKind1Reply('child', 'original-root', opened.id, 11);
    const grandchild = makeKind1Reply('grandchild', 'original-root', child.id, 12);
    const unrelated = makeKind1Reply('unrelated', 'original-root', 'missing-parent', 13);

    const graph = buildThreadGraph(opened, [child, grandchild, unrelated]);

    expect(graph.rootChildren.map((node) => node.id)).toEqual(['child']);
    expect(graph.rootChildren[0]!.children.map((node) => node.id)).toEqual(['grandchild']);
    expect(graph.nodes.has('unrelated')).toBe(false);
  });

  it('shows NIP-22 child comments when the opened event is the parent but not the original root', () => {
    const article = makeEvent({ id: 'article', kind: 30023, pubkey: 'author' });
    const opened = makeEvent({
      id: 'opened-comment',
      kind: KIND_NIP22_COMMENT,
      tags: [['E', article.id], ['K', '30023'], ['P', article.pubkey]],
    });
    const child = makeEvent({
      id: 'child-comment',
      kind: KIND_NIP22_COMMENT,
      tags: [
        ['E', article.id],
        ['K', '30023'],
        ['P', article.pubkey],
        ['e', opened.id],
        ['k', String(KIND_NIP22_COMMENT)],
        ['p', opened.pubkey],
      ],
    });

    const graph = buildThreadGraph(opened, [child]);

    expect(graph.rootChildren.map((node) => node.id)).toEqual(['child-comment']);
  });

  it('handles large synthetic graphs without expanding every node by default', () => {
    const events = Array.from({ length: 500 }, (_, index) => {
      const id = `node-${index}`;
      const parentId = index === 0 ? root.id : `node-${index - 1}`;
      return makeKind1Reply(id, root.id, parentId, 10 + index);
    });
    const graph = buildThreadGraph(root, events);
    const visible = visibleThreadNodes(graph, new Set(), 2);

    expect(graph.nodes.size).toBe(500);
    expect(visible.map((item) => item.node.id)).toEqual(['node-0', 'node-1']);
    expect(visible[1]!.expandable).toBe(true);
    expect(visible[1]!.hiddenChildCount).toBe(1);
  });
});

function makeKind1Reply(id: string, rootId: string, parentId: string, createdAt: number): NostrEvent {
  return makeEvent({
    id,
    kind: KIND_TEXT_NOTE,
    created_at: createdAt,
    tags: [
      ['e', rootId, '', 'root'],
      ...(parentId === rootId ? [] : [['e', parentId, '', 'reply']]),
    ],
  });
}

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event',
    pubkey: 'pubkey',
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}
