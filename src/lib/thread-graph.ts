import type { NostrEvent } from '@hyprgate/types';
import { parseNoteViewerReply, rootAddressForZapTarget, type NoteViewerReplyReference } from '@hyprgate/utils';

export interface ThreadNode {
  id: string;
  event: NostrEvent;
  reference: NoteViewerReplyReference;
  parentId: string;
  children: ThreadNode[];
  orphaned: boolean;
  cycle: boolean;
}

export interface ThreadGraph {
  root: NostrEvent;
  nodes: Map<string, ThreadNode>;
  rootChildren: ThreadNode[];
  orphans: ThreadNode[];
}

export interface VisibleThreadNode {
  node: ThreadNode;
  depth: number;
  hiddenChildCount: number;
  expandable: boolean;
}

export const DEFAULT_THREAD_DEPTH = 2;

interface ThreadCandidate {
  event: NostrEvent;
  reference: NoteViewerReplyReference;
  rootMatchesOpenedRoot: boolean;
  parentId: string;
}

function eventRefId(ref: NoteViewerReplyReference['root'] | NoteViewerReplyReference['parent']): string | null {
  return ref.type === 'event' ? ref.id : null;
}

function addressRefMatches(ref: NoteViewerReplyReference['root'] | NoteViewerReplyReference['parent'], address: string | null): boolean {
  return ref.type === 'address' && address !== null && ref.address === address;
}

function refMatchesOpenedRoot(
  ref: NoteViewerReplyReference['root'] | NoteViewerReplyReference['parent'],
  root: NostrEvent,
  rootAddress: string | null,
): boolean {
  return eventRefId(ref) === root.id || addressRefMatches(ref, rootAddress);
}

function parentIdForReference(
  ref: NoteViewerReplyReference['parent'],
  root: NostrEvent,
  rootAddress: string | null,
): string | null {
  const eventId = eventRefId(ref);
  if (eventId) return eventId;
  return addressRefMatches(ref, rootAddress) ? root.id : null;
}

function compareEvents(a: ThreadNode, b: ThreadNode): number {
  if (a.event.created_at !== b.event.created_at) return a.event.created_at - b.event.created_at;
  return a.id.localeCompare(b.id);
}

function wouldCreateCycle(nodeId: string, parentId: string, parentById: Map<string, string>): boolean {
  let current: string | undefined = parentId;
  const seen = new Set<string>();

  while (current) {
    if (current === nodeId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentById.get(current);
  }

  return false;
}

export function buildThreadGraph(root: NostrEvent, events: NostrEvent[]): ThreadGraph {
  const rootAddress = rootAddressForZapTarget(root);
  const uniqueEvents = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.id === root.id || uniqueEvents.has(event.id)) continue;
    uniqueEvents.set(event.id, event);
  }

  const candidates = new Map<string, ThreadCandidate>();
  const nodes = new Map<string, ThreadNode>();
  const parentById = new Map<string, string>();

  for (const event of uniqueEvents.values()) {
    const reference = parseNoteViewerReply(event);
    if (!reference) continue;

    const rootMatchesOpenedRoot = refMatchesOpenedRoot(reference.root, root, rootAddress);
    const parentId = parentIdForReference(reference.parent, root, rootAddress);
    if (!parentId) continue;

    candidates.set(event.id, { event, reference, rootMatchesOpenedRoot, parentId });
  }

  function connectsToOpenedRoot(candidate: ThreadCandidate, seen = new Set<string>()): boolean {
    if (candidate.rootMatchesOpenedRoot || candidate.parentId === root.id) return true;
    if (seen.has(candidate.event.id)) return false;
    seen.add(candidate.event.id);
    const parentCandidate = candidates.get(candidate.parentId);
    return parentCandidate ? connectsToOpenedRoot(parentCandidate, seen) : false;
  }

  for (const candidate of candidates.values()) {
    if (!connectsToOpenedRoot(candidate)) continue;

    nodes.set(candidate.event.id, {
      id: candidate.event.id,
      event: candidate.event,
      reference: candidate.reference,
      parentId: candidate.parentId,
      children: [],
      orphaned: false,
      cycle: false,
    });
    parentById.set(candidate.event.id, candidate.parentId);
  }

  const rootChildren: ThreadNode[] = [];
  const orphans: ThreadNode[] = [];

  for (const node of nodes.values()) {
    const parentNode = nodes.get(node.parentId);
    const isRootChild = node.parentId === root.id;
    const isCycle = !isRootChild && wouldCreateCycle(node.id, node.parentId, parentById);

    if (isRootChild) {
      rootChildren.push(node);
      continue;
    }

    if (!parentNode || isCycle) {
      node.orphaned = true;
      node.cycle = isCycle;
      orphans.push(node);
      continue;
    }

    parentNode.children.push(node);
  }

  for (const node of nodes.values()) {
    node.children.sort(compareEvents);
  }
  rootChildren.sort(compareEvents);
  orphans.sort(compareEvents);

  return { root, nodes, rootChildren, orphans };
}

export function visibleThreadNodes(
  graph: ThreadGraph,
  expandedIds: ReadonlySet<string>,
  defaultDepth = DEFAULT_THREAD_DEPTH,
): VisibleThreadNode[] {
  const visible: VisibleThreadNode[] = [];

  function visit(node: ThreadNode, depth: number): void {
    const expanded = expandedIds.has(node.id);
    const withinDefaultDepth = depth < defaultDepth;
    const showChildren = expanded || withinDefaultDepth;
    visible.push({
      node,
      depth,
      expandable: node.children.length > 0 && !showChildren,
      hiddenChildCount: showChildren ? 0 : node.children.length,
    });

    if (!showChildren) return;
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  }

  for (const child of graph.rootChildren) visit(child, 1);
  for (const orphan of graph.orphans) visit(orphan, 1);

  return visible;
}
