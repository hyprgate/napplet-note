import type { NostrEvent, NostrFilter } from '@hyprgate/types';
import {
  KIND_GENERIC_REPOST,
  KIND_REACTION,
  KIND_REPOST,
  KIND_TEXT_NOTE,
  KIND_ZAP_RECEIPT,
  customEmojiForShortcodeContent,
  parseZapReceipt,
  rootAddressForZapTarget,
  summarizeZapReceipts,
  type ParsedZapReceipt,
} from '@hyprgate/utils';
import { relay, type Subscription } from "@napplet/sdk";

export interface ReactionGroup {
  content: string;
  events: NostrEvent[];
  actors: string[];
  imageUrl?: string;
  shortcode?: string;
}

export interface InteractionDetailState {
  root: NostrEvent | null;
  reactions: ReactionGroup[];
  zaps: ParsedZapReceipt[];
  reposts: NostrEvent[];
  quoteEvents: NostrEvent[];
  quotedEvents: NostrEvent[];
  loading: boolean;
  error: string | null;
}

export interface InteractionDetailStore {
  state: InteractionDetailState;
  load(root: NostrEvent): void;
  destroy(): void;
}

function qTagIds(event: NostrEvent): string[] {
  return [...new Set(event.tags.filter((tag) => tag[0] === 'q' && tag[1]).map((tag) => tag[1]!))];
}

function interactionFilters(root: NostrEvent): NostrFilter[] {
  const rootAddress = rootAddressForZapTarget(root);
  const filters: NostrFilter[] = [
    { kinds: [KIND_REACTION], '#e': [root.id], limit: 200 },
    { kinds: [KIND_ZAP_RECEIPT], '#e': [root.id], limit: 200 },
    { kinds: [root.kind === KIND_TEXT_NOTE ? KIND_REPOST : KIND_GENERIC_REPOST], '#e': [root.id], limit: 200 },
    { '#q': [root.id], limit: 200 },
  ];

  if (rootAddress) {
    filters.push({ kinds: [KIND_ZAP_RECEIPT], '#a': [rootAddress], limit: 200 });
  }

  const quotedIds = qTagIds(root);
  if (quotedIds.length > 0) {
    filters.push({ ids: quotedIds, limit: quotedIds.length });
  }

  return filters;
}

function groupReactions(events: Iterable<NostrEvent>): ReactionGroup[] {
  const groups = new Map<string, NostrEvent[]>();
  for (const event of events) {
    const key = event.content || '+';
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([content, groupEvents]) => {
      const sortedEvents = groupEvents.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
      return {
        content,
        events: sortedEvents,
        actors: [...new Set(sortedEvents.map((event) => event.pubkey))],
        ...customEmojiForReaction(content, sortedEvents),
      };
    })
    .sort((a, b) => b.events.length - a.events.length || a.content.localeCompare(b.content));
}

function customEmojiForReaction(content: string, events: NostrEvent[]): Pick<ReactionGroup, 'imageUrl' | 'shortcode'> {
  const emoji = customEmojiForShortcodeContent(content, events.flatMap((event) => event.tags));
  if (!emoji) return {};
  return {
    shortcode: emoji.shortcode,
    ...(emoji.imageUrl ? { imageUrl: emoji.imageUrl } : {}),
  };
}

interface InteractionDetailContext {
  state: InteractionDetailState;
  sub: Subscription | null;
  reactionsById: Map<string, NostrEvent>;
  zapsById: Map<string, NostrEvent>;
  repostsById: Map<string, NostrEvent>;
  quoteEventsById: Map<string, NostrEvent>;
  quotedEventsById: Map<string, NostrEvent>;
  notify(): void;
}

const byCreatedAt = (a: NostrEvent, b: NostrEvent): number =>
  a.created_at - b.created_at || a.id.localeCompare(b.id);

function closeSub(ctx: InteractionDetailContext): void {
  ctx.sub?.close();
  ctx.sub = null;
}

function reset(ctx: InteractionDetailContext, root: NostrEvent): void {
  ctx.reactionsById.clear();
  ctx.zapsById.clear();
  ctx.repostsById.clear();
  ctx.quoteEventsById.clear();
  ctx.quotedEventsById.clear();
  ctx.state.root = root;
  ctx.state.reactions = [];
  ctx.state.zaps = [];
  ctx.state.reposts = [];
  ctx.state.quoteEvents = [];
  ctx.state.quotedEvents = [];
  ctx.state.loading = true;
  ctx.state.error = null;
}

function rebuild(ctx: InteractionDetailContext): void {
  ctx.state.reactions = groupReactions(ctx.reactionsById.values());
  ctx.state.zaps = summarizeZapReceipts(ctx.zapsById.values()).receipts;
  ctx.state.reposts = [...ctx.repostsById.values()].sort(byCreatedAt);
  ctx.state.quoteEvents = [...ctx.quoteEventsById.values()].sort(byCreatedAt);
  ctx.state.quotedEvents = [...ctx.quotedEventsById.values()].sort(byCreatedAt);
}

function applyEvent(ctx: InteractionDetailContext, root: NostrEvent, event: NostrEvent): void {
  const quotedIds = new Set(qTagIds(root));
  const rootAddress = rootAddressForZapTarget(root);

  if (event.kind === KIND_REACTION) {
    ctx.reactionsById.set(event.id, event);
  } else if (event.kind === KIND_ZAP_RECEIPT) {
    const zap = parseZapReceipt(event);
    if (zap && (zap.targetEventIds.includes(root.id) || (rootAddress && zap.targetAddresses.includes(rootAddress)))) {
      ctx.zapsById.set(event.id, event);
    }
  } else if (event.kind === (root.kind === KIND_TEXT_NOTE ? KIND_REPOST : KIND_GENERIC_REPOST)) {
    ctx.repostsById.set(event.id, event);
  } else if (event.tags.some((tag) => tag[0] === 'q' && tag[1] === root.id)) {
    ctx.quoteEventsById.set(event.id, event);
  } else if (quotedIds.has(event.id)) {
    ctx.quotedEventsById.set(event.id, event);
  }

  rebuild(ctx);
}

function load(ctx: InteractionDetailContext, root: NostrEvent): void {
  closeSub(ctx);
  reset(ctx, root);
  ctx.notify();

  ctx.sub = relay.subscribe(
    interactionFilters(root),
    (event: NostrEvent) => {
      applyEvent(ctx, root, event);
      ctx.notify();
    },
    () => {
      ctx.state.loading = false;
      rebuild(ctx);
      ctx.notify();
    },
  );
}

export function createInteractionDetailStore(onUpdate?: () => void): InteractionDetailStore {
  const ctx: InteractionDetailContext = {
    state: {
      root: null,
      reactions: [],
      zaps: [],
      reposts: [],
      quoteEvents: [],
      quotedEvents: [],
      loading: false,
      error: null,
    },
    sub: null,
    reactionsById: new Map<string, NostrEvent>(),
    zapsById: new Map<string, NostrEvent>(),
    repostsById: new Map<string, NostrEvent>(),
    quoteEventsById: new Map<string, NostrEvent>(),
    quotedEventsById: new Map<string, NostrEvent>(),
    notify: () => onUpdate?.(),
  };

  return {
    state: ctx.state,
    load: (root) => load(ctx, root),
    destroy: () => closeSub(ctx),
  };
}

export const __test__ = {
  interactionFilters,
  groupReactions,
  qTagIds,
};
