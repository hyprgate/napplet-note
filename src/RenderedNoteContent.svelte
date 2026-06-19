<script lang="ts">
  // Thin adapter over the shared @hyprgate/ui note renderer — supplies the
  // note-viewer's callback-based navigation (root note and thread replies).
  import NoteContent from '@hyprgate/ui/NoteContent.svelte';

  interface Props {
    content: string;
    profileLabel: (pubkey: string) => string;
    openProfile: (pubkey: string) => void;
    openNoteReference: (reference: string) => void;
  }

  let { content, profileLabel, openProfile, openNoteReference }: Props = $props();
</script>

<NoteContent
  {content}
  {profileLabel}
  onProfileClick={openProfile}
  onReferenceClick={openNoteReference}
/>
