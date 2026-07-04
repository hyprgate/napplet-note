import type { NostrEvent } from '@hyprgate/types';
import {
  KIND_NIP22_COMMENT,
  KIND_REACTION,
  KIND_TEXT_NOTE,
  customEmojiForShortcodeContent,
  parseZapReceipt,
} from '@hyprgate/utils';
import type { EngagementCounts, ReactionGroup } from '@hyprgate/utils';
import { relay, type Subscription } from "@napplet/sdk";

export type { EngagementCounts, ReactionGroup };

const KIND_ZAP_RECEIPT = 9735 as const;

export interface ThreadEngagementState {
  engagement: Map<string, EngagementCounts>;
  version: number;
}

export interface ThreadEngagementStore {
  state: ThreadEngagementState;
  setTargets(ids: string[]): void;
  countsFor(id: string): EngagementCounts;
  destroy(): void;
}

export function emptyCounts(): EngagementCounts {
  return { reactions: 0, reactionGroups: [], comments: 0, zaps: 0, zapMillisats: 0 };
}

export function normalizeReactionContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed === '' || trimmed === '+') return '+';
  if (trimmed === '-') return '-';
  return trimmed;
}

function customEmoji(content: string, tags: string[][]): Pick<ReactionGroup, 'imageUrl' | 'shortcode'> {
  const emoji = customEmojiForShortcodeContent(content, tags);
  return emoji ? { shortcode: emoji.shortcode, ...(emoji.imageUrl ? { imageUrl: emoji.imageUrl } : {}) } : {};
}

type EngagementCategory = 'reactions' | 'comments' | 'zaps';

function categoryForKind(kind: number): EngagementCategory | null {
  if (kind === KIND_REACTION) return 'reactions';
  if (kind === KIND_TEXT_NOTE || kind === KIND_NIP22_COMMENT) return 'comments';
  if (kind === KIND_ZAP_RECEIPT) return 'zaps';
  return null;
}

/** Fold a reaction event into a target's reaction groups, incrementing counts. */
function applyReaction(counts: EngagementCounts, event: NostrEvent): void {
  const content = normalizeReactionContent(event.content);
  let group = counts.reactionGroups.find((item) => item.content === content);
  if (!group) {
    group = { content, count: 0, ...customEmoji(content, event.tags) };
    counts.reactionGroups.push(group);
  } else if (!group.imageUrl) {
    Object.assign(group, customEmoji(content, event.tags));
  }
  group.count++;
}

const ENGAGEMENT_FILTERS = (ids: string[]) => [
  { kinds: [KIND_REACTION], '#e': ids },
  { kinds: [KIND_TEXT_NOTE], '#e': ids },
  { kinds: [KIND_NIP22_COMMENT], '#e': ids },
  { kinds: [KIND_NIP22_COMMENT], '#E': ids },
  { kinds: [KIND_ZAP_RECEIPT], '#e': ids },
];

interface ThreadEngagementContext {
  state: ThreadEngagementState;
  sub: Subscription | null;
  targetsKey: string;
  loadedIds: Set<string>;
  // category -> targetId -> seen event ids (dedupe)
  seen: Map<string, Map<string, Set<string>>>;
  notify(): void;
}

function getCounts(ctx: ThreadEngagementContext, id: string): EngagementCounts {
  let counts = ctx.state.engagement.get(id);
  if (!counts) {
    counts = emptyCounts();
    ctx.state.engagement.set(id, counts);
  }
  return counts;
}

function getSeen(ctx: ThreadEngagementContext, category: string, id: string): Set<string> {
  let byTarget = ctx.seen.get(category);
  if (!byTarget) {
    byTarget = new Map();
    ctx.seen.set(category, byTarget);
  }
  let set = byTarget.get(id);
  if (!set) {
    set = new Set();
    byTarget.set(id, set);
  }
  return set;
}

function matchingTargets(ctx: ThreadEngagementContext, event: NostrEvent): string[] {
  const ids = event.tags
    .filter((tag) => (tag[0] === 'e' || (event.kind === KIND_NIP22_COMMENT && tag[0] === 'E')) && typeof tag[1] === 'string')
    .map((tag) => tag[1] as string)
    .filter((id) => ctx.loadedIds.has(id));
  return [...new Set(ids)];
}

function applyEvent(ctx: ThreadEngagementContext, event: NostrEvent): void {
  const category = categoryForKind(event.kind);
  if (category === null) return;

  let changed = false;
  for (const target of matchingTargets(ctx, event)) {
    const seenSet = getSeen(ctx, category, target);
    if (seenSet.has(event.id)) continue;
    seenSet.add(event.id);
    const counts = getCounts(ctx, target);
    counts[category]++;
    if (category === 'zaps') {
      counts.zapMillisats += parseZapReceipt(event)?.amountMillisats ?? 0;
    } else if (category === 'reactions') {
      applyReaction(counts, event);
    }
    ctx.state.engagement.set(target, { ...counts, reactionGroups: counts.reactionGroups.map((g) => ({ ...g })) });
    changed = true;
  }
  if (changed) ctx.notify();
}

function closeSub(ctx: ThreadEngagementContext): void {
  ctx.sub?.close();
  ctx.sub = null;
}

function setTargets(ctx: ThreadEngagementContext, ids: string[]): void {
  const unique = [...new Set(ids.filter(Boolean))];
  const key = unique.join(',');
  if (key === ctx.targetsKey) return;
  ctx.targetsKey = key;
  ctx.loadedIds = new Set(unique);
  closeSub(ctx);
  if (unique.length === 0) return;

  ctx.sub = relay.subscribe(
    ENGAGEMENT_FILTERS(unique),
    (result) => applyEvent(ctx, result.event as NostrEvent),
    () => {},
  );
}

export function createThreadEngagementStore(onUpdate?: () => void): ThreadEngagementStore {
  const ctx: ThreadEngagementContext = {
    state: { engagement: new Map(), version: 0 },
    sub: null,
    targetsKey: '',
    loadedIds: new Set<string>(),
    seen: new Map<string, Map<string, Set<string>>>(),
    notify: () => {},
  };
  ctx.notify = () => {
    ctx.state.version++;
    onUpdate?.();
  };

  return {
    state: ctx.state,
    setTargets: (ids) => setTargets(ctx, ids),
    countsFor: (id) => ctx.state.engagement.get(id) ?? emptyCounts(),
    destroy: () => closeSub(ctx),
  };
}
