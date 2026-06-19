import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';

vi.mock('@napplet/sdk', () => ({
  relay: {
    publish: vi.fn(),
  },
}));

import { relay } from '@napplet/sdk';
import {
  NOTE_VIEWER_REACTION_CLIENT_TAG,
  createNoteViewerReactionTemplate,
  publishNoteViewerReaction,
} from './note-viewer-actions.js';

const mockPublish = vi.mocked(relay.publish);

describe('note-viewer actions', () => {
  beforeEach(() => {
    mockPublish.mockReset();
  });

  it('builds reaction templates for the loaded note', () => {
    const template = createNoteViewerReactionTemplate(event(), '😂');

    expect(template.kind).toBe(7);
    expect(template.content).toBe('😂');
    expect(template.tags).toContainEqual(['e', 'note-id']);
    expect(template.tags).toContainEqual(['p', 'author']);
    expect(template.tags).toContainEqual(['k', '1']);
    expect(template.tags).toContainEqual([...NOTE_VIEWER_REACTION_CLIENT_TAG]);
  });

  it('preserves custom emoji tags when publishing an existing reaction', async () => {
    mockPublish.mockResolvedValueOnce({
      id: 'published',
      pubkey: 'me',
      created_at: 1,
      kind: 7,
      tags: [],
      content: ':blobcat:',
      sig: 'sig',
    });

    await publishNoteViewerReaction(event(), {
      content: ':blobcat:',
      tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
    });

    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      kind: 7,
      content: ':blobcat:',
      tags: [
        ['e', 'note-id'],
        ['p', 'author'],
        ['k', '1'],
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png'],
        [...NOTE_VIEWER_REACTION_CLIENT_TAG],
      ],
    }));
  });
});

function event(): Pick<NostrEvent, 'id' | 'kind' | 'pubkey'> {
  return {
    id: 'note-id',
    kind: 1,
    pubkey: 'author',
  };
}
