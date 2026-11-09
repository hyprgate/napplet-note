<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies the
  // note-viewer's callback-based navigation (root note and thread replies).
  import { link } from '@napplet/sdk';
  import NoteContent from '@hyprgate/napplet-ui/NoteContent.svelte';
  import { tightenImageSpacing } from './lib/note-viewer-display.js';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel: (pubkey: string) => string;
    openProfile: (pubkey: string) => void;
    openNoteReference: (reference: string) => void;
  }

  let { content, emojiTags = [], profileLabel, openProfile, openNoteReference }: Props = $props();

  // NAP-LINK: route external links through the shell-owned opener so the new
  // browsing context does not inherit this napplet's origin.
  async function openLink(url: string): Promise<boolean> {
    const result = await link.open(url);
    return result.status === 'opened';
  }
</script>

<NoteContent
  content={tightenImageSpacing(content)}
  {emojiTags}
  {profileLabel}
  onProfileClick={openProfile}
  onReferenceClick={openNoteReference}
  onOpenLink={openLink}
/>
