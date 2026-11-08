import type { DesktopCopy } from './copy';
import { formatCopy } from './copy';
import { formatDateTime } from './format';
import type { AttemptObservation } from './question-observation';

export function observationDescription(observation: AttemptObservation | null | undefined, copy: DesktopCopy): string {
  if (!observation) return `${copy.observationTitle}: ${copy.observationMissing}`;
  const selection = observation.selection;
  const template = selection.outcome === 'preferred' ? copy.selectionPreferred
    : selection.outcome === 'alternative' ? copy.selectionAlternative
      : selection.outcome === 'mode_only' ? copy.selectionModeOnly : copy.selectionUnconfirmed;
  return `${copy.observationTitle}: ${formatCopy(template, { mode: copy[selection.requested], model: 'model' in selection ? selection.model : '' })}`;
}
export function observationTime(observation: AttemptObservation, copy: DesktopCopy, locale: string): string {
  return formatCopy(copy.observationAt, { time: formatDateTime(observation.observedAt, locale) });
}
