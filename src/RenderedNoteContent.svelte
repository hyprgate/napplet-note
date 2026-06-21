<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies the
  // note-viewer's callback-based navigation (root note and thread replies).
  import NoteContent from '@hyprgate/napplet-ui/NoteContent.svelte';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel: (pubkey: string) => string;
    openProfile: (pubkey: string) => void;
    openNoteReference: (reference: string) => void;
  }

  let { content, emojiTags = [], profileLabel, openProfile, openNoteReference }: Props = $props();
</script>

<NoteContent
  {content}
  {emojiTags}
  {profileLabel}
  onProfileClick={openProfile}
  onReferenceClick={openNoteReference}
/>
