import { inc } from '@napplet/sdk';
import { noteViewerLoadTargetFromPayload } from '@hyprgate/utils';

export type IncEvent = Parameters<Parameters<typeof inc.on>[1]>[0];

export function noteTargetFromIncEvent(event: IncEvent): string | null {
  return noteViewerLoadTargetFromPayload(event.payload);
}
