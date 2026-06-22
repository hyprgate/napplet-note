import type { NostrEvent, NostrFilter } from '@hyprgate/types';
import {
  KIND_NIP22_COMMENT,
  KIND_TEXT_NOTE,
  createKind1ReplyTags,
  createNip22CommentTags,
  parseNoteViewerReply,
  rootAddressForZapTarget,
  type NoteViewerTargetReference,
} from '@hyprgate/utils';
import { relay, type Subscription } from "@napplet/sdk";
import { buildThreadGraph, DEFAULT_THREAD_DEPTH, visibleThreadNodes, type ThreadGraph, type VisibleThreadNode } from './thread-graph.js';

export interface ReplyThreadState {
  root: NostrEvent | null;
  graph: ThreadGraph | null;
  visible: VisibleThreadNode[];
  ancestors: NostrEvent[];
  visibleAncestors: NostrEvent[];
  contextExpanded: boolean;
  contextLoading: boolean;
  contextError: string | null;
  rootEvent: NostrEvent | null;
  loading: boolean;
  error: string | null;
  activeComposerId: string | null;
  draft: string;
  publishing: boolean;
}

export interface ReplyThreadStore {
  state: ReplyThreadState;
  load(root: NostrEvent): void;
  toggleExpanded(nodeId: string): void;
  toggleContextExpanded(): void;
  openComposer(nodeId: string): void;
  closeComposer(): void;
  setDraft(value: string): void;
  publishResponse(parent: NostrEvent): Promise<NostrEvent | null>;
  destroy(): void;
}

function threadFilters(root: NostrEvent): NostrFilter[] {
  const filters: NostrFilter[] = [
    { kinds: [KIND_TEXT_NOTE], '#e': [root.id], limit: 200 },
    { kinds: [KIND_NIP22_COMMENT], '#E': [root.id], limit: 200 },
    { kinds: [KIND_NIP22_COMMENT], '#e': [root.id], limit: 200 },
  ];

  const rootAddress = rootAddressForZapTarget(root);
  if (rootAddress) {
    filters.push(
      { kinds: [KIND_NIP22_COMMENT], '#A': [rootAddress], limit: 200 },
      { kinds: [KIND_NIP22_COMMENT], '#a': [rootAddress], limit: 200 },
    );
  }

  return filters;
}

function responseTemplate(root: NostrEvent, parent: NostrEvent, content: string): { kind: number; content: string; tags: string[][]; created_at: number } {
  const now = Math.floor(Date.now() / 1000);
  const kind1Tags = root.kind === KIND_TEXT_NOTE || parent.kind === KIND_TEXT_NOTE
    ? createKind1ReplyTags({ root, parent })
    : null;

  if (kind1Tags) {
    return { kind: KIND_TEXT_NOTE, content, tags: kind1Tags, created_at: now };
  }

  const commentTags = createNip22CommentTags({ root, parent });
  if (!commentTags) {
    return { kind: KIND_TEXT_NOTE, content, tags: createKind1ReplyTags({ root, parent }), created_at: now };
  }

  return { kind: KIND_NIP22_COMMENT, content, tags: commentTags, created_at: now };
}

interface ReplyThreadContext {
  state: ReplyThreadState;
  events: Map<string, NostrEvent>;
  ancestorEvents: Map<string, NostrEvent>;
  expandedIds: Set<string>;
  sub: Subscription | null;
  ancestorSub: Subscription | null;
  requestedAncestorKeys: Set<string>;
  notify(): void;
}

interface BuiltContext {
  ancestors: NostrEvent[];
  visibleAncestors: NostrEvent[];
  rootEvent: NostrEvent | null;
  missingReferences: NoteViewerTargetReference[];
}

function rebuild(ctx: ReplyThreadContext): void {
  if (!ctx.state.root) return;
  ctx.state.graph = buildThreadGraph(ctx.state.root, [...ctx.events.values()]);
  ctx.state.visible = visibleThreadNodes(ctx.state.graph, ctx.expandedIds, DEFAULT_THREAD_DEPTH);
}

function parseAddress(address: string): { kind: number; pubkey: string; identifier: string } | null {
  const [rawKind, pubkey, ...identifierParts] = address.split(':');
  const kind = Number(rawKind);
  const identifier = identifierParts.join(':');
  if (!Number.isInteger(kind) || !pubkey || !identifier) return null;
  return { kind, pubkey, identifier };
}

function referenceKey(ref: NoteViewerTargetReference): string {
  return ref.type === 'event' ? `event:${ref.id}` : `address:${ref.address}`;
}

function referenceMatchesEvent(ref: NoteViewerTargetReference, event: NostrEvent): boolean {
  if (ref.type === 'event') return ref.id === event.id;
  return rootAddressForZapTarget(event) === ref.address;
}

function findEventForReference(ref: NoteViewerTargetReference, events: NostrEvent[]): NostrEvent | null {
  return events.find((event) => referenceMatchesEvent(ref, event)) ?? null;
}

function uniqueReferences(refs: NoteViewerTargetReference[]): NoteViewerTargetReference[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = referenceKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filtersForReferences(refs: NoteViewerTargetReference[]): NostrFilter[] {
  const eventIds: string[] = [];
  const filters: NostrFilter[] = [];

  for (const ref of refs) {
    if (ref.type === 'event') {
      eventIds.push(ref.id);
      continue;
    }

    const parsed = parseAddress(ref.address);
    if (!parsed) continue;
    filters.push({
      kinds: [parsed.kind],
      authors: [parsed.pubkey],
      '#d': [parsed.identifier],
      limit: 1,
    });
  }

  if (eventIds.length > 0) filters.unshift({ ids: [...new Set(eventIds)], limit: eventIds.length });
  return filters;
}

function buildContext(opened: NostrEvent, events: NostrEvent[], expanded: boolean): BuiltContext {
  const ancestorsClosestFirst: NostrEvent[] = [];
  const missingReferences: NoteViewerTargetReference[] = [];
  const seenEventIds = new Set([opened.id]);
  const seenReferenceKeys = new Set<string>();
  let current: NostrEvent | null = opened;
  const rootReference = parseNoteViewerReply(opened)?.root ?? null;

  for (let depth = 0; depth < 24 && current; depth++) {
    const reference = parseNoteViewerReply(current);
    if (!reference) break;
    const parentRef = reference.parent;
    if (referenceMatchesEvent(parentRef, current)) break;

    const key = referenceKey(parentRef);
    if (seenReferenceKeys.has(key)) break;
    seenReferenceKeys.add(key);

    const parent = findEventForReference(parentRef, events);
    if (!parent) {
      missingReferences.push(parentRef);
      break;
    }

    if (seenEventIds.has(parent.id)) break;
    ancestorsClosestFirst.push(parent);
    seenEventIds.add(parent.id);
    current = parent;
  }

  const allEvents = [opened, ...events];
  const rootEvent = rootReference ? findEventForReference(rootReference, allEvents) : null;
  if (rootReference && !rootEvent) missingReferences.push(rootReference);

  const ancestors = ancestorsClosestFirst.reverse();
  return {
    ancestors,
    visibleAncestors: expanded ? ancestors : ancestors.slice(-1),
    rootEvent,
    missingReferences: uniqueReferences(missingReferences),
  };
}

function contextReferences(root: NostrEvent, events: NostrEvent[]): NoteViewerTargetReference[] {
  return buildContext(root, events, true).missingReferences;
}

function contextFilters(root: NostrEvent, events: NostrEvent[] = []): NostrFilter[] {
  return filtersForReferences(contextReferences(root, events));
}

function rebuildContext(ctx: ReplyThreadContext): void {
  if (!ctx.state.root) return;
  const context = buildContext(ctx.state.root, [...ctx.ancestorEvents.values()], ctx.state.contextExpanded);
  ctx.state.ancestors = context.ancestors;
  ctx.state.visibleAncestors = context.visibleAncestors;
  ctx.state.rootEvent = context.rootEvent;
  if (context.missingReferences.length === 0) ctx.state.contextError = null;
}

function closeSub(ctx: ReplyThreadContext): void {
  ctx.sub?.close();
  ctx.sub = null;
}

function closeAncestorSub(ctx: ReplyThreadContext): void {
  ctx.ancestorSub?.close();
  ctx.ancestorSub = null;
}

function requestContext(ctx: ReplyThreadContext): void {
  if (!ctx.state.root) return;

  const refs = contextReferences(ctx.state.root, [...ctx.ancestorEvents.values()])
    .filter((ref) => !ctx.requestedAncestorKeys.has(referenceKey(ref)));
  const filters = contextFilters(ctx.state.root, [...ctx.ancestorEvents.values()])
    .filter((filter) => {
      if ('ids' in filter && Array.isArray(filter.ids)) {
        return filter.ids.some((id) => refs.some((ref) => ref.type === 'event' && ref.id === id));
      }
      return refs.some((ref) => {
        if (ref.type !== 'address') return false;
        const parsed = parseAddress(ref.address);
        return parsed !== null
          && filter.kinds?.[0] === parsed.kind
          && filter.authors?.[0] === parsed.pubkey
          && filter['#d']?.[0] === parsed.identifier;
      });
    });

  if (filters.length === 0) {
    ctx.state.contextLoading = contextReferences(ctx.state.root, [...ctx.ancestorEvents.values()]).length > 0;
    return;
  }

  for (const ref of refs) ctx.requestedAncestorKeys.add(referenceKey(ref));
  closeAncestorSub(ctx);
  ctx.state.contextLoading = true;

  ctx.ancestorSub = relay.subscribe(
    filters,
    (event: NostrEvent) => {
      if (!ctx.ancestorEvents.has(event.id)) {
        ctx.ancestorEvents.set(event.id, event);
        rebuildContext(ctx);
        requestContext(ctx);
        ctx.notify();
      }
    },
    () => {
      const missing = ctx.state.root ? contextReferences(ctx.state.root, [...ctx.ancestorEvents.values()]) : [];
      ctx.state.contextLoading = missing.some((ref) => !ctx.requestedAncestorKeys.has(referenceKey(ref)));
      rebuildContext(ctx);
      if (missing.length > 0 && !ctx.state.contextLoading) {
        ctx.state.contextError = 'Some thread context was not returned by the shell relay.';
      }
      ctx.notify();
    },
  );
}

function load(ctx: ReplyThreadContext, root: NostrEvent): void {
  closeSub(ctx);
  closeAncestorSub(ctx);
  ctx.events.clear();
  ctx.ancestorEvents.clear();
  ctx.expandedIds.clear();
  ctx.requestedAncestorKeys.clear();
  ctx.state.root = root;
  ctx.state.graph = buildThreadGraph(root, []);
  ctx.state.visible = [];
  ctx.state.ancestors = [];
  ctx.state.visibleAncestors = [];
  ctx.state.contextExpanded = false;
  ctx.state.contextLoading = false;
  ctx.state.contextError = null;
  ctx.state.rootEvent = null;
  ctx.state.loading = true;
  ctx.state.error = null;
  ctx.state.activeComposerId = null;
  ctx.state.draft = '';
  rebuildContext(ctx);
  requestContext(ctx);
  ctx.notify();

  ctx.sub = relay.subscribe(
    threadFilters(root),
    (event: NostrEvent) => {
      if (!ctx.events.has(event.id)) {
        ctx.events.set(event.id, event);
        rebuild(ctx);
        ctx.notify();
      }
    },
    () => {
      ctx.state.loading = false;
      rebuild(ctx);
      ctx.notify();
    },
  );
}

async function publishResponse(ctx: ReplyThreadContext, parent: NostrEvent): Promise<NostrEvent | null> {
  if (!ctx.state.root || ctx.state.publishing) return null;
  const content = ctx.state.draft.trim();
  if (!content) return null;

  ctx.state.publishing = true;
  ctx.state.error = null;
  ctx.notify();

  try {
    const published = await relay.publish(responseTemplate(ctx.state.root, parent, content)) as NostrEvent;
    ctx.events.set(published.id, published);
    ctx.expandedIds.add(parent.id);
    rebuild(ctx);
    ctx.state.activeComposerId = null;
    ctx.state.draft = '';
    ctx.state.publishing = false;
    ctx.notify();
    return published;
  } catch (error) {
    ctx.state.error = error instanceof Error ? error.message : 'Failed to publish response.';
    ctx.state.publishing = false;
    ctx.notify();
    return null;
  }
}

export function createReplyThreadStore(onUpdate?: () => void): ReplyThreadStore {
  const ctx: ReplyThreadContext = {
    state: {
      root: null,
      graph: null,
      visible: [],
      ancestors: [],
      visibleAncestors: [],
      contextExpanded: false,
      contextLoading: false,
      contextError: null,
      rootEvent: null,
      loading: false,
      error: null,
      activeComposerId: null,
      draft: '',
      publishing: false,
    },
    events: new Map<string, NostrEvent>(),
    ancestorEvents: new Map<string, NostrEvent>(),
    expandedIds: new Set<string>(),
    sub: null,
    ancestorSub: null,
    requestedAncestorKeys: new Set<string>(),
    notify: () => onUpdate?.(),
  };

  return {
    state: ctx.state,
    load: (root) => load(ctx, root),
    toggleExpanded(nodeId: string): void {
      if (ctx.expandedIds.has(nodeId)) ctx.expandedIds.delete(nodeId);
      else ctx.expandedIds.add(nodeId);
      rebuild(ctx);
      ctx.notify();
    },
    toggleContextExpanded(): void {
      ctx.state.contextExpanded = !ctx.state.contextExpanded;
      rebuildContext(ctx);
      ctx.notify();
    },
    openComposer(nodeId: string): void {
      ctx.state.activeComposerId = nodeId;
      ctx.state.draft = '';
      ctx.notify();
    },
    closeComposer(): void {
      ctx.state.activeComposerId = null;
      ctx.state.draft = '';
      ctx.notify();
    },
    setDraft(value: string): void {
      ctx.state.draft = value;
      ctx.notify();
    },
    publishResponse: (parent) => publishResponse(ctx, parent),
    destroy: () => {
      closeSub(ctx);
      closeAncestorSub(ctx);
    },
  };
}

export const __test__ = {
  threadFilters,
  contextFilters,
  buildContext,
  responseTemplate,
};
