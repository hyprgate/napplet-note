import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import type { NostrEvent } from '@hyprgate/types';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn(),
  },
}));

import { relay, type RelayEventResult } from '@napplet/sdk';
import { createNoteViewerShareReference } from './note-links.js';
import {
  createNoteViewerStore,
  filtersForTarget,
  NOTE_VIEWER_NO_RESULT_GRACE_MS,
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
      onEvent({ event });
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
    expect(nip19.decode(createNoteViewerShareReference(store.state.event, store.state.target)!.value)).toEqual({
      type: 'nevent',
      data: { id: event.id, author: event.pubkey, kind: event.kind, relays: [] },
    });
  });

  it.each([
    ['raw event id', event.id],
    ['note1', nip19.noteEncode(event.id)],
  ])('exposes runtime provenance in the first share notification for a %s', (_label, input) => {
    let emitEvent: (result: RelayEventResult) => void = () => {};
    const close = vi.fn();
    mockSubscribe.mockImplementationOnce((_filters, onEvent) => {
      emitEvent = onEvent;
      return { close };
    });
    const sharedValues: string[] = [];
    const store = createNoteViewerStore(() => {
      const reference = createNoteViewerShareReference(store.state.event, store.state.target);
      if (reference) sharedValues.push(reference.value);
    });
    const rawEvent = Object.freeze({ ...event });
    const originalEvent = JSON.stringify(rawEvent);
    const relayHints = [' wss://observed.example ', '', 'wss://observed.example', '  ', 'wss://second.example'];
    Object.freeze(relayHints);
    store.load(input);
    emitEvent({ event: rawEvent, sidecar: { relayHints } });

    expect(sharedValues).toHaveLength(1);
    expect(nip19.decode(sharedValues[0]!)).toEqual({
      type: 'nevent',
      data: {
        id: event.id,
        author: event.pubkey,
        kind: event.kind,
        relays: ['wss://observed.example', 'wss://second.example'],
      },
    });
    expect(store.state.event).toBe(rawEvent);
    expect(JSON.stringify(rawEvent)).toBe(originalEvent);
    expect(relayHints[0]).toBe(' wss://observed.example ');
    expect(close).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it('merges input hints before runtime hints with stable trimming and deduplication', () => {
    mockSubscribe.mockImplementationOnce((_filters, onEvent) => {
      onEvent({ event, sidecar: { relayHints: ['wss://second.example', ' wss://input.example ', 'wss://third.example', ''] } });
      return { close: vi.fn() };
    });
    const store = createNoteViewerStore();
    store.load(nip19.neventEncode({
      id: event.id,
      relays: [' wss://input.example ', ' ', 'wss://second.example', 'wss://input.example'],
    }));

    expect(store.state.target?.relays).toEqual(['wss://input.example', 'wss://second.example', 'wss://third.example']);
    store.destroy();
  });

  it('preserves normalized input hints when no sidecar is returned', () => {
    mockSubscribe.mockImplementationOnce((_filters, onEvent) => {
      onEvent({ event });
      return { close: vi.fn() };
    });
    const store = createNoteViewerStore();
    store.load(nip19.neventEncode({ id: event.id, relays: [' wss://input.example ', '', 'wss://input.example'] }));

    expect(store.state.target?.relays).toEqual(['wss://input.example']);
    expect(nip19.decode(createNoteViewerShareReference(store.state.event, store.state.target)!.value)).toMatchObject({
      type: 'nevent',
      data: { relays: ['wss://input.example'] },
    });
    store.destroy();
  });

  it('preserves merged runtime provenance for naddr and its njump URL', () => {
    const article = { ...event, kind: 30023, tags: [['d', 'article']] };
    mockSubscribe.mockImplementationOnce((_filters, onEvent) => {
      onEvent({ event: article, sidecar: { relayHints: [' wss://observed.example '] } });
      return { close: vi.fn() };
    });
    const store = createNoteViewerStore();
    store.load(nip19.naddrEncode({
      kind: article.kind, pubkey: article.pubkey, identifier: 'article', relays: ['wss://input.example'],
    }));

    const share = createNoteViewerShareReference(store.state.event, store.state.target)!;
    expect(nip19.decode(share.value)).toEqual({
      type: 'naddr',
      data: {
        kind: article.kind,
        pubkey: article.pubkey,
        identifier: 'article',
        relays: ['wss://input.example', 'wss://observed.example'],
      },
    });
    expect(share.url).toBe(`https://njump.to/${share.value}`);
    store.destroy();
  });

  it('reports EOSE without a matching event only after the grace window', () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn();
      let emitEvent: ((result: { event: NostrEvent }) => void) | undefined;
      let emitEose: (() => void) | undefined;
      mockSubscribe.mockImplementationOnce((_filters, onEvent, onEose) => {
        emitEvent = onEvent;
        emitEose = onEose;
        emitEose?.();
        return { close };
      });

      const store = createNoteViewerStore();
      store.load('a'.repeat(64));

      expect(store.state.event).toBeNull();
      expect(store.state.loading).toBe(true);
      expect(store.state.error).toBeNull();
      expect(close).not.toHaveBeenCalled();

      vi.advanceTimersByTime(NOTE_VIEWER_NO_RESULT_GRACE_MS - 1);
      expect(store.state.loading).toBe(true);
      expect(store.state.error).toBeNull();

      vi.advanceTimersByTime(1);
      expect(store.state.loading).toBe(false);
      expect(store.state.error).toBe('No matching event was returned by the shell relay.');
      expect(close).toHaveBeenCalledTimes(1);

      emitEvent?.({ event });
      emitEose?.();
      vi.advanceTimersByTime(NOTE_VIEWER_NO_RESULT_GRACE_MS);
      expect(store.state.event).toBeNull();
      expect(store.state.error).toBe('No matching event was returned by the shell relay.');
      expect(close).toHaveBeenCalledTimes(1);

      store.destroy();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a matching cache event emitted after relay EOSE', () => {
    vi.useFakeTimers();
    try {
      let emitEose: (() => void) | undefined;
      let emitDelayedEvent: (() => void) | undefined;
      let closed = false;
      const close = vi.fn(() => {
        closed = true;
      });
      mockSubscribe.mockImplementationOnce((_filters, onEvent, onEose) => {
        emitEose = onEose;
        emitDelayedEvent = () => {
          if (!closed) {
            onEvent({ event });
          }
        };
        return { close };
      });

      const store = createNoteViewerStore();
      store.load('a'.repeat(64));
      emitEose?.();

      expect(store.state.event).toBeNull();
      expect(store.state.loading).toBe(true);
      expect(store.state.error).toBeNull();

      vi.advanceTimersByTime(1_000);
      expect(store.state.loading).toBe(true);
      expect(store.state.error).toBeNull();

      emitDelayedEvent?.();
      vi.advanceTimersByTime(NOTE_VIEWER_NO_RESULT_GRACE_MS);

      expect(store.state.event).toEqual(event);
      expect(store.state.loading).toBe(false);
      expect(store.state.error).toBeNull();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending no-result timer on target replacement and destroy', () => {
    vi.useFakeTimers();
    try {
      const eoseCallbacks: Array<(() => void) | undefined> = [];
      const closes: Array<ReturnType<typeof vi.fn>> = [];
      mockSubscribe.mockImplementation((_filters, _onEvent, onEose) => {
        eoseCallbacks.push(onEose);
        const close = vi.fn();
        closes.push(close);
        return { close };
      });

      const store = createNoteViewerStore();
      store.load('a'.repeat(64));
      eoseCallbacks[0]?.();
      store.load('b'.repeat(64));
      vi.advanceTimersByTime(NOTE_VIEWER_NO_RESULT_GRACE_MS);

      expect(store.state.target).toMatchObject({ id: 'b'.repeat(64) });
      expect(store.state.loading).toBe(true);
      expect(store.state.error).toBeNull();
      expect(closes[0]).toHaveBeenCalledTimes(1);

      eoseCallbacks[1]?.();
      store.destroy();
      vi.advanceTimersByTime(NOTE_VIEWER_NO_RESULT_GRACE_MS);

      expect(store.state.loading).toBe(true);
      expect(store.state.error).toBeNull();
      expect(closes[1]).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores stale events after subscription replacement and destroy', () => {
    const eventCallbacks: Array<(result: RelayEventResult) => void> = [];
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    mockSubscribe.mockImplementation((_filters, onEvent) => {
      eventCallbacks.push(onEvent);
      const close = vi.fn();
      closes.push(close);
      return { close };
    });

    const store = createNoteViewerStore();
    store.load('a'.repeat(64));
    store.load('b'.repeat(64));
    eventCallbacks[0]!({ event, sidecar: { relayHints: ['wss://stale.example'] } });

    expect(store.state.target).toMatchObject({ id: 'b'.repeat(64) });
    expect(store.state.target?.relays).toEqual([]);
    expect(store.state.event).toBeNull();
    expect(store.state.loading).toBe(true);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();

    store.destroy();
    eventCallbacks[1]!({ event, sidecar: { relayHints: ['wss://destroyed.example'] } });

    expect(store.state.event).toBeNull();
    expect(store.state.target?.relays).toEqual([]);
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  it('ignores additional event provenance after the target has settled', () => {
    let emitEvent: (result: RelayEventResult) => void = () => {};
    mockSubscribe.mockImplementationOnce((_filters, onEvent) => {
      emitEvent = onEvent;
      return { close: vi.fn() };
    });
    const updates = vi.fn();
    const store = createNoteViewerStore(updates);
    store.load(event.id);
    emitEvent({ event, sidecar: { relayHints: ['wss://observed.example'] } });
    const updateCount = updates.mock.calls.length;
    emitEvent({ event, sidecar: { relayHints: ['wss://ignored.example'] } });

    expect(store.state.target?.relays).toEqual(['wss://observed.example']);
    expect(updates).toHaveBeenCalledTimes(updateCount);
    store.destroy();
  });
});
