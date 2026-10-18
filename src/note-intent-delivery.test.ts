import { describe, expect, it } from 'vitest';
import { noteTargetFromIntentDelivery, type IntentDelivery } from './note-intent-delivery.js';

const target = 'a'.repeat(64);
function event(payload?: unknown): IntentDelivery {
  return { archetype: 'note', action: 'open', convention: 'napplet:note/open', sender: 'hyprgate-shell', ...(arguments.length > 0 ? { payload } : {}) };
}

describe('note canonical INTENT delivery adapter', () => {
  it.each(['warm direct', 'cold buffered delivery'])('normalizes a valid %s IntentDelivery once', (delivery) => {
    expect(delivery).toBeTruthy();
    expect(noteTargetFromIntentDelivery(event({ target: { type: 'event', id: target } }))).toBe(target);
  });

  it('rejects another role, action or convention even with a valid payload', () => {
    const valid = event({ target: { type: 'event', id: target } });
    expect(noteTargetFromIntentDelivery({ ...valid, archetype: 'unrelated' })).toBeNull();
    expect(noteTargetFromIntentDelivery({ ...valid, action: 'edit' })).toBeNull();
    expect(noteTargetFromIntentDelivery({ ...valid, convention: 'napplet:unrelated/open' })).toBeNull();
  });

  it('rejects absent and malformed payloads', () => {
    expect(noteTargetFromIntentDelivery(event())).toBeNull();
    expect(noteTargetFromIntentDelivery(event({ target: { type: 'event', id: 'not-an-id' } }))).toBeNull();
  });
});
