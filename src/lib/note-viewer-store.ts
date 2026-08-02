import type { NostrEvent, NostrFilter } from '@hyprgate/types';
import { relay, type Subscription } from "@napplet/sdk";
import * as nip19 from 'nostr-tools/nip19';

export type NoteViewerTarget =
  | {
      type: 'event';
      source: 'hex' | 'note' | 'nevent';
      id: string;
      relays: string[];
      author?: string;
    }
  | {
      type: 'address';
      source: 'naddr';
      kind: number;
      pubkey: string;
      identifier: string;
      relays: string[];
    };

export interface NoteViewerState {
  target: NoteViewerTarget | null;
  event: NostrEvent | null;
  loading: boolean;
  error: string | null;
}

export interface NoteViewerStore {
  state: NoteViewerState;
  load(rawTarget: string): void;
  destroy(): void;
}

const HEX_EVENT_ID = /^[0-9a-f]{64}$/i;

function normalizeTargetInput(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('nostr:') ? trimmed.slice('nostr:'.length) : trimmed;
}

function asRelays(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((relayUrl): relayUrl is string => typeof relayUrl === 'string') : [];
}

export function parseNoteViewerTarget(raw: string): NoteViewerTarget {
  const value = normalizeTargetInput(raw);
  if (HEX_EVENT_ID.test(value)) {
    return { type: 'event', source: 'hex', id: value.toLowerCase(), relays: [] };
  }

  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(value);
  } catch {
    throw new Error('Enter a 64-char event id, note1, nevent1, or naddr1 reference.');
  }

  if (decoded.type === 'note') {
    return { type: 'event', source: 'note', id: decoded.data, relays: [] };
  }

  if (decoded.type === 'nevent') {
    const data = decoded.data;
    return {
      type: 'event',
      source: 'nevent',
      id: data.id,
      relays: asRelays(data.relays),
      author: data.author,
    };
  }

  if (decoded.type === 'naddr') {
    const data = decoded.data;
    return {
      type: 'address',
      source: 'naddr',
      kind: data.kind,
      pubkey: data.pubkey,
      identifier: data.identifier,
      relays: asRelays(data.relays),
    };
  }

  throw new Error(`Unsupported NIP-19 reference: ${decoded.type}.`);
}

export function filtersForTarget(target: NoteViewerTarget): NostrFilter[] {
  if (target.type === 'event') {
    return [{ ids: [target.id], limit: 1 }];
  }

  return [
    {
      kinds: [target.kind],
      authors: [target.pubkey],
      '#d': [target.identifier],
      limit: 1,
    },
  ];
}

export function describeTarget(target: NoteViewerTarget): string {
  if (target.type === 'event') return `${target.source}:${target.id}`;
  return `${target.source}:${target.kind}:${target.pubkey}:${target.identifier}`;
}

export function createNoteViewerStore(onUpdate?: () => void): NoteViewerStore {
  const state: NoteViewerState = {
    target: null,
    event: null,
    loading: false,
    error: null,
  };

  let activeSub: Subscription | null = null;

  function notify(): void {
    onUpdate?.();
  }

  function closeActiveSub(): void {
    activeSub?.close();
    activeSub = null;
  }

  function load(rawTarget: string): void {
    closeActiveSub();

    let target: NoteViewerTarget;
    try {
      target = parseNoteViewerTarget(rawTarget);
    } catch (error) {
      state.target = null;
      state.event = null;
      state.loading = false;
      state.error = error instanceof Error ? error.message : 'Invalid target reference.';
      notify();
      return;
    }

    state.target = target;
    state.event = null;
    state.loading = true;
    state.error = null;
    notify();

    let closeAfterSubscribeReturns = false;
    activeSub = relay.subscribe(
      filtersForTarget(target),
      (result) => {
        const event = result.event as NostrEvent;
        state.event = event;
        state.loading = false;
        state.error = null;
        if (activeSub) {
          closeActiveSub();
        } else {
          closeAfterSubscribeReturns = true;
        }
        notify();
      },
      () => {
        if (!state.event) {
          state.loading = false;
          state.error = 'No matching event was returned by the shell relay.';
          notify();
        }
        if (activeSub) {
          closeActiveSub();
        } else {
          closeAfterSubscribeReturns = true;
        }
      },
    );

    if (closeAfterSubscribeReturns) {
      closeActiveSub();
    }
  }

  function destroy(): void {
    closeActiveSub();
  }

  return { state, load, destroy };
}
