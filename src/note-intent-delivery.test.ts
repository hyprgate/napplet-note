import { describe, expect, it } from 'vitest';
import { noteTargetFromIncEvent, type IncEvent } from './note-intent-delivery.js';

const target = 'a'.repeat(64);
function event(payload?: unknown): IncEvent {
  return { topic: 'note:open', sender: 'hyprgate-shell', ...(arguments.length > 0 ? { payload } : {}) };
}

describe('note canonical INC delivery adapter', () => {
  it.each(['warm direct', 'cold post-ready replay'])('normalizes a valid %s IncEvent once', (delivery) => {
    expect(delivery).toBeTruthy();
    expect(noteTargetFromIncEvent(event({ target: { type: 'event', id: target } }))).toBe(target);
  });

  it('rejects absent and malformed payloads', () => {
    expect(noteTargetFromIncEvent(event())).toBeNull();
    expect(noteTargetFromIncEvent(event({ target: { type: 'event', id: 'not-an-id' } }))).toBeNull();
  });
});
