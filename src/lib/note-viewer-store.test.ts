import { describe, expect, it, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@hyprgate/types';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn(),
  },
}));

import { relay } from '@napplet/sdk';
import {
  createNoteViewerStore,
  filtersForTarget,
  parseNoteViewerTarget,
} from './note-viewer-store.js';

const mockSubscribe = vi.mocked(relay.subscribe);

const event: NostrEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: 'hello',
  sig: 'c'.repeat(128),
};

describe('parseNoteViewerTarget', () => {
  it('parses raw event ids', () => {
    expect(parseNoteViewerTarget('A'.repeat(64))).toEqual({
      type: 'event',
      source: 'hex',
      id: 'a'.repeat(64),
      relays: [],
    });
  });

  it('parses note1 references', () => {
    const encoded = nip19.noteEncode('a'.repeat(64));
    expect(parseNoteViewerTarget(encoded)).toEqual({
      type: 'event',
      source: 'note',
      id: 'a'.repeat(64),
      relays: [],
    });
  });

  it('parses nevent references with relay hints', () => {
    const encoded = nip19.neventEncode({
      id: 'a'.repeat(64),
      author: 'b'.repeat(64),
      relays: ['wss://relay.example'],
    });
    expect(parseNoteViewerTarget(`nostr:${encoded}`)).toEqual({
      type: 'event',
      source: 'nevent',
      id: 'a'.repeat(64),
      author: 'b'.repeat(64),
      relays: ['wss://relay.example'],
    });
  });

  it('parses naddr references into address filters', () => {
    const encoded = nip19.naddrEncode({
      kind: 30023,
      pubkey: 'b'.repeat(64),
      identifier: 'article',
      relays: ['wss://relay.example'],
    });
    const target = parseNoteViewerTarget(encoded);
    expect(target).toEqual({
      type: 'address',
      source: 'naddr',
      kind: 30023,
      pubkey: 'b'.repeat(64),
      identifier: 'article',
      relays: ['wss://relay.example'],
    });
    expect(filtersForTarget(target)).toEqual([
      { kinds: [30023], authors: ['b'.repeat(64)], '#d': ['article'], limit: 1 },
    ]);
  });
});

describe('createNoteViewerStore', () => {
  beforeEach(() => {
    mockSubscribe.mockReset();
  });

  it('loads a target through relay.subscribe and closes after the event arrives', () => {
    const close = vi.fn();
    mockSubscribe.mockImplementationOnce((_filters, onEvent) => {
      onEvent(event);
      return { close };
    });

    const updates: unknown[] = [];
    const store = createNoteViewerStore(() => updates.push(null));
    store.load('a'.repeat(64));

    expect(mockSubscribe).toHaveBeenCalledWith(
      [{ ids: ['a'.repeat(64)], limit: 1 }],
      expect.any(Function),
      expect.any(Function),
    );
    expect(store.state.event).toEqual(event);
    expect(store.state.loading).toBe(false);
    expect(store.state.error).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(updates.length).toBeGreaterThan(0);
  });

  it('reports EOSE without a matching event', () => {
    const close = vi.fn();
    mockSubscribe.mockImplementationOnce((_filters, _onEvent, onEose) => {
      onEose?.();
      return { close };
    });

    const store = createNoteViewerStore();
    store.load('a'.repeat(64));

    expect(store.state.event).toBeNull();
    expect(store.state.loading).toBe(false);
    expect(store.state.error).toBe('No matching event was returned by the shell relay.');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
