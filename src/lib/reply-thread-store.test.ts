import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { KIND_NIP22_COMMENT, KIND_TEXT_NOTE } from '@hyprgate/utils';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn(),
    publish: vi.fn(),
  },
}));

import { relay } from '@napplet/sdk';
import { __test__, createReplyThreadStore } from './reply-thread-store.js';

const mockSubscribe = vi.mocked(relay.subscribe);
const mockPublish = vi.mocked(relay.publish);

const root = makeEvent({ id: 'root', kind: KIND_TEXT_NOTE, pubkey: 'root-author' });
const article = makeEvent({ id: 'article', kind: 30023, pubkey: 'article-author' });

describe('reply thread store', () => {
  beforeEach(() => {
    mockSubscribe.mockReset();
    mockPublish.mockReset();
  });

  it('subscribes to kind 1 replies and kind 1111 comments for the root', () => {
    mockSubscribe.mockReturnValue({ close: vi.fn() });
    const store = createReplyThreadStore();

    store.load(root);

    expect(mockSubscribe).toHaveBeenCalledWith(
      [
        { kinds: [KIND_TEXT_NOTE], '#e': [root.id], limit: 200 },
        { kinds: [KIND_NIP22_COMMENT], '#E': [root.id], limit: 200 },
        { kinds: [KIND_NIP22_COMMENT], '#e': [root.id], limit: 200 },
      ],
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('subscribes to parent and root context for opened kind 1 replies', () => {
    const opened = makeEvent({
      id: 'opened',
      kind: KIND_TEXT_NOTE,
      tags: [
        ['e', 'root-id', '', 'root'],
        ['e', 'parent-id', '', 'reply'],
      ],
    });

    expect(__test__.contextFilters(opened)).toEqual([
      { ids: ['parent-id', 'root-id'], limit: 2 },
    ]);
  });

  it('subscribes to address roots for opened NIP-22 comments', () => {
    const opened = makeEvent({
      id: 'opened-comment',
      kind: KIND_NIP22_COMMENT,
      tags: [
        ['A', '30023:article-author:post'],
        ['K', '30023'],
        ['P', 'article-author'],
        ['e', 'parent-comment'],
        ['k', String(KIND_NIP22_COMMENT)],
      ],
    });

    expect(__test__.contextFilters(opened)).toEqual([
      { ids: ['parent-comment'], limit: 1 },
      { kinds: [30023], authors: ['article-author'], '#d': ['post'], limit: 1 },
    ]);
  });

  it('builds visible upward context from root to immediate parent', () => {
    const opened = makeEvent({
      id: 'opened',
      kind: KIND_TEXT_NOTE,
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'parent', '', 'reply'],
      ],
    });
    const rootEvent = makeEvent({ id: 'root', created_at: 1 });
    const parent = makeEvent({
      id: 'parent',
      created_at: 2,
      tags: [
        ['e', 'root', '', 'root'],
        ['e', 'root', '', 'reply'],
      ],
    });

    expect(__test__.buildContext(opened, [parent, rootEvent], false).visibleAncestors.map((event) => event.id)).toEqual(['parent']);
    expect(__test__.buildContext(opened, [parent, rootEvent], true).visibleAncestors.map((event) => event.id)).toEqual(['root', 'parent']);
    expect(__test__.buildContext(opened, [parent, rootEvent], true).rootEvent?.id).toBe('root');
  });

  it('subscribes to address-tagged NIP-22 comments for addressable roots', () => {
    const articleRoot = makeEvent({
      id: 'article-id',
      kind: 30023,
      pubkey: 'article-author',
      tags: [['d', 'post']],
    });

    expect(__test__.threadFilters(articleRoot)).toContainEqual({
      kinds: [KIND_NIP22_COMMENT],
      '#A': ['30023:article-author:post'],
      limit: 200,
    });
    expect(__test__.threadFilters(articleRoot)).toContainEqual({
      kinds: [KIND_NIP22_COMMENT],
      '#a': ['30023:article-author:post'],
      limit: 200,
    });
  });

  it('builds kind 1 response templates for kind 1 roots', () => {
    const template = __test__.responseTemplate(root, root, 'hello');

    expect(template.kind).toBe(KIND_TEXT_NOTE);
    expect(template.content).toBe('hello');
    expect(template.tags).toContainEqual(['e', root.id, '', 'root']);
    expect(template.tags).toContainEqual(['p', root.pubkey]);
  });

  it('builds NIP-22 response templates for non-kind-1 roots', () => {
    const template = __test__.responseTemplate(article, article, 'comment');

    expect(template.kind).toBe(KIND_NIP22_COMMENT);
    expect(template.tags).toContainEqual(['E', article.id]);
    expect(template.tags).toContainEqual(['K', String(article.kind)]);
    expect(template.tags).toContainEqual(['P', article.pubkey]);
  });

  it('inserts published responses into the graph', async () => {
    mockSubscribe.mockReturnValue({ close: vi.fn() });
    const published = makeEvent({
      id: 'published',
      kind: KIND_TEXT_NOTE,
      pubkey: 'me',
      content: 'reply',
      tags: [['e', root.id, '', 'root'], ['p', root.pubkey]],
    });
    mockPublish.mockResolvedValueOnce(published);

    const store = createReplyThreadStore();
    store.load(root);
    store.openComposer(root.id);
    store.setDraft('reply');

    await store.publishResponse(root);

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(store.state.visible.map((item) => item.node.id)).toEqual(['published']);
    expect(store.state.activeComposerId).toBeNull();
  });
});

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
