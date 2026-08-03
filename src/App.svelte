<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { NostrEvent } from '@hyprgate/types';
  import { inc as ipc, identity, link, type Subscription } from '@napplet/sdk';
  import {
    NOTE_VIEWER_OPEN_TOPIC,
    NOTE_VIEWER_READY_TOPIC,
    clientTagValue,
    formatMillisatsAsSats,
    isCanonicalHexPubkey,
    parseNoteContent,
    pubkeyColorStyle,
    resourceImage,
    shouldInterceptLinkClick,
    waitForPublicKey,
  } from '@hyprgate/utils';
  import { format as timeago } from 'timeago.js';
  import { createNoteViewerStore, describeTarget, type NoteViewerTarget } from './lib/note-viewer-store.js';
  import { createInteractionDetailStore, type InteractionDetailState, type ReactionGroup } from './lib/interaction-detail-store.js';
  import { createReplyThreadStore, type ReplyThreadState } from './lib/reply-thread-store.js';
  import { createNoteViewerShareReference } from './lib/note-links.js';
  import { createThreadEngagementStore } from './lib/thread-engagement-store.js';
  import { createEmojiSetStore, type EmojiOption } from './lib/emoji-sets.js';
  import { noteTargetFromIncEvent, type IncEvent } from './note-intent-delivery.js';
  import { publishNoteViewerReaction } from './lib/note-viewer-actions.js';
  import { subscribeProfileMetadata, type ProfileContent } from './lib/profile-metadata.js';
  import RenderedNoteContent from './RenderedNoteContent.svelte';
  import ThreadNodeEngagement from './components/ThreadNodeEngagement.svelte';
  import {
    formatTimestamp,
    pluralLabel,
    profileAvatarFallback,
    profileAvatarUrl,
    profileDisplayName,
    quoteTotal,
    reactionTotal,
    replyTotal,
    shortId,
    zapTotalMillisats,
  } from './lib/note-viewer-display.js';

  type ActivityTab = 'replies' | 'zaps' | 'reposts' | 'reactions' | 'quotes';

  const store = createNoteViewerStore(syncFromStore);
  const interactionStore = createInteractionDetailStore(syncInteractionsFromStore);
  const threadStore = createReplyThreadStore(syncThreadFromStore);

  // Per-node engagement (reactions/replies/zaps) for the root note and every
  // visible reply, plus the user's reaction palette for the React menu.
  let nodeEngagementVersion = $state(0);
  const threadEngagementStore = createThreadEngagementStore(() => {
    nodeEngagementVersion = threadEngagementStore.state.version;
  });
  let reactionOptions = $state<EmojiOption[]>([]);
  const emojiStore = createEmojiSetStore(() => {
    reactionOptions = [...emojiStore.state.options];
  });
  let hoveredNodeId = $state<string | null>(null);

  function nodeCounts(id: string) {
    nodeEngagementVersion;
    return threadEngagementStore.countsFor(id);
  }

  let targetInput = $state('');
  let target: NoteViewerTarget | null = $state(null);
  let event: NostrEvent | null = $state(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let interactions: InteractionDetailState = $state(interactionStore.state);
  let thread: ReplyThreadState = $state(threadStore.state);
  let manualEntryVisible = $state(false);
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  // Hold-to-react state for the detailed "Reactions" activity tab.
  let reactionHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let holdingReactionContent = $state<string | null>(null);
  let completedReactionContent = $state<string | null>(null);
  let sendingReaction = $state(false);
  let reactionPublishError = $state<string | null>(null);
  let lastShareValue = '';
  let loadedThreadRootId: string | null = null;
  let loadedInteractionRootId: string | null = null;
  let activeActivityTab: ActivityTab = $state('replies');
  let profileMapVersion = $state(0);
  const profileMap = new Map<string, ProfileContent>();
  const loadingProfilePubkeys = new Set<string>();
  const profileSubscriptions = new Set<Subscription>();
  const totalReactions = $derived(reactionTotal(interactions.reactions));
  const totalQuotes = $derived(quoteTotal(interactions));
  const totalReplies = $derived(replyTotal(thread.graph, thread.visible.length));
  const totalZapMillisats = $derived(zapTotalMillisats(interactions.zaps));
  const totalZapSatsLabel = $derived(formatMillisatsAsSats(totalZapMillisats));
  const shareReference = $derived(createNoteViewerShareReference(event, target));
  const contextHiddenCount = $derived(Math.max(0, thread.ancestors.length - thread.visibleAncestors.length));
  const contextRootEvent = $derived(thread.rootEvent ?? thread.ancestors[0] ?? null);
  const showManualEntry = $derived(manualEntryVisible && !event);
  const createdRelative = $derived(event ? timeago(event.created_at * 1000) : '');
  const clientName = $derived(event ? clientTagValue(event) : null);
  const authorName = $derived(event ? displayNameFor(event.pubkey) : 'Unknown');
  const authorAvatarUrl = $derived(event ? avatarUrlFor(event.pubkey) : null);
  const authorAvatarFallback = $derived(event ? avatarFallbackFor(event.pubkey) : '?');
  const activityTabs = $derived([
    { id: 'replies' as const, label: 'Replies', count: totalReplies, summary: '' },
    { id: 'zaps' as const, label: 'Zaps', count: interactions.zaps.length, summary: interactions.zaps.length > 0 ? totalZapSatsLabel : '' },
    { id: 'reposts' as const, label: 'Reposts', count: interactions.reposts.length, summary: '' },
    { id: 'reactions' as const, label: 'Reactions', count: totalReactions, summary: '' },
    { id: 'quotes' as const, label: 'Quotes', count: totalQuotes, summary: '' },
  ]);

  function syncFromStore(): void {
    target = store.state.target;
    event = store.state.event;
    loading = store.state.loading;
    error = store.state.error;
  }

  function syncThreadFromStore(): void {
    thread = { ...threadStore.state };
  }

  function syncInteractionsFromStore(): void {
    interactions = { ...interactionStore.state };
  }

  function loadTarget(): void {
    if (!targetInput.trim() || loading) return;
    store.load(targetInput);
  }

  function loadOpenPayload(event: IncEvent): void {
    const nextTarget = noteTargetFromIncEvent(event);
    if (!nextTarget) return;
    manualEntryVisible = false;
    targetInput = nextTarget;
    store.load(nextTarget);
  }

  async function copyShareReference(): Promise<void> {
    if (!shareReference) return;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    try {
      await navigator.clipboard.writeText(shareReference.value);
      copyState = 'copied';
    } catch {
      copyState = 'failed';
    }
    copyResetTimer = setTimeout(() => {
      copyState = 'idle';
      copyResetTimer = null;
    }, 1400);
  }

  // NAP-LINK: open the public njump share link via the shell-owned opener so the
  // new browsing context does not inherit this napplet's origin.
  async function openShareLink(event: MouseEvent, href: string): Promise<void> {
    if (!shouldInterceptLinkClick(event)) return;
    event.preventDefault();
    const result = await link.open(href);
    if (result.status !== 'opened') {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') loadTarget();
  }

  function openComposerFor(parentId: string): void {
    threadStore.openComposer(parentId);
  }

  function publishFor(parent: NostrEvent): void {
    void threadStore.publishResponse(parent);
  }

  function startReactionHold(group: ReactionGroup): void {
    if (!event || sendingReaction) return;
    cancelReactionHold();
    reactionPublishError = null;
    holdingReactionContent = group.content;
    reactionHoldTimer = setTimeout(() => {
      void sendExistingReaction(group);
    }, 650);
  }

  function cancelReactionHold(): void {
    if (reactionHoldTimer) {
      clearTimeout(reactionHoldTimer);
      reactionHoldTimer = null;
    }
    holdingReactionContent = null;
  }

  async function sendExistingReaction(group: ReactionGroup): Promise<void> {
    if (!event || sendingReaction) return;
    reactionHoldTimer = null;
    sendingReaction = true;
    holdingReactionContent = null;
    const tags = group.shortcode && group.imageUrl ? [['emoji', group.shortcode, group.imageUrl]] : [];
    try {
      await publishNoteViewerReaction(event, { content: group.content || '+', tags });
      completedReactionContent = group.content;
      setTimeout(() => {
        if (completedReactionContent === group.content) completedReactionContent = null;
      }, 520);
    } catch (error) {
      reactionPublishError = error instanceof Error ? error.message : 'Reaction failed';
    } finally {
      sendingReaction = false;
    }
  }

  function openProfile(pubkey: string): void {
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  function openNoteReference(reference: string): void {
    manualEntryVisible = false;
    targetInput = reference;
    store.load(reference);
  }

  function openRootContext(): void {
    if (!contextRootEvent) return;
    openNoteReference(contextRootEvent.id);
  }

  function profileFor(pubkey: string): ProfileContent | null {
    profileMapVersion;
    return profileMap.get(pubkey) ?? null;
  }

  function displayNameFor(pubkey: string): string {
    return profileDisplayName(pubkey, profileFor(pubkey));
  }

  function avatarUrlFor(pubkey: string): string | null {
    return profileAvatarUrl(profileFor(pubkey));
  }

  function avatarFallbackFor(pubkey: string): string {
    return profileAvatarFallback(pubkey, profileFor(pubkey));
  }

  function collectProfilePubkeys(): string[] {
    const pubkeys = new Set<string>();
    if (event?.pubkey) pubkeys.add(event.pubkey);
    if (event?.content) collectProfileReferences(event.content, pubkeys);

    for (const ancestor of thread.visibleAncestors) {
      if (ancestor.pubkey) pubkeys.add(ancestor.pubkey);
      collectProfileReferences(ancestor.content, pubkeys);
    }
    for (const item of thread.visible) {
      if (item.node.event.pubkey) pubkeys.add(item.node.event.pubkey);
      collectProfileReferences(item.node.event.content, pubkeys);
    }
    for (const group of interactions.reactions) {
      for (const actor of group.actors) pubkeys.add(actor);
    }
    for (const zap of interactions.zaps) {
      if (zap.senderPubkey) pubkeys.add(zap.senderPubkey);
      else if (zap.providerPubkey) pubkeys.add(zap.providerPubkey);
    }
    for (const repost of interactions.reposts) {
      if (repost.pubkey) pubkeys.add(repost.pubkey);
    }
    for (const quote of interactions.quoteEvents) {
      if (quote.pubkey) pubkeys.add(quote.pubkey);
      collectProfileReferences(quote.content, pubkeys);
    }
    for (const quoted of interactions.quotedEvents) {
      if (quoted.pubkey) pubkeys.add(quoted.pubkey);
      collectProfileReferences(quoted.content, pubkeys);
    }

    return [...pubkeys];
  }

  function collectProfileReferences(content: string, pubkeys: Set<string>): void {
    for (const block of parseNoteContent(content)) {
      if (block.type === 'profile') pubkeys.add(block.value);
    }
  }

  function closeProfileSubscriptions(): void {
    for (const subscription of profileSubscriptions) subscription.close();
    profileSubscriptions.clear();
    loadingProfilePubkeys.clear();
  }

  function ensureProfile(pubkey: string): void {
    if (profileMap.has(pubkey) || loadingProfilePubkeys.has(pubkey)) return;
    loadingProfilePubkeys.add(pubkey);

    const subscription = subscribeProfileMetadata(
      [pubkey],
      (profilePubkey, nextProfile) => {
        const currentProfile = profileMap.get(profilePubkey);
        if (
          currentProfile?._created_at !== undefined
          && nextProfile._created_at !== undefined
          && currentProfile._created_at > nextProfile._created_at
        ) {
          return;
        }
        profileMap.set(profilePubkey, nextProfile);
        profileMapVersion++;
      },
      () => {
        loadingProfilePubkeys.delete(pubkey);
        profileSubscriptions.delete(subscription);
      },
    );

    profileSubscriptions.add(subscription);
  }

  function ensureProfiles(pubkeys: string[]): void {
    for (const pubkey of pubkeys) ensureProfile(pubkey);
  }

  function selectActivityTab(tab: ActivityTab): void {
    const next = activityTabs.find((item) => item.id === tab);
    if (!next || (next.id !== 'replies' && next.count === 0)) return;
    activeActivityTab = tab;
  }

  $effect(() => {
    if (activeActivityTab === 'replies') return;
    const active = activityTabs.find((tab) => tab.id === activeActivityTab);
    if (active && active.count > 0) return;
    activeActivityTab = 'replies';
  });

  $effect(() => {
    if (!event || event.id === loadedThreadRootId) return;
    loadedThreadRootId = event.id;
    threadStore.load(event);
  });

  $effect(() => {
    if (!event || event.id === loadedInteractionRootId) return;
    loadedInteractionRootId = event.id;
    interactionStore.load(event);
  });

  // Track engagement for the root note and every currently-visible reply.
  $effect(() => {
    const ids: string[] = [];
    if (event) ids.push(event.id);
    for (const ancestor of thread.visibleAncestors) ids.push(ancestor.id);
    for (const item of thread.visible) ids.push(item.node.event.id);
    threadEngagementStore.setTargets(ids);
  });

  $effect(() => {
    if (!event) return;
    ensureProfiles(collectProfilePubkeys());
  });

  $effect(() => {
    const nextShareValue = shareReference?.value ?? '';
    if (nextShareValue === lastShareValue) return;
    lastShareValue = nextShareValue;
    copyState = 'idle';
  });

  onMount(() => {
    const subNoteOpen = ipc.on(NOTE_VIEWER_OPEN_TOPIC, loadOpenPayload);
    ipc.emit(NOTE_VIEWER_READY_TOPIC);
    const params = new URLSearchParams(window.location.search);
    const initialTarget = params.get('target');
    if (initialTarget) {
      manualEntryVisible = false;
      targetInput = initialTarget;
      store.load(initialTarget);
    } else {
      manualEntryVisible = true;
    }

    // The reaction palette follows the logged-in user.
    const controller = new AbortController();
    void waitForPublicKey(identity, {
      signal: controller.signal,
      isValidPubkey: isCanonicalHexPubkey,
    }).then((pk) => {
      if (!controller.signal.aborted && isCanonicalHexPubkey(pk)) emojiStore.init(pk);
    });

    return () => {
      subNoteOpen.close();
      controller.abort();
    };
  });

  onDestroy(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
    cancelReactionHold();
    store.destroy();
    interactionStore.destroy();
    threadStore.destroy();
    threadEngagementStore.destroy();
    emojiStore.destroy();
    closeProfileSubscriptions();
  });
</script>

<div class="note-viewer" data-note-target={targetInput}>
  {#if showManualEntry}
    <main class="manual-entry">
      <form class="manual-panel" onsubmit={(submitEvent) => { submitEvent.preventDefault(); loadTarget(); }}>
        <div class="manual-heading">
          <span class="manual-kicker">Note Reader</span>
          <h1>Open a Nostr note</h1>
        </div>
        <label class="target-control">
          <span class="target-label">Event id or NIP-19</span>
          <div class="target-row">
            <input
              class="target-input"
              bind:value={targetInput}
              onkeydown={handleKeydown}
              placeholder="note1..., nevent1..., naddr1..., or 64-char id"
              spellcheck="false"
            />
            <button class="load-button" type="submit" disabled={loading || !targetInput.trim()}>
              {loading ? 'Loading' : 'Load'}
            </button>
          </div>
        </label>

        {#if error}
          <p class="status-text danger">{error}</p>
        {/if}
      </form>
    </main>
  {:else}
    <main class="reader-scroll">
      {#if event}
        <article class="detail-layout">
          <section class="note-article">
            {#if thread.visibleAncestors.length > 0 || thread.contextLoading || thread.contextError}
              <section class="thread-context-rail" aria-label="Thread context">
                <div class="thread-context-header">
                  <span>{thread.visibleAncestors.length > 0 ? 'In reply to' : 'Thread context'}</span>
                  <div class="thread-context-actions">
                    {#if contextRootEvent && contextRootEvent.id !== event.id}
                      <button class="small-action" type="button" onclick={openRootContext}>Jump root</button>
                    {/if}
                    {#if thread.ancestors.length > 1}
                      <button class="small-action" type="button" onclick={() => threadStore.toggleContextExpanded()}>
                        {thread.contextExpanded ? 'Collapse context' : `Show ${contextHiddenCount} earlier`}
                      </button>
                    {/if}
                  </div>
                </div>

                {#if thread.contextLoading}
                  <p class="status-text">loading context...</p>
                {/if}
                {#if thread.contextError}
                  <p class="status-text danger">{thread.contextError}</p>
                {/if}

                <div class="thread-context-list">
                  {#each thread.visibleAncestors as ancestor (ancestor.id)}
                    <article class="thread-context-node">
                      <div class="thread-meta">
                        <div class="thread-meta-main">
                          <button type="button" class="profile-chip" title={ancestor.pubkey} onclick={() => openProfile(ancestor.pubkey)}>
                            <span class="profile-chip-avatar">
                              <span>{avatarFallbackFor(ancestor.pubkey)}</span>
                              {#if avatarUrlFor(ancestor.pubkey)}
                                <img use:resourceImage={avatarUrlFor(ancestor.pubkey)} alt="" loading="lazy" />
                              {/if}
                            </span>
                            <span class="profile-chip-name" style={pubkeyColorStyle(ancestor.pubkey)}>{displayNameFor(ancestor.pubkey)}</span>
                          </button>
                          <span>{formatTimestamp(ancestor.created_at)}</span>
                        </div>
                        <button class="small-action" type="button" onclick={() => openNoteReference(ancestor.id)}>Open</button>
                      </div>

                      <div class="reply-content">
                        <RenderedNoteContent
                          content={ancestor.content || '[empty content]'}
                          emojiTags={ancestor.tags}
                          profileLabel={displayNameFor}
                          {openProfile}
                          {openNoteReference}
                        />
                      </div>

                      <ThreadNodeEngagement
                        event={{ id: ancestor.id, kind: ancestor.kind, pubkey: ancestor.pubkey }}
                        counts={nodeCounts(ancestor.id)}
                        {reactionOptions}
                        collapsible
                      />
                    </article>
                  {/each}
                </div>
              </section>
            {/if}

            <header class="note-header">
              <div class="author-block">
                <button type="button" class="author-avatar" onclick={() => openProfile(event.pubkey)} aria-label="Open profile for {authorName}">
                  <span>{authorAvatarFallback}</span>
                  {#if authorAvatarUrl}
                    <img use:resourceImage={authorAvatarUrl} alt="" loading="lazy" />
                  {/if}
                </button>
                <div class="author-copy">
                  <button type="button" class="author-name" style={pubkeyColorStyle(event.pubkey)} onclick={() => openProfile(event.pubkey)}>
                    {authorName}
                  </button>
                  <code title={event.pubkey} style={pubkeyColorStyle(event.pubkey)}>{shortId(event.pubkey)}</code>
                </div>
              </div>

              <div class="note-context">
                <span>{createdRelative}</span>
                <span>{formatTimestamp(event.created_at)}</span>
                {#if clientName}
                  <span class="note-client" title="Published with {clientName}">via {clientName}</span>
                {/if}
              </div>

              {#if shareReference}
                <div class="note-actions">
                  <button class="action-button primary" type="button" onclick={() => void copyShareReference()}>
                    {copyState === 'copied' ? 'copied' : copyState === 'failed' ? 'failed' : shareReference.type}
                  </button>
                  <a class="action-button" href={shareReference.url} target="_blank" rel="noreferrer" onclick={(e) => void openShareLink(e, shareReference.url)}>open</a>
                </div>
              {/if}
            </header>

            <section class="note-content" aria-label="Note content">
              <RenderedNoteContent
                content={event.content || '[empty content]'}
                emojiTags={event.tags}
                profileLabel={displayNameFor}
                {openProfile}
                {openNoteReference}
              />
            </section>

            <div class="root-engagement">
              <ThreadNodeEngagement
                event={{ id: event.id, kind: event.kind, pubkey: event.pubkey }}
                counts={nodeCounts(event.id)}
                {reactionOptions}
              />
            </div>

            <section class="activity" aria-label="Note activity">
              <div class="activity-tabs" role="tablist" aria-label="Engagement views">
                {#each activityTabs as tab (tab.id)}
                  {@const tabDisabled = tab.id !== 'replies' && tab.count === 0}
                  <button
                    type="button"
                    class="activity-tab"
                    class:active={activeActivityTab === tab.id}
                    class:inactive={tabDisabled}
                    role="tab"
                    aria-selected={activeActivityTab === tab.id}
                    aria-controls={`activity-panel-${tab.id}`}
                    disabled={tabDisabled}
                    onclick={() => selectActivityTab(tab.id)}
                  >
                    <span>{tab.label}</span>
                    <span class="tab-count">{tab.count}</span>
                    {#if tab.summary}
                      <span class="tab-summary">{tab.summary}</span>
                    {/if}
                  </button>
                {/each}
              </div>

              <div class="activity-panel" id={`activity-panel-${activeActivityTab}`} role="tabpanel">
                {#if activeActivityTab === 'replies'}
                  <div class="reply-toolbar">
                    <button class="small-action primary" onclick={() => openComposerFor(event!.id)}>Reply</button>
                    {#if thread.loading}
                      <span class="status-text">loading thread...</span>
                    {/if}
                  </div>

                  {#if thread.activeComposerId === event.id}
                    <div class="composer-box">
                      <textarea
                        class="composer-input"
                        value={thread.draft}
                        oninput={(inputEvent) => threadStore.setDraft((inputEvent.currentTarget as HTMLTextAreaElement).value)}
                        placeholder="Write a response"
                      ></textarea>
                      <div class="composer-actions">
                        <button class="small-action" onclick={() => threadStore.closeComposer()}>Cancel</button>
                        <button class="small-action primary" disabled={thread.publishing || !thread.draft.trim()} onclick={() => publishFor(event!)}>
                          {thread.publishing ? 'Sending' : 'Send'}
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if thread.error}
                    <p class="status-text danger">{thread.error}</p>
                  {/if}

                  <div class="thread-list">
                    {#each thread.visible as item (item.node.id)}
                      <article
                        class="thread-node"
                        style={`margin-left: ${Math.min(item.depth - 1, 4) * 1.05}rem`}
                        onpointerenter={() => (hoveredNodeId = item.node.event.id)}
                        onpointerleave={() => { if (hoveredNodeId === item.node.event.id) hoveredNodeId = null; }}
                      >
                        <div class="thread-meta">
                          <div class="thread-meta-main">
                            <button type="button" class="profile-chip" title={item.node.event.pubkey} onclick={() => openProfile(item.node.event.pubkey)}>
                              <span class="profile-chip-avatar">
                                <span>{avatarFallbackFor(item.node.event.pubkey)}</span>
                                {#if avatarUrlFor(item.node.event.pubkey)}
                                  <img use:resourceImage={avatarUrlFor(item.node.event.pubkey)} alt="" loading="lazy" />
                                {/if}
                              </span>
                              <span class="profile-chip-name" style={pubkeyColorStyle(item.node.event.pubkey)}>{displayNameFor(item.node.event.pubkey)}</span>
                            </button>
                            <span>{formatTimestamp(item.node.event.created_at)}</span>
                          </div>
                          <button class="small-action" onclick={() => openComposerFor(item.node.id)}>Reply</button>
                        </div>

                        <div class="reply-content">
                          <RenderedNoteContent
                            content={item.node.event.content || '[empty content]'}
                            emojiTags={item.node.event.tags}
                            profileLabel={displayNameFor}
                            {openProfile}
                            {openNoteReference}
                          />
                        </div>

                        <div class="reply-engagement">
                          <ThreadNodeEngagement
                            event={{ id: item.node.event.id, kind: item.node.event.kind, pubkey: item.node.event.pubkey }}
                            counts={nodeCounts(item.node.event.id)}
                            {reactionOptions}
                            collapsible
                            expanded={hoveredNodeId === item.node.event.id}
                          />
                        </div>

                        {#if item.expandable}
                          <button class="expand-action" onclick={() => threadStore.toggleExpanded(item.node.id)}>
                            Show {item.hiddenChildCount} deeper {item.hiddenChildCount === 1 ? 'reply' : 'replies'}
                          </button>
                        {/if}

                        {#if thread.activeComposerId === item.node.id}
                          <div class="composer-box">
                            <textarea
                              class="composer-input"
                              value={thread.draft}
                              oninput={(inputEvent) => threadStore.setDraft((inputEvent.currentTarget as HTMLTextAreaElement).value)}
                              placeholder="Write a response"
                            ></textarea>
                            <div class="composer-actions">
                              <button class="small-action" onclick={() => threadStore.closeComposer()}>Cancel</button>
                              <button class="small-action primary" disabled={thread.publishing || !thread.draft.trim()} onclick={() => publishFor(item.node.event)}>
                                {thread.publishing ? 'Sending' : 'Send'}
                              </button>
                            </div>
                          </div>
                        {/if}
                      </article>
                    {/each}
                  </div>
                {:else if activeActivityTab === 'zaps'}
                  <div class="interaction-list">
                    {#each interactions.zaps as zap (zap.id)}
                      {@const zapper = zap.senderPubkey ?? zap.providerPubkey}
                      <div class="interaction-row zap-row">
                        <button type="button" class="profile-chip" title={zapper} onclick={() => openProfile(zapper)}>
                          <span class="profile-chip-avatar">
                            <span>{avatarFallbackFor(zapper)}</span>
                            {#if avatarUrlFor(zapper)}
                              <img use:resourceImage={avatarUrlFor(zapper)} alt="" loading="lazy" />
                            {/if}
                          </span>
                          <span class="profile-chip-name" style={pubkeyColorStyle(zapper)}>{displayNameFor(zapper)}</span>
                        </button>
                        <strong class="zap-amount">{formatMillisatsAsSats(zap.amountMillisats)}</strong>
                        <span>{formatTimestamp(zap.createdAt)}</span>
                        {#if zap.comment}
                          <p class="zap-comment">{zap.comment}</p>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else if activeActivityTab === 'reposts'}
                  <div class="interaction-list">
                    {#each interactions.reposts as repost (repost.id)}
                      <div class="interaction-row compact">
                        <button type="button" class="profile-chip" title={repost.pubkey} onclick={() => openProfile(repost.pubkey)}>
                          <span class="profile-chip-avatar">
                            <span>{avatarFallbackFor(repost.pubkey)}</span>
                            {#if avatarUrlFor(repost.pubkey)}
                              <img use:resourceImage={avatarUrlFor(repost.pubkey)} alt="" loading="lazy" />
                            {/if}
                          </span>
                          <span class="profile-chip-name" style={pubkeyColorStyle(repost.pubkey)}>{displayNameFor(repost.pubkey)}</span>
                        </button>
                      </div>
                    {/each}
                  </div>
                {:else if activeActivityTab === 'reactions'}
                  {#if reactionPublishError}
                    <p class="status-text danger">{reactionPublishError}</p>
                  {/if}
                  <div class="interaction-list">
                    {#each interactions.reactions as group (group.content)}
                      <div class="interaction-row">
                        <button
                          type="button"
                          class="reaction-pill compact"
                          class:hold-active={holdingReactionContent === group.content}
                          class:send-complete={completedReactionContent === group.content}
                          title={`Hold to send ${group.content || '+'}`}
                          disabled={sendingReaction}
                          onpointerdown={() => startReactionHold(group)}
                          onpointerup={cancelReactionHold}
                          onpointerleave={cancelReactionHold}
                          onpointercancel={cancelReactionHold}
                        >
                          {#if group.imageUrl}
                            <img use:resourceImage={group.imageUrl} alt={group.shortcode ?? group.content} loading="lazy" />
                          {:else}
                            <span class="reaction-mark">{group.content || '+'}</span>
                          {/if}
                        </button>
                        <span>{pluralLabel(group.events.length, 'reaction')}</span>
                        <span class="profile-chip-list">
                          {#each group.actors as actor}
                            <button type="button" class="profile-chip" title={actor} onclick={() => openProfile(actor)}>
                              <span class="profile-chip-avatar">
                                <span>{avatarFallbackFor(actor)}</span>
                                {#if avatarUrlFor(actor)}
                                  <img use:resourceImage={avatarUrlFor(actor)} alt="" loading="lazy" />
                                {/if}
                              </span>
                              <span class="profile-chip-name" style={pubkeyColorStyle(actor)}>{displayNameFor(actor)}</span>
                            </button>
                          {/each}
                        </span>
                      </div>
                    {/each}
                  </div>
                {:else if activeActivityTab === 'quotes'}
                  <div class="quote-list">
                    {#each interactions.quotedEvents as quoted (quoted.id)}
                      <article class="quote-row">
                        <div class="quote-meta">
                          <button type="button" class="profile-chip" title={quoted.pubkey} onclick={() => openProfile(quoted.pubkey)}>
                            <span class="profile-chip-avatar">
                              <span>{avatarFallbackFor(quoted.pubkey)}</span>
                              {#if avatarUrlFor(quoted.pubkey)}
                                <img use:resourceImage={avatarUrlFor(quoted.pubkey)} alt="" loading="lazy" />
                              {/if}
                            </span>
                            <span class="profile-chip-name" style={pubkeyColorStyle(quoted.pubkey)}>{displayNameFor(quoted.pubkey)}</span>
                          </button>
                          <span>quoted by this note</span>
                        </div>
                        <p>{quoted.content || '[empty content]'}</p>
                        <time>{formatTimestamp(quoted.created_at)}</time>
                      </article>
                    {/each}
                    {#each interactions.quoteEvents as quote (quote.id)}
                      <article class="quote-row">
                        <div class="quote-meta">
                          <button type="button" class="profile-chip" title={quote.pubkey} onclick={() => openProfile(quote.pubkey)}>
                            <span class="profile-chip-avatar">
                              <span>{avatarFallbackFor(quote.pubkey)}</span>
                              {#if avatarUrlFor(quote.pubkey)}
                                <img use:resourceImage={avatarUrlFor(quote.pubkey)} alt="" loading="lazy" />
                              {/if}
                            </span>
                            <span class="profile-chip-name" style={pubkeyColorStyle(quote.pubkey)}>{displayNameFor(quote.pubkey)}</span>
                          </button>
                          <span>quotes this note</span>
                        </div>
                        <p>{quote.content || '[empty content]'}</p>
                        <time>{formatTimestamp(quote.created_at)}</time>
                      </article>
                    {/each}
                  </div>
                {/if}
              </div>
            </section>

            {#if interactions.loading}
              <p class="status-text subtle">Loading zaps, reactions, quotes, reposts, and replies...</p>
            {/if}
            {#if interactions.error}
              <p class="status-text danger">{interactions.error}</p>
            {/if}

            <details class="metadata-detail">
              <summary>
                <span>Technical</span>
                <span>{shortId(event.id)}</span>
              </summary>
              <dl class="metadata-list">
                <div><dt>Event id</dt><dd><code title={event.id}>{event.id}</code></dd></div>
                <div><dt>Author</dt><dd><code title={event.pubkey} style={pubkeyColorStyle(event.pubkey)}>{event.pubkey}</code></dd></div>
                <div><dt>Kind</dt><dd>{event.kind}</dd></div>
                <div><dt>Created</dt><dd>{formatTimestamp(event.created_at)}</dd></div>
                {#if target}
                  <div><dt>Target</dt><dd><code title={describeTarget(target)}>{describeTarget(target)}</code></dd></div>
                  <div><dt>Relay hints</dt><dd>{target.relays.length > 0 ? target.relays.join(', ') : 'none'}</dd></div>
                {/if}
              </dl>

              <details class="raw-detail">
                <summary>Raw event JSON</summary>
                <pre>{JSON.stringify(event, null, 2)}</pre>
              </details>
            </details>
          </section>

        </article>
      {:else if loading}
        <div class="empty-state">loading event...</div>
      {:else}
        <div class="empty-state">No event loaded.</div>
      {/if}
    </main>
  {/if}
</div>

<style>
  .note-viewer {
    --base: var(--hg-bg-base, #050505);
    --surface: var(--hg-surface, var(--hg-bg-surface, #101010));
    --elevated: var(--hg-bg-elevated, #181818);
    --border: var(--hg-border, var(--hg-border-default, #303030));
    --border-dim: var(--hg-border-muted, var(--hg-border-dim, #252525));
    --accent: var(--hg-accent-primary, #9be564);
    --text: var(--hg-text-primary, #f2efe7);
    --muted: var(--hg-text-muted, #b8b1a4);
    --dim: var(--hg-text-dim, #777);
    --danger: var(--hg-accent-danger, var(--hg-accent-red, #ff6b6b));
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--base);
    color: var(--text);
    font-family: var(--hg-font-body, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
    font-size: 12px;
    line-height: 1.5;
  }

  .manual-entry,
  .reader-scroll {
    height: 100%;
    overflow: auto;
  }

  .manual-entry {
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .manual-panel {
    display: grid;
    width: min(520px, 100%);
    gap: 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    padding: 14px;
  }

  .manual-heading {
    display: grid;
    gap: 4px;
  }

  .manual-kicker,
  .target-label,
  .metadata-list dt,
  .status-text {
    color: var(--muted);
    font-size: 11px;
  }

  .manual-heading h1 {
    margin: 0;
    color: var(--text);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1.35;
  }

  .target-control {
    display: grid;
    min-width: 0;
    gap: 6px;
  }

  .target-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .target-input,
  .composer-input {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--base);
    color: var(--text);
    font: inherit;
    outline: none;
  }

  .target-input {
    min-height: 32px;
    padding: 6px 8px;
    font-size: 12px;
  }

  .target-input:focus,
  .composer-input:focus {
    border-color: var(--accent);
  }

  .load-button,
  .action-button,
  .small-action,
  .expand-action {
    display: inline-flex;
    min-height: 24px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 400;
    line-height: 1;
    text-decoration: none;
  }

  .load-button,
  .action-button {
    padding: 0 8px;
  }

  .small-action,
  .expand-action {
    min-height: 24px;
    padding: 0 8px;
  }

  .load-button:hover:not(:disabled),
  .action-button:hover,
  .small-action:hover:not(:disabled),
  .expand-action:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text);
  }

  .action-button.primary,
  .small-action.primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  .load-button {
    border-color: var(--accent);
    color: var(--accent);
  }

  .load-button:disabled,
  .small-action:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .reader-scroll {
    padding: 12px;
    background: var(--base);
  }

  .detail-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    max-width: 980px;
    margin: 0 auto;
  }

  .note-article {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 12px;
    color: var(--text);
    padding: 0 12px;
  }

  .note-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
  }

  .author-block {
    display: flex;
    min-width: 0;
    gap: 8px;
    align-items: center;
  }

  .author-avatar {
    display: grid;
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border-dim);
    border-radius: 999px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    padding: 0;
  }

  .author-avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .author-avatar > span,
  .author-avatar > img {
    grid-area: 1 / 1;
  }

  .author-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .author-name {
    min-width: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    padding: 0;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-name:hover {
    text-decoration: underline;
  }

  code {
    font-family: inherit;
  }

  .author-copy code,
  .metadata-list code {
    overflow-wrap: anywhere;
  }

  .profile-chip,
  .profile-chip-list {
    display: inline-flex;
    min-width: 0;
    align-items: center;
  }

  .profile-chip {
    max-width: 18rem;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .profile-chip:hover .profile-chip-name {
    text-decoration: underline;
  }

  .profile-chip-avatar {
    display: grid;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--border-dim);
    border-radius: 999px;
    background: var(--surface);
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
  }

  .profile-chip-avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile-chip-avatar > span,
  .profile-chip-avatar > img {
    grid-area: 1 / 1;
  }

  .profile-chip-name {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-chip-list {
    gap: 6px 10px;
    flex-wrap: wrap;
  }

  .note-context {
    display: flex;
    grid-column: 1 / 2;
    min-width: 0;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
  }

  .note-context .note-client {
    opacity: 0.7;
  }

  .note-actions {
    display: flex;
    grid-column: 2 / 3;
    grid-row: 1 / span 2;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }

  .note-actions .action-button {
    border-color: var(--border);
    background: var(--surface);
    color: var(--muted);
  }

  .note-actions .action-button.primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  .note-content {
    padding: 8px 0 2px;
    color: var(--text);
    font-size: 16px;
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.65;
  }

  .activity {
    display: grid;
    gap: 10px;
  }

  .reaction-pill {
    position: relative;
    display: inline-flex;
    max-width: 12rem;
    height: 30px;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border-dim);
    border-radius: 999px;
    background: var(--elevated);
    color: var(--muted);
    padding: 0 10px;
    font-size: 12px;
    font: inherit;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
  }

  button.reaction-pill {
    cursor: pointer;
  }

  button.reaction-pill:disabled {
    cursor: wait;
    opacity: 0.78;
  }

  button.reaction-pill::before {
    content: '';
    position: absolute;
    inset: 0;
    transform: scaleX(0);
    transform-origin: left center;
    background: color-mix(in srgb, var(--accent, #9be564) 32%, transparent);
    pointer-events: none;
  }

  button.reaction-pill.hold-active::before {
    animation: hold-fill 650ms linear forwards;
  }

  button.reaction-pill.send-complete {
    animation: sent-pop 520ms ease-out;
  }

  .reaction-pill.compact {
    height: 24px;
    padding: 0 8px;
  }

  .reaction-mark {
    position: relative;
    max-width: 7ch;
    overflow: hidden;
    color: var(--text);
    font-size: 16px;
    font-weight: 400;
    line-height: 1;
    text-overflow: ellipsis;
  }

  .reaction-pill img {
    position: relative;
    width: 18px;
    height: 18px;
    object-fit: contain;
  }

  .reaction-pill.compact img {
    width: 14px;
    height: 14px;
  }

  @keyframes hold-fill {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }

  @keyframes sent-pop {
    0% {
      border-color: var(--accent);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
      transform: scale(1);
    }
    45% {
      box-shadow: 0 0 0 6px transparent;
      transform: scale(1.08);
    }
    100% {
      box-shadow: none;
      transform: scale(1);
    }
  }

  .activity-tabs {
    display: flex;
    min-width: 0;
    gap: 26px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border-dim);
  }

  .activity-tab {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    gap: 4px;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 0 0 8px;
  }

  .activity-tab:hover:not(:disabled) {
    color: var(--text);
  }

  .activity-tab.active {
    border-bottom-color: var(--accent);
    color: var(--text);
  }

  .activity-tab.inactive,
  .activity-tab:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .tab-count {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .tab-summary {
    color: var(--dim);
    font-size: 11px;
    font-weight: 400;
  }

  .activity-panel {
    display: grid;
    gap: 8px;
    padding: 2px 0 0;
  }

  .metadata-detail > summary,
  .raw-detail > summary {
    cursor: pointer;
    list-style: none;
  }

  .metadata-detail > summary::-webkit-details-marker,
  .raw-detail > summary::-webkit-details-marker {
    display: none;
  }

  .interaction-list,
  .quote-list,
  .thread-context-list,
  .thread-list {
    display: grid;
    gap: 0;
  }

  .interaction-row {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    gap: 4px 8px;
    align-items: baseline;
    border-bottom: 1px solid var(--border-dim);
    color: var(--muted);
    font-size: 11px;
    padding: 10px 0;
  }

  .interaction-row.compact {
    grid-template-columns: minmax(0, 1fr);
  }

  .interaction-row.zap-row {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .interaction-row strong {
    color: var(--text);
  }

  .zap-amount {
    white-space: nowrap;
  }

  .zap-comment {
    grid-column: 1 / -1;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .quote-row,
  .thread-context-node,
  .thread-node {
    display: grid;
    gap: 8px;
    border-bottom: 1px solid var(--border-dim);
    padding: 12px 0;
  }

  .interaction-row:last-child,
  .quote-row:last-child,
  .thread-context-node:last-child,
  .thread-node:last-child {
    border-bottom: 0;
  }

  .quote-row p,
  .reply-content {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .thread-context-rail {
    display: grid;
    gap: 6px;
    border-bottom: 1px solid var(--border-dim);
    padding: 0 0 10px;
  }

  .thread-context-header,
  .thread-context-actions {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
  }

  .thread-context-header {
    justify-content: space-between;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .quote-row time,
  .thread-meta {
    color: var(--muted);
    font-size: 11px;
  }

  .quote-meta {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
  }

  .reply-toolbar,
  .composer-actions,
  .thread-meta,
  .thread-meta-main {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;
  }

  .reply-toolbar,
  .thread-meta {
    justify-content: space-between;
  }

  .composer-box {
    display: grid;
    gap: 8px;
  }

  .composer-input {
    min-height: 84px;
    width: 100%;
    resize: vertical;
    background: var(--base);
    color: var(--text);
    padding: 8px;
    font-size: 12px;
  }

  .composer-actions {
    justify-content: flex-end;
  }

  .note-article .small-action,
  .note-article .expand-action {
    min-height: 20px;
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 0;
  }

  .note-article .small-action.primary {
    border: 0;
    color: var(--accent);
  }

  .expand-action {
    justify-self: start;
    color: var(--muted);
  }

  .metadata-detail {
    border-top: 1px solid var(--border-dim);
    padding-top: 8px;
  }

  .metadata-detail > summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    color: var(--muted);
    font-size: 11px;
  }

  .metadata-detail > summary span:first-child {
    color: var(--text);
    font-weight: 600;
  }

  .metadata-list {
    display: grid;
    gap: 8px;
    margin: 8px 0 0;
  }

  .metadata-list div {
    display: grid;
    gap: 2px;
  }

  .metadata-list dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font-size: 11px;
  }

  .raw-detail {
    margin-top: 10px;
  }

  .raw-detail > summary {
    color: var(--muted);
    font-size: 11px;
  }

  .raw-detail pre {
    max-height: 320px;
    overflow: auto;
    margin: 8px 0 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--base);
    color: var(--text);
    padding: 8px;
    font-family: inherit;
    font-size: 11px;
    line-height: 1.5;
  }

  .status-text {
    margin: 0;
  }

  .status-text.danger {
    color: var(--danger);
  }

  .status-text.subtle {
    color: var(--muted);
  }

  .empty-state {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }

  @media (max-width: 680px) {
    .reader-scroll,
    .manual-entry {
      padding: 8px;
    }

    .note-article {
      padding: 0;
    }

    .note-header {
      grid-template-columns: 1fr;
    }

    .note-context,
    .note-actions {
      grid-column: auto;
      grid-row: auto;
      justify-content: flex-start;
    }

    .activity-tabs,
    .target-row {
      grid-template-columns: 1fr;
    }
  }
</style>
