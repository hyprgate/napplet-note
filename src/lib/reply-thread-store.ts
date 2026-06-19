import type { NostrEvent, NostrFilter } from '@hyprgate/types';
import {
  KIND_NIP22_COMMENT,
  KIND_TEXT_NOTE,
  createKind1ReplyTags,
  createNip22CommentTags,
  rootAddressForZapTarget,
} from '@hyprgate/utils';
import { relay, type Subscription } from "@napplet/sdk";
import { buildThreadGraph, DEFAULT_THREAD_DEPTH, visibleThreadNodes, type ThreadGraph, type VisibleThreadNode } from './thread-graph.js';

export interface ReplyThreadState {
  root: NostrEvent | null;
  graph: ThreadGraph | null;
  visible: VisibleThreadNode[];
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
  expandedIds: Set<string>;
  sub: Subscription | null;
  notify(): void;
}

function rebuild(ctx: ReplyThreadContext): void {
  if (!ctx.state.root) return;
  ctx.state.graph = buildThreadGraph(ctx.state.root, [...ctx.events.values()]);
  ctx.state.visible = visibleThreadNodes(ctx.state.graph, ctx.expandedIds, DEFAULT_THREAD_DEPTH);
}

function closeSub(ctx: ReplyThreadContext): void {
  ctx.sub?.close();
  ctx.sub = null;
}

function load(ctx: ReplyThreadContext, root: NostrEvent): void {
  closeSub(ctx);
  ctx.events.clear();
  ctx.expandedIds.clear();
  ctx.state.root = root;
  ctx.state.graph = buildThreadGraph(root, []);
  ctx.state.visible = [];
  ctx.state.loading = true;
  ctx.state.error = null;
  ctx.state.activeComposerId = null;
  ctx.state.draft = '';
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
      loading: false,
      error: null,
      activeComposerId: null,
      draft: '',
      publishing: false,
    },
    events: new Map<string, NostrEvent>(),
    expandedIds: new Set<string>(),
    sub: null,
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
    destroy: () => closeSub(ctx),
  };
}

export const __test__ = {
  threadFilters,
  responseTemplate,
};
