import { SITE_KEYS, type SiteKey } from './contracts';
import { questionIdValid } from './question-history';
import { normalizeTierSelection, type TierSelection } from './selection';
import { validSyncTime } from './sync';

/** Webpage observation from this dispatch, never proof of the server-side model. */
export interface AttemptObservation {
  readonly questionId: string;
  readonly site: SiteKey;
  readonly attempt: number;
  readonly observedAt: number;
  readonly selection: TierSelection;
}
export function isAttemptObservation(value: unknown): value is AttemptObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 5 || !questionIdValid(v.questionId) || !SITE_KEYS.includes(v.site as SiteKey) ||
    !Number.isSafeInteger(v.attempt) || Number(v.attempt) < 1 || !validSyncTime(v.observedAt)) return false;
  const normalized = normalizeTierSelection(v.selection);
  if (!normalized || !v.selection || typeof v.selection !== 'object') return false;
  const candidate = v.selection as Record<string, unknown>;
  return Object.keys(candidate).length === Object.keys(normalized).length &&
    Object.entries(normalized).every(([key, field]) => candidate[key] === field);
}
