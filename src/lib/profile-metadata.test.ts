import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { outbox, relay } from '@napplet/sdk';
import { subscribeProfileMetadata } from './profile-metadata.js';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn(),
  },
  outbox: {
    subscribe: vi.fn(),
  },
}));

interface FakeOutboxSub {
  close: ReturnType<typeof vi.fn>;
  handlers: Record<string, ((...args: unknown[]) => void) | undefined>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

function makeOutboxSub(): FakeOutboxSub {
  return {
    close: vi.fn(),
    handlers: {},
    on(event, cb) {
      this.handlers[event] = cb;
    },
    emit(event, ...args) {
      this.handlers[event]?.(...args);
    },
  };
}

function installShell(supportsOutbox = true): void {
  (globalThis as unknown as { napplet: unknown }).napplet = {
    shell: {
      ready: vi.fn().mockResolvedValue({}),
      supports: vi.fn((domain: string) => (domain === 'outbox' ? supportsOutbox : false)),
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeProfileEvent(pubkey: string, createdAt: number, content: unknown): NostrEvent {
  return {
    id: `${pubkey}-${createdAt}`,
    kind: 0,
    pubkey,
    created_at: createdAt,
    tags: [],
    content: typeof content === 'string' ? content : JSON.stringify(content),
    sig: 'sig',
  };
}

describe('note viewer profile metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    vi.mocked(outbox.subscribe).mockReturnValue(
      makeOutboxSub() as unknown as ReturnType<typeof outbox.subscribe>,
    );
    installShell();
  });

  afterEach(() => {
    delete (globalThis as unknown as { napplet?: unknown }).napplet;
  });

  it('uses the outbox kind-0 rail when shell supports NAP-OUTBOX', async () => {
    const sub = makeOutboxSub();
    vi.mocked(outbox.subscribe).mockImplementation((filters, options) => {
      expect(filters).toEqual([{ kinds: [0], authors: ['pk1'], limit: 1 }]);
      expect(options).toEqual({ strategy: 'outbox', live: false });
      return sub as unknown as ReturnType<typeof outbox.subscribe>;
    });
    const received: Array<[string, string | undefined]> = [];
    const done = vi.fn();

    const handle = subscribeProfileMetadata(['pk1'], (pubkey, profile) => {
      received.push([pubkey, profile.display_name]);
    }, done);
    await flush();

    expect(relay.subscribe).not.toHaveBeenCalled();
    sub.emit('event', { event: makeProfileEvent('pk1', 100, {
      display_name: 'YakiHonne',
      picture: 'https://example.test/yaki.png',
    }) });
    sub.emit('closed');

    expect(received).toEqual([['pk1', 'YakiHonne']]);
    expect(done).toHaveBeenCalledOnce();

    handle.close();
    expect(sub.close).toHaveBeenCalledOnce();
  });

  it('falls back to relay.subscribe only when outbox is unavailable', async () => {
    installShell(false);
    let onEvent: ((result: { event: NostrEvent }) => void) | undefined;
    vi.mocked(relay.subscribe).mockImplementation((filters, eventCb) => {
      expect(filters).toEqual([{ kinds: [0], authors: ['pk1'], limit: 1 }]);
      onEvent = eventCb as (result: { event: NostrEvent }) => void;
      return { close: vi.fn() };
    });
    const received: Array<[string, string | undefined]> = [];

    subscribeProfileMetadata(['pk1'], (pubkey, profile) => {
      received.push([pubkey, profile.name]);
    });
    await flush();

    expect(outbox.subscribe).not.toHaveBeenCalled();
    onEvent?.({ event: makeProfileEvent('pk1', 100, { name: 'Fallback Name' }) });

    expect(received).toEqual([['pk1', 'Fallback Name']]);
  });

  it('keeps the newest profile and ignores malformed kind-0 content', async () => {
    const sub = makeOutboxSub();
    vi.mocked(outbox.subscribe).mockReturnValue(sub as unknown as ReturnType<typeof outbox.subscribe>);
    const received: string[] = [];

    subscribeProfileMetadata(['pk1'], (_pubkey, profile) => {
      if (profile.name) received.push(profile.name);
    });
    await flush();

    sub.emit('event', { event: makeProfileEvent('pk1', 200, { name: 'new' }) });
    sub.emit('event', { event: makeProfileEvent('pk1', 100, { name: 'old' }) });
    sub.emit('event', { event: makeProfileEvent('pk1', 300, '{malformed') });

    expect(received).toEqual(['new']);
  });
});
