import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { nip19 } from 'nostr-tools';
import { relay, intent } from '@napplet/sdk';
import App from './App.svelte';

vi.mock('@napplet/sdk', () => ({
  relay: { subscribe: vi.fn(), publish: vi.fn() },
  identity: { getPublicKey: vi.fn().mockResolvedValue(null) },
  inc: { on: vi.fn(() => ({ close: vi.fn() })), emit: vi.fn() },
  intent: { invoke: vi.fn(), onDelivery: vi.fn(() => ({ close: vi.fn() })) },
  link: { open: vi.fn() },
  outbox: { subscribe: vi.fn() },
}));

const EVENT_ID = 'a'.repeat(64);
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  vi.mocked(relay.subscribe).mockReset().mockReturnValue({ close: vi.fn() });
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  vi.clearAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor);
  else Reflect.deleteProperty(document, 'execCommand');
});

describe('Note Reader INTENT startup', () => {
  it('keeps a buffered target delivered during subscription ahead of empty startup state', async () => {
    vi.mocked(intent.onDelivery).mockImplementationOnce(callback => {
      callback({ archetype: 'note', action: 'open', convention: 'napplet:note/open',
        sender: 'host', payload: { target: { type: 'event', id: EVENT_ID } } });
      return { close: vi.fn() };
    });
    app = mount(App, { target: document.body });
    await tick();
    expect(document.querySelector('.target-input')).toBeNull();
    expect(relay.subscribe).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ ids: [EVENT_ID] }),
    ]), expect.any(Function), expect.anything());
  });
});

describe('Note Reader visible copy action', () => {
  async function loadedCopyButton(): Promise<HTMLButtonElement> {
    await renderInput(EVENT_ID);
    document.querySelector<HTMLButtonElement>('.load-button')!.click();
    vi.mocked(relay.subscribe).mock.calls[0]![1]({
      event: {
        id: EVENT_ID, pubkey: 'b'.repeat(64), kind: 1, created_at: 1_700_000_000,
        tags: [], content: 'A note ready to share.', sig: 'c'.repeat(128),
      },
      sidecar: { relayHints: ['wss://observed.example'] },
    });
    await tick();
    return document.querySelector<HTMLButtonElement>('.note-actions button')!;
  }

  it.each([
    [true, 'copied'],
    [false, 'failed'],
    ['throw', 'failed'],
  ] as const)('falls back after Clipboard API rejection and reports execCommand=%s honestly', async (result, label) => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Clipboard is blocked by permissions policy', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const selections: Array<{ value: string; focused: boolean; start: number; end: number }> = [];
    const execCommand = vi.fn(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[readonly]')!;
      selections.push({ value: input.value, focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd });
      if (result === 'throw') throw new Error('Copy command unavailable');
      return result;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const button = await loadedCopyButton();
    button.focus();
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe(label));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    expect(selections).toEqual([{ value: writeText.mock.calls[0]![0], focused: true, start: 0, end: writeText.mock.calls[0]![0].length }]);
    expect(nip19.decode(selections[0]!.value)).toEqual({
      type: 'nevent',
      data: { id: EVENT_ID, author: 'b'.repeat(64), kind: 1, relays: ['wss://observed.example'] },
    });
    expect(document.querySelector('textarea[readonly]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('keeps successful Clipboard API writes on the normal path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const execCommand = vi.fn();
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const button = await loadedCopyButton();
    button.focus();
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe('copied'));

    expect(nip19.decode(writeText.mock.calls[0]![0])).toMatchObject({
      type: 'nevent', data: { id: EVENT_ID, relays: ['wss://observed.example'] },
    });
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[readonly]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

async function renderInput(value: string): Promise<HTMLInputElement> {
  app = mount(App, { target: document.body });
  await tick();
  const input = document.querySelector<HTMLInputElement>('.target-input')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  return input;
}

describe('Note Reader manual target entry', () => {
  it.each([EVENT_ID, nip19.noteEncode(EVENT_ID)])('loads %s from the visible button without native form submission', async (input) => {
    await renderInput(input);
    const form = document.querySelector('form')!;
    const blockedSubmit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    // Model the opaque iframe's blocked native submission before Svelte's
    // delegated submit handler. The click must call the app's loader directly.
    form.addEventListener('submit', blockedSubmit, { capture: true });
    const button = document.querySelector<HTMLButtonElement>('.load-button')!;
    expect(button.textContent).toBe('Load');
    button.click();
    await tick();

    expect(relay.subscribe).toHaveBeenCalledExactlyOnceWith(
      [{ ids: [EVENT_ID], limit: 1 }], expect.any(Function), expect.any(Function),
    );
    expect(blockedSubmit).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Loading');
    button.click();
    await tick();
    expect(relay.subscribe).toHaveBeenCalledTimes(1);
  });

  it('retains the Enter-key path and avoids duplicate loads while pending', async () => {
    const input = await renderInput(EVENT_ID);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(relay.subscribe).toHaveBeenCalledExactlyOnceWith(
      [{ ids: [EVENT_ID], limit: 1 }], expect.any(Function), expect.any(Function),
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(relay.subscribe).toHaveBeenCalledTimes(1);
  });
});
