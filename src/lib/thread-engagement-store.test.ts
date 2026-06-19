import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { createThreadEngagementStore, normalizeReactionContent } from './thread-engagement-store';
import { relay } from '@napplet/sdk';

vi.mock('@napplet/sdk', () => ({
  relay: { subscribe: vi.fn().mockReturnValue({ close: vi.fn() }) },
}));

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return { id: 'e', kind: 1, pubkey: 'p'.repeat(64), created_at: 1, tags: [], content: '', sig: 's', ...overrides };
}

describe('thread engagement store', () => {
  let onEvent: ((event: NostrEvent) => void) | null = null;
  beforeEach(() => {
    vi.clearAllMocks();
    onEvent = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, cb) => {
      onEvent = cb as (event: NostrEvent) => void;
      return { close: vi.fn() };
    });
  });

  it('normalizes reaction content', () => {
    expect(normalizeReactionContent('')).toBe('+');
    expect(normalizeReactionContent('  ')).toBe('+');
    expect(normalizeReactionContent('-')).toBe('-');
    expect(normalizeReactionContent('🔥')).toBe('🔥');
  });

  it('counts reactions, replies and zaps per target node', () => {
    const store = createThreadEngagementStore();
    store.setTargets(['root', 'reply1']);

    onEvent!(makeEvent({ id: 'r1', kind: 7, content: '🔥', tags: [['e', 'root']] }));
    onEvent!(makeEvent({ id: 'r2', kind: 7, content: '🔥', tags: [['e', 'root']] }));
    onEvent!(makeEvent({ id: 'r3', kind: 7, content: '+', tags: [['e', 'reply1']] }));
    onEvent!(makeEvent({ id: 'c1', kind: 1, content: 'nice', tags: [['e', 'root']] }));

    const root = store.countsFor('root');
    expect(root.reactions).toBe(2);
    expect(root.comments).toBe(1);
    expect(root.reactionGroups).toEqual([{ content: '🔥', count: 2 }]);

    const reply = store.countsFor('reply1');
    expect(reply.reactions).toBe(1);
    expect(reply.reactionGroups[0]).toMatchObject({ content: '+', count: 1 });
  });

  it('dedupes the same reaction event and ignores untracked targets', () => {
    const store = createThreadEngagementStore();
    store.setTargets(['root']);
    const dup = makeEvent({ id: 'dup', kind: 7, content: '+', tags: [['e', 'root']] });
    onEvent!(dup);
    onEvent!(dup);
    onEvent!(makeEvent({ id: 'other', kind: 7, content: '+', tags: [['e', 'unrelated']] }));

    expect(store.countsFor('root').reactions).toBe(1);
    expect(store.countsFor('unrelated').reactions).toBe(0);
  });

  it('captures custom emoji image url from reaction tags', () => {
    const store = createThreadEngagementStore();
    store.setTargets(['root']);
    onEvent!(makeEvent({
      id: 'ce',
      kind: 7,
      content: ':blobcat:',
      tags: [['e', 'root'], ['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
    }));
    expect(store.countsFor('root').reactionGroups[0]).toEqual({
      content: ':blobcat:',
      count: 1,
      shortcode: 'blobcat',
      imageUrl: 'https://emoji.example/blobcat.png',
    });
  });
});
