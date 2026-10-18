import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import * as nip19 from 'nostr-tools/nip19';
import { createNoteViewerShareReference } from './note-links.js';
import type { NoteViewerTarget } from './note-viewer-store.js';

const EVENT: NostrEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: 'hello',
  sig: 'c'.repeat(128),
};

describe('createNoteViewerShareReference', () => {
  it('creates nevent references for regular events', () => {
    const target: NoteViewerTarget = {
      type: 'event',
      source: 'hex',
      id: EVENT.id,
      relays: [' wss://relay.example ', '', 'wss://relay.example', '  ', 'wss://second.example'],
    };

    const reference = createNoteViewerShareReference(EVENT, target)!;
    const decoded = nip19.decode(reference.value);

    expect(reference.type).toBe('nevent');
    expect(reference.url).toBe(`https://njump.to/${reference.value}`);
    expect(decoded.type).toBe('nevent');
    expect(decoded.data).toMatchObject({
      id: EVENT.id,
      author: EVENT.pubkey,
      kind: EVENT.kind,
      relays: ['wss://relay.example', 'wss://second.example'],
    });
  });

  it('creates naddr references for parameterized replaceable events', () => {
    const event: NostrEvent = {
      ...EVENT,
      kind: 30023,
      tags: [['d', 'article']],
    };
    const target: NoteViewerTarget = {
      type: 'address',
      source: 'naddr',
      kind: 30023,
      pubkey: EVENT.pubkey,
      identifier: 'article',
      relays: ['wss://relay.example'],
    };

    const reference = createNoteViewerShareReference(event, target)!;
    const decoded = nip19.decode(reference.value);

    expect(reference.type).toBe('naddr');
    expect(reference.url).toBe(`https://njump.to/${reference.value}`);
    expect(decoded.type).toBe('naddr');
    expect(decoded.data).toMatchObject({
      kind: 30023,
      pubkey: EVENT.pubkey,
      identifier: 'article',
      relays: ['wss://relay.example'],
    });
  });

  it('falls back to nevent when an addressable kind has no identifier', () => {
    const reference = createNoteViewerShareReference({ ...EVENT, kind: 30023 }, null)!;

    expect(reference.type).toBe('nevent');
    expect(nip19.decode(reference.value).type).toBe('nevent');
  });
});
