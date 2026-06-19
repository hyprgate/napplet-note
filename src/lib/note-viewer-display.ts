import type { InteractionDetailState, ReactionGroup } from './interaction-detail-store.js';
import type { ParsedZapReceipt } from '@hyprgate/utils';
import type { ThreadGraph } from './thread-graph.js';

export interface ProfileDisplayContent {
  name?: string;
  display_name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
}

export function shortId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function profileDisplayName(pubkey: string, profile: ProfileDisplayContent | null | undefined): string {
  const displayName = profile?.display_name?.trim();
  if (displayName) return displayName;
  const camelDisplayName = profile?.displayName?.trim();
  if (camelDisplayName) return camelDisplayName;
  const name = profile?.name?.trim();
  if (name) return name;
  return shortId(pubkey);
}

export function profileAvatarUrl(profile: ProfileDisplayContent | null | undefined): string | null {
  return profile?.picture?.trim() || profile?.image?.trim() || null;
}

export function profileAvatarFallback(pubkey: string, profile: ProfileDisplayContent | null | undefined): string {
  const source = profile?.display_name?.trim() || profile?.displayName?.trim() || profile?.name?.trim() || pubkey || '?';
  return source.slice(0, 2).toUpperCase();
}

export function formatTimestamp(value: number): string {
  return new Date(value * 1000).toLocaleString();
}

export function pluralLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function reactionTotal(groups: ReactionGroup[]): number {
  return groups.reduce((total, group) => total + group.events.length, 0);
}

export function reactionPreview(groups: ReactionGroup[], limit = 3): string {
  return groups
    .slice(0, limit)
    .map((group) => `${group.content} ${group.events.length}`)
    .join('  ');
}

export function quoteTotal(interactions: InteractionDetailState): number {
  return interactions.quoteEvents.length + interactions.quotedEvents.length;
}

export function zapTotalMillisats(zaps: Array<Pick<ParsedZapReceipt, 'amountMillisats'>>): number {
  return zaps.reduce((total, zap) => total + zap.amountMillisats, 0);
}

export function replyTotal(graph: ThreadGraph | null, visibleCount: number): number {
  return graph?.nodes.size ?? visibleCount;
}
