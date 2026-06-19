<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import { formatMillisatsAsSats, resourceImage } from '@hyprgate/utils';
  import {
    customReactionInput,
    reactionInputFromEmojiOption,
    type EmojiOption,
  } from '../lib/emoji-sets';
  import { publishNoteViewerReaction } from '../lib/note-viewer-actions.js';
  import type { EngagementCounts, ReactionGroup } from '../lib/thread-engagement-store.js';
  import EmojiSelector from './EmojiSelector.svelte';

  interface Props {
    event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>;
    counts: EngagementCounts;
    reactionOptions: EmojiOption[];
    /** Replies collapse the reaction breakdown to a count until `expanded`. */
    collapsible?: boolean;
    expanded?: boolean;
  }

  let { event, counts, reactionOptions, collapsible = false, expanded = false }: Props = $props();

  let menuOpen = $state(false);
  let customReaction = $state('');
  let sending = $state(false);
  let error = $state<string | null>(null);

  const groups = $derived(sortReactionGroups(counts.reactionGroups));
  const totalReactions = $derived(counts.reactions);
  const zapSatsLabel = $derived(formatMillisatsAsSats(counts.zapMillisats));

  function sortReactionGroups(list: ReactionGroup[]): ReactionGroup[] {
    return [...list].sort((a, b) => {
      if (a.content === '+' && b.content !== '+') return -1;
      if (b.content === '+' && a.content !== '+') return 1;
      return b.count - a.count || a.content.localeCompare(b.content);
    });
  }

  async function react(input: { content: string; tags?: string[][] }): Promise<void> {
    if (!input.content || sending) return;
    sending = true;
    menuOpen = false;
    error = null;
    try {
      await publishNoteViewerReaction(event, { content: input.content, tags: input.tags });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Reaction failed';
    } finally {
      sending = false;
    }
  }

  function reactGroup(group: ReactionGroup): void {
    const tags = group.shortcode && group.imageUrl ? [['emoji', group.shortcode, group.imageUrl]] : [];
    void react({ content: group.content, tags });
  }

  async function reactCustom(): Promise<void> {
    const input = customReactionInput(customReaction, reactionOptions);
    customReaction = '';
    await react(input);
  }
</script>

<div class="node-engagement" class:muted={collapsible && !expanded}>
  <div class="pills">
    {#if collapsible}
      <div class="reactions collapsible" class:expanded={expanded && groups.length > 0}>
        <span class="pill reaction count-chip" title="{totalReactions} reactions">
          <span class="mark">♥</span><span>{totalReactions}</span>
        </span>
        <div class="breakdown">
          {#each groups as group (group.content)}
            <button type="button" class="pill reaction" disabled={sending} title="React with {group.content}" onclick={() => reactGroup(group)}>
              {#if group.imageUrl}
                <img use:resourceImage={group.imageUrl} alt={group.shortcode ?? group.content} loading="lazy" />
              {:else}
                <span class="mark">{group.content}</span>
              {/if}
              <span>{group.count}</span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="reactions">
        {#if groups.length > 0}
          {#each groups as group (group.content)}
            <button type="button" class="pill reaction" disabled={sending} title="React with {group.content}" onclick={() => reactGroup(group)}>
              {#if group.imageUrl}
                <img use:resourceImage={group.imageUrl} alt={group.shortcode ?? group.content} loading="lazy" />
              {:else}
                <span class="mark">{group.content}</span>
              {/if}
              <span>{group.count}</span>
            </button>
          {/each}
        {:else}
          <span class="pill reaction"><span class="mark">♥</span><span>{totalReactions}</span></span>
        {/if}
      </div>
    {/if}

    <span class="pill reply" title="{counts.comments} replies"><span class="mark">r</span><span>{counts.comments}</span></span>
    <span class="pill zap" title="{counts.zaps} zaps"><span class="mark">z</span><span>{counts.zaps > 0 ? zapSatsLabel : 0}</span></span>

    <div class="react-picker">
      <button type="button" class="react-button" disabled={sending} aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
        {sending ? '…' : '+ React'}
      </button>
      {#if menuOpen}
        <div class="react-menu" role="menu" aria-label="Select reaction">
          {#if reactionOptions.length > 0}
            <div class="react-grid">
              {#each reactionOptions as option (option.content)}
                <button type="button" role="menuitem" title={option.label} onclick={() => void react(reactionInputFromEmojiOption(option))}>
                  {#if option.imageUrl}
                    <img use:resourceImage={option.imageUrl} alt={option.label} loading="lazy" />
                  {:else}
                    {option.content}
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
          <div class="library-row">
            <EmojiSelector buttonLabel="All emoji" title="Search all Unicode emoji" onselect={(emoji) => void react({ content: emoji })} />
          </div>
          <form class="custom-reaction" onsubmit={(submitEvent) => { submitEvent.preventDefault(); void reactCustom(); }}>
            <input bind:value={customReaction} placeholder="emoji or :code:" aria-label="Custom reaction" maxlength="32" />
            <button type="submit" disabled={!customReaction.trim()}>Send</button>
          </form>
        </div>
      {/if}
    </div>
  </div>
  {#if error}<span class="error">{error}</span>{/if}
</div>

<style>
  .node-engagement {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    transition: opacity 0.15s ease;
  }

  /* Reply engagement is muted until the reply is hovered. */
  .node-engagement.muted {
    opacity: 0.5;
  }

  .node-engagement.muted .pill,
  .node-engagement.muted .react-button {
    background: transparent;
    border-color: transparent;
  }

  .pills {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  .reactions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Collapsed-until-hover: the breakdown slides out to the right on hover. */
  .reactions.collapsible .breakdown {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 0;
    opacity: 0;
    overflow: hidden;
    transform: translateX(-4px);
    transition: max-width 0.28s ease, opacity 0.2s ease, transform 0.28s ease;
  }

  .reactions.collapsible.expanded .breakdown {
    max-width: 460px;
    opacity: 1;
    transform: translateX(0);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 999px;
    background: color-mix(in srgb, var(--hg-surface, #101010) 88%, transparent);
    color: inherit;
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  button.pill {
    cursor: pointer;
  }

  button.pill:hover:not(:disabled) {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .pill img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }

  .mark {
    color: var(--hg-accent-cyan, #82d8f7);
    font-weight: 700;
  }

  .reply .mark { color: var(--hg-accent-green, #9be564); }
  .zap .mark { color: var(--hg-accent-yellow, #f7d774); }

  .react-picker {
    position: relative;
  }

  .react-button {
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 999px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .react-button:hover:not(:disabled) {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .react-menu {
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    z-index: 20;
    width: min(280px, calc(100vw - 32px));
    display: grid;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  }

  .react-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .react-grid button {
    min-width: 28px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }

  .react-grid img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  .custom-reaction {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px;
  }

  .custom-reaction input {
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 11px;
  }

  .custom-reaction button {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }

  .error {
    color: var(--hg-accent-red, #ff6b6b);
    font-size: 11px;
  }
</style>
