import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  KIND_GENERIC_REPOST,
  KIND_REACTION,
  KIND_REPOST,
  KIND_TEXT_NOTE,
  KIND_ZAP_RECEIPT,
  KIND_ZAP_REQUEST,
} from '@hyprgate/utils';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn(),
  },
}));

import { relay } from '@napplet/sdk';
import { __test__, createInteractionDetailStore } from './interaction-detail-store.js';

const mockSubscribe = vi.mocked(relay.subscribe);

describe('interaction detail store', () => {
  beforeEach(() => {
    mockSubscribe.mockReset();
  });

  it('uses kind 6 repost filters for kind 1 roots', () => {
    const root = makeEvent({ id: 'root', kind: KIND_TEXT_NOTE });
    expect(__test__.interactionFilters(root)).toContainEqual({ kinds: [KIND_REPOST], '#e': [root.id], limit: 200 });
  });

  it('subscribes to zap receipts for event and address targets', () => {
    const root = makeEvent({ id: 'root', kind: 30023, pubkey: 'author', tags: [['d', 'article']] });
    expect(__test__.interactionFilters(root)).toContainEqual({ kinds: [KIND_ZAP_RECEIPT], '#e': [root.id], limit: 200 });
    expect(__test__.interactionFilters(root)).toContainEqual({ kinds: [KIND_ZAP_RECEIPT], '#a': ['30023:author:article'], limit: 200 });
  });

  it('uses kind 16 generic repost filters for non-kind-1 roots', () => {
    const root = makeEvent({ id: 'root', kind: 30023 });
    expect(__test__.interactionFilters(root)).toContainEqual({ kinds: [KIND_GENERIC_REPOST], '#e': [root.id], limit: 200 });
  });

  it('adds a quoted-context ids filter from root q tags', () => {
    const root = makeEvent({ id: 'root', tags: [['q', 'quoted'], ['q', 'quoted']] });
    expect(__test__.interactionFilters(root)).toContainEqual({ ids: ['quoted'], limit: 1 });
  });

  it('groups reactions by content and dedupes actors', () => {
    const reactions = __test__.groupReactions([
      makeEvent({ id: 'a', kind: KIND_REACTION, content: '+', pubkey: 'alice' }),
      makeEvent({ id: 'b', kind: KIND_REACTION, content: '+', pubkey: 'alice' }),
      makeEvent({ id: 'c', kind: KIND_REACTION, content: '-', pubkey: 'bob' }),
    ]);

    expect(reactions.map((group) => [group.content, group.events.length, group.actors])).toEqual([
      ['+', 2, ['alice']],
      ['-', 1, ['bob']],
    ]);
  });

  it('keeps custom emoji metadata on reaction groups', () => {
    const reactions = __test__.groupReactions([
      makeEvent({
        id: 'emoji',
        kind: KIND_REACTION,
        content: ':blobcat:',
        pubkey: 'alice',
        tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
      }),
    ]);

    expect(reactions[0]).toMatchObject({
      content: ':blobcat:',
      shortcode: 'blobcat',
      imageUrl: 'https://emoji.example/blobcat.png',
    });
  });

  it('keeps reactions, zaps, reposts, quote events, and quoted context separate', () => {
    const root = makeEvent({ id: 'root', kind: KIND_TEXT_NOTE, tags: [['q', 'quoted']] });
    mockSubscribe.mockImplementationOnce((_filters, onEvent, onEose) => {
      onEvent({ event: makeEvent({ id: 'reaction', kind: KIND_REACTION, content: '+', tags: [['e', root.id]] }) });
      onEvent({ event: makeEvent({ id: 'reaction', kind: KIND_REACTION, content: '+', tags: [['e', root.id]] }) });
      onEvent({ event: makeZapReceipt({ id: 'zap-a', targetId: root.id, amountMillisats: 21000, senderPubkey: 'zapper-a' }) });
      onEvent({ event: makeZapReceipt({ id: 'zap-a', targetId: root.id, amountMillisats: 21000, senderPubkey: 'zapper-a' }) });
      onEvent({ event: makeZapReceipt({ id: 'zap-b', targetId: root.id, amountMillisats: 4000, senderPubkey: 'zapper-b' }) });
      onEvent({ event: makeEvent({ id: 'repost', kind: KIND_REPOST, tags: [['e', root.id]] }) });
      onEvent({ event: makeEvent({ id: 'quote-event', kind: KIND_TEXT_NOTE, tags: [['q', root.id]] }) });
      onEvent({ event: makeEvent({ id: 'quoted', kind: KIND_TEXT_NOTE, content: 'quoted note' }) });
      onEose?.();
      return { close: vi.fn() };
    });

    const store = createInteractionDetailStore();
    store.load(root);

    expect(store.state.reactions).toHaveLength(1);
    expect(store.state.reactions[0]!.events).toHaveLength(1);
    expect(store.state.zaps.map((zap) => [zap.id, zap.amountMillisats, zap.senderPubkey])).toEqual([
      ['zap-a', 21000, 'zapper-a'],
      ['zap-b', 4000, 'zapper-b'],
    ]);
    expect(store.state.reposts.map((event) => event.id)).toEqual(['repost']);
    expect(store.state.quoteEvents.map((event) => event.id)).toEqual(['quote-event']);
    expect(store.state.quotedEvents.map((event) => event.id)).toEqual(['quoted']);
    expect(store.state.loading).toBe(false);
  });
});

function makeZapReceipt(input: {
  id: string;
  targetId: string;
  amountMillisats: number;
  senderPubkey: string;
}): NostrEvent {
  const request = makeEvent({
    id: `${input.id}-request`,
    kind: KIND_ZAP_REQUEST,
    pubkey: input.senderPubkey,
    tags: [
      ['amount', String(input.amountMillisats)],
      ['e', input.targetId],
      ['p', 'recipient'],
    ],
    content: `zap from ${input.senderPubkey}`,
  });

  return makeEvent({
    id: input.id,
    kind: KIND_ZAP_RECEIPT,
    pubkey: 'provider',
    tags: [
      ['description', JSON.stringify(request)],
      ['e', input.targetId],
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
