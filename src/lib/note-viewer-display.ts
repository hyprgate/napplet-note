import type { InteractionDetailState, ReactionGroup } from './interaction-detail-store.js';
import type { ParsedZapReceipt } from '@hyprgate/utils';
import * as nip19 from 'nostr-tools/nip19';
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

/** How a person reads when there's no name: an npub, never hex. */
export function shortNpub(pubkey: string): string {
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return shortId(pubkey);
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-6)}`;
}

export function npubTitle(pubkey: string): string {
  return /^[0-9a-f]{64}$/.test(pubkey) ? nip19.npubEncode(pubkey) : pubkey;
}

const STANDALONE_IMAGE_LINE = /^\s*https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:[?#]\S*)?\s*$/i;

/** Images render as blocks, so blank lines around an image URL only add a gap. */
export function tightenImageSpacing(content: string): string {
  const lines = content.split(/\r\n|\r|\n/);
  const isBlank = (value: string | undefined) => value !== undefined && value.trim() === '';
  return lines.filter((line, index) => {
    if (line.trim() !== '') return true;
    let before = index - 1;
    while (isBlank(lines[before])) before -= 1;
    let after = index + 1;
    while (isBlank(lines[after])) after += 1;
    return !STANDALONE_IMAGE_LINE.test(lines[before] ?? '') && !STANDALONE_IMAGE_LINE.test(lines[after] ?? '');
  }).join('\n').trimEnd();
}

/** Plain-language failure for reactions and replies. */
export function publishErrorMessage(err: unknown, fallback: string): string {
  const reason = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/read.?only/i.test(reason)) {
    return "This session is read-only, so it can't sign. Sign in with a key or a signer to publish.";
  }
  return reason || fallback;
}

export function profileDisplayName(pubkey: string, profile: ProfileDisplayContent | null | undefined): string {
  const displayName = profile?.display_name?.trim();
  if (displayName) return displayName;
  const camelDisplayName = profile?.displayName?.trim();
  if (camelDisplayName) return camelDisplayName;
  const name = profile?.name?.trim();
  if (name) return name;
  return shortNpub(pubkey);
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
