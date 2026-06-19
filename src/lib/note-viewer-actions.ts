import type { NostrEvent } from '@hyprgate/types';
import { relay } from '@napplet/sdk';

export const NOTE_VIEWER_REACTION_CLIENT_TAG = ['client', '@hyprgate/note-viewer/reaction'] as const;

export interface NoteViewerReactionInput {
  content: string;
  tags?: string[][];
}

export function createNoteViewerReactionTemplate(
  event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>,
  reaction: string | NoteViewerReactionInput,
): {
  kind: 7;
  content: string;
  tags: string[][];
  created_at: number;
} {
  const content = typeof reaction === 'string' ? reaction : reaction.content;
  const customTags = typeof reaction === 'string' ? [] : reaction.tags ?? [];
  return {
    kind: 7,
    content,
    tags: [
      ['e', event.id],
      ['p', event.pubkey],
      ['k', String(event.kind)],
      ...customTags,
      [...NOTE_VIEWER_REACTION_CLIENT_TAG],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
}

export async function publishNoteViewerReaction(
  event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>,
  reaction: string | NoteViewerReactionInput,
): Promise<object> {
  return relay.publish(createNoteViewerReactionTemplate(event, reaction));
}
