import type { NostrEvent } from '@hyprgate/types';
import * as nip19 from 'nostr-tools/nip19';
import type { NoteViewerTarget } from './note-viewer-store.js';

/** Base URL of the public njump.to viewer used for shareable note links. */
const NJUMP_BASE_URL = 'https://njump.to';

function njumpUrl(value: string): string {
  return `${NJUMP_BASE_URL}/${value}`;
}

export interface NoteViewerShareReference {
  type: 'nevent' | 'naddr';
  value: string;
  url: string;
}

function uniqueRelays(relays: string[] | undefined): string[] {
  return [...new Set((relays ?? []).filter((relay) => relay.trim().length > 0))];
}

function firstDTag(event: NostrEvent): string | null {
  const tag = event.tags.find((candidate) => candidate[0] === 'd' && typeof candidate[1] === 'string');
  return tag?.[1] ?? null;
}

function isParameterizedReplaceable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

export function createNoteViewerShareReference(
  event: NostrEvent | null,
  target: NoteViewerTarget | null,
): NoteViewerShareReference | null {
  if (!event) return null;
  const relays = uniqueRelays(target?.relays);
  const identifier = firstDTag(event) ?? (target?.type === 'address' ? target.identifier : null);

  if (isParameterizedReplaceable(event.kind) && identifier !== null) {
    const value = nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
      relays,
    });
    return {
      type: 'naddr',
      value,
      url: njumpUrl(value),
    };
  }

  const value = nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
    kind: event.kind,
    relays,
  });
  return {
    type: 'nevent',
    value,
    url: njumpUrl(value),
  };
}
