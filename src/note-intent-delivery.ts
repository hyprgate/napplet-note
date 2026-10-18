import { intent } from '@napplet/sdk';
import { noteViewerLoadTargetFromPayload } from '@hyprgate/utils';

export type IntentDelivery = Parameters<Parameters<typeof intent.onDelivery>[0]>[0];

export function noteTargetFromIntentDelivery(event: IntentDelivery): string | null {
  if (event.archetype !== 'note' || event.action !== 'open' || event.convention !== 'napplet:note/open') return null;
  return noteViewerLoadTargetFromPayload(event.payload);
}
