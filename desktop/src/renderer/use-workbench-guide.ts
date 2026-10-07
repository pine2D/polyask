import { useEffect, useRef, useState } from 'react';
import type { DisplayPreferences } from '../shared/display';
import { readLocalUiPreferences, writeWorkbenchGuidePreference, type LocalUiStorage, type WorkbenchGuidePreference } from './local-ui-preferences';
import { latestGuideAnswers, projectWorkbenchGuide, type WorkbenchGuideInput } from './workbench-guide-model';

export interface GuideNavigationRequest {
  readonly request: number; readonly runId: string; readonly questionId: string;
  readonly mode: 'read' | 'compare'; readonly answerIds: readonly string[];
}
export interface WorkbenchGuideOptions extends Omit<WorkbenchGuideInput, 'preference' | 'dismissed'> {
  readonly storage: LocalUiStorage; readonly fallbackDisplay: DisplayPreferences;
  readonly onPersistenceFailure: () => void;
  readonly onNavigate: (request: GuideNavigationRequest) => void;
}
function scopeIdentity(input: WorkbenchGuideInput): string {
  return JSON.stringify([input.ready, input.runId, input.activeSites, input.progress?.runId, input.progress?.questionId,
    input.progress?.state, latestGuideAnswers(input).map(answer => [answer.site, answer.id, answer.attempt])]);
}
export function useWorkbenchGuide(options: WorkbenchGuideOptions) {
  const latest = useRef(options); latest.current = options;
  const [preference, setPreference] = useState(() => readLocalUiPreferences(options.storage, options.fallbackDisplay).workbenchGuide);
  const [dismissed, setDismissed] = useState(false), [, refresh] = useState(0);
  const preferenceRef = useRef(preference); preferenceRef.current = preference;
  const hidden = useRef(!!preference), mounted = useRef(true), sequence = useRef(0);
  const pending = useRef<{ value: GuideNavigationRequest; scope: string } | null>(null);
  const currentInput = (): WorkbenchGuideInput => ({ ...latest.current, preference: preferenceRef.current, dismissed: hidden.current });
  const identity = scopeIdentity(currentInput()), observed = useRef(identity);
  // Notice A→B→A synchronously on each accepted render, before a child ready callback.
  if (observed.current !== identity) { observed.current = identity; pending.current = null; sequence.current++; }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; sequence.current++; };
  }, []);
  const model = projectWorkbenchGuide({ ...options, preference, dismissed });
  const persist = (disposition: WorkbenchGuidePreference['disposition']): boolean => {
    const next = { version: 1, disposition } as const;
    hidden.current = true; preferenceRef.current = next; pending.current = null;
    setDismissed(true); setPreference(next); refresh(value => value + 1);
    const saved = writeWorkbenchGuidePreference(latest.current.storage, next, latest.current.fallbackDisplay);
    if (!saved) latest.current.onPersistenceFailure();
    return saved;
  };
  const cancelNavigation = (request?: number): boolean => {
    if (!pending.current || (request !== undefined && request !== pending.current.value.request)) return false;
    pending.current = null; sequence.current++; refresh(value => value + 1); return true;
  };
  const navigate = (mode: GuideNavigationRequest['mode']): GuideNavigationRequest | null => {
    if (!mounted.current || hidden.current || pending.current || latest.current.busy) return null;
    const current = projectWorkbenchGuide(currentInput()), target = current.target;
    if (!target || (mode === 'compare' && current.stage !== 'compare')) return null;
    const answerIds = mode === 'read' ? target.readableIds.slice(0, 1) : target.completeIds.slice(0, 2);
    if (answerIds.length !== (mode === 'read' ? 1 : 2) || answerIds.some(id => !id.trim())) return null;
    const value = { request: ++sequence.current, runId: target.runId, questionId: target.questionId, mode, answerIds };
    pending.current = { value, scope: scopeIdentity(currentInput()) }; refresh(value => value + 1);
    try { latest.current.onNavigate(value); return value; }
    catch { cancelNavigation(value.request); return null; }
  };
  const acknowledge = (questionId: string, request: number, mode: GuideNavigationRequest['mode'], archiveId?: string): boolean => {
    const navigation = pending.current;
    if (!mounted.current || hidden.current || !navigation || navigation.value.request !== request ||
      navigation.value.questionId !== questionId || navigation.value.mode !== mode ||
      navigation.scope !== scopeIdentity(currentInput()) || (mode === 'compare' && !archiveId?.trim())) return false;
    // The pending UI gate may still be held when actual reading/compare becomes ready.
    const current = projectWorkbenchGuide({ ...currentInput(), busy: false }), target = current.target;
    const ids = mode === 'read' ? target?.readableIds : target?.completeIds;
    if (!target || target.runId !== navigation.value.runId || target.questionId !== questionId ||
      !navigation.value.answerIds.length || !navigation.value.answerIds.every(id => ids?.includes(id))) return false;
    persist('completed'); return true;
  };
  return { model, pendingNavigation: pending.current?.value ?? null, navigate, cancelNavigation,
    dismiss: (): boolean => mounted.current && !hidden.current ? persist('dismissed') : false,
    acknowledgeRead: (questionId: string, request: number): boolean => acknowledge(questionId, request, 'read'),
    acknowledgeCompare: (questionId: string, request: number, archiveId: string): boolean => acknowledge(questionId, request, 'compare', archiveId),
    // Successful local reset owns persistent field removal; this only resets its session.
    invalidate: (): void => {
      pending.current = null; sequence.current++; hidden.current = false; preferenceRef.current = null;
      setPreference(null); setDismissed(false); refresh(value => value + 1);
    } };
}
