import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  pluralLabel,
  profileAvatarFallback,
  profileAvatarUrl,
  profileDisplayName,
  quoteTotal,
  reactionPreview,
  reactionTotal,
  replyTotal,
  shortId,
  zapTotalMillisats,
} from './note-viewer-display.js';
import type { InteractionDetailState, ReactionGroup } from './interaction-detail-store.js';
import type { ThreadGraph } from './thread-graph.js';

function event(id: string): NostrEvent {
  return {
    id,
    pubkey: `pubkey-${id}`,
    kind: 1,
    content: '',
    tags: [],
    created_at: 1,
    sig: `sig-${id}`,
  };
}

describe('note-viewer-display', () => {
  it('shortens ids without hiding short values', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('0123456789abcdefghijklmnopqrstuvwxyz')).toBe('0123456789...stuvwxyz');
  });

  it('formats singular and plural labels', () => {
    expect(pluralLabel(1, 'reply', 'replies')).toBe('1 reply');
    expect(pluralLabel(2, 'reply', 'replies')).toBe('2 replies');
    expect(pluralLabel(0, 'reaction')).toBe('0 reactions');
  });

  it('resolves profile names and avatar fields before falling back to pubkeys', () => {
    expect(profileDisplayName('a'.repeat(64), { display_name: 'Display', name: 'name' })).toBe('Display');
    expect(profileDisplayName('b'.repeat(64), { displayName: 'Camel' })).toBe('Camel');
    expect(profileDisplayName('c'.repeat(64), { name: 'Name' })).toBe('Name');
    expect(profileDisplayName('0123456789abcdefghijklmnopqrstuvwxyz', null)).toBe('0123456789...stuvwxyz');
    expect(profileAvatarUrl({ picture: 'https://example.test/p.png', image: 'https://example.test/i.png' })).toBe('https://example.test/p.png');
    expect(profileAvatarUrl({ image: 'https://example.test/i.png' })).toBe('https://example.test/i.png');
    expect(profileAvatarFallback('abcdef', { display_name: 'Jay' })).toBe('JA');
  });

  it('summarizes reaction groups compactly', () => {
    const groups: ReactionGroup[] = [
      { content: '+', events: [event('a'), event('b')], actors: ['pubkey-a', 'pubkey-b'] },
      { content: 'zap', events: [event('c')], actors: ['pubkey-c'] },
      { content: 'like', events: [event('d')], actors: ['pubkey-d'] },
      { content: 'wow', events: [event('e')], actors: ['pubkey-e'] },
    ];

    expect(reactionTotal(groups)).toBe(5);
    expect(reactionPreview(groups)).toBe('+ 2  zap 1  like 1');
  });

  it('counts quote context and quote responses together', () => {
    const interactions: InteractionDetailState = {
      root: null,
      reactions: [],
      zaps: [],
      reposts: [],
      quoteEvents: [event('quote-a'), event('quote-b')],
      quotedEvents: [event('quoted-a')],
      loading: false,
      error: null,
    };

    expect(quoteTotal(interactions)).toBe(3);
  });

  it('sums zap millisats for summary labels', () => {
    expect(zapTotalMillisats([
      { amountMillisats: 21000 },
      { amountMillisats: 4000 },
    ])).toBe(25000);
  });

  it('prefers the full thread graph count over visible replies', () => {
    const graph = {
      nodes: new Map([['a', {}], ['b', {}], ['c', {}]]),
    } as unknown as ThreadGraph;

    expect(replyTotal(graph, 1)).toBe(3);
    expect(replyTotal(null, 2)).toBe(2);
  });
});
