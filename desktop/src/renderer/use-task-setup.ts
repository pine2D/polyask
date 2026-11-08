import { useEffect, useRef, useState } from 'react';
import type { SiteDefinition } from '../shared/contracts';
import type { PromptTemplate } from '../shared/prompt-library';
import type { ActiveWorkspaceGroup } from '../shared/workspace';
import type { SiteRunResult, Tier } from '../shared/protocol';
import { sameTaskSites, taskSetupSourcesCurrent, type TaskSetupPlan } from '../shared/task-setup';
import type { ExclusiveActionLock } from './broadcast-flow-state';
import type { useSyncedSiteParticipation } from './use-synced-site-participation';
import type { DraftBlockingChange } from './use-draft-dialog';

interface TaskSetupOptions {
  readonly templates: readonly PromptTemplate[];
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly sites: readonly SiteDefinition[];
  readonly prompt: string;
  readonly imageCount: number;
  readonly getIntent: () => string;
  readonly busy: () => boolean;
  readonly lock: ExclusiveActionLock;
  readonly participation: ReturnType<typeof useSyncedSiteParticipation>;
  readonly changeTier: (tier: Tier) => Promise<readonly SiteRunResult[] | null>;
  readonly onApply: (text: string) => void;
  readonly onApplied?: () => void;
  readonly onBlockingChange: DraftBlockingChange;
}
export function useTaskSetup(options: TaskSetupOptions) {
  const latest = useRef(options); latest.current = options;
  const revision = useRef(0), inFlight = useRef(false), completed = useRef(false);
  const lease = useRef<{owner: symbol; release: DraftBlockingChange; intent: string} | null>(null);
  const [session, setSession] = useState<{prompt: string; imageCount: number; sites: readonly SiteDefinition['key'][]} | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState<'failed' | 'stale' | null>(null);
  useEffect(() => {
    if (session === null && completed.current) { completed.current = false; latest.current.onApplied?.(); }
  }, [session]);
  const close = () => {
    revision.current++;
    const current = lease.current; lease.current = null;
    current?.release(false, current.owner); setSession(null); setError(null);
  };
  useEffect(() => () => { const current = lease.current; lease.current = null; revision.current++; current?.release(false,current.owner); }, []);
  const edit = () => { revision.current++; setError(null); };
  const open = () => {
    const value = latest.current;
    if (lease.current || inFlight.current || value.busy() || value.lock.busy || value.participation.pending) return;
    const owner = Symbol('task-setup');
    // Covering native sites invalidates pending image reads; snapshot after acquiring the cover.
    value.onBlockingChange(true, owner);
    lease.current = {owner, release: value.onBlockingChange, intent: value.getIntent()};
    setSession({prompt:value.prompt, imageCount:value.imageCount, sites:[...value.participation.currentSites()]});
    setError(null);
  };
  const apply = async (plan: TaskSetupPlan): Promise<boolean> => {
    const initial = latest.current, current = lease.current;
    if (!current || inFlight.current) return false;
    const request = ++revision.current;
    const active = () => lease.current === current && request === revision.current && !latest.current.busy() &&
      latest.current.getIntent() === current.intent && taskSetupSourcesCurrent(plan, latest.current.templates, latest.current.groups);
    if (!active()) { setError('stale'); return false; }
    if (initial.lock.busy || initial.participation.pending || !plan.text.trim() || [...plan.text].length > 100_000 ||
      !plan.sites.length || new Set(plan.sites).size !== plan.sites.length || plan.sites.some(key => !initial.sites.some(site => site.key === key))) {
      setError('failed'); return false;
    }
    inFlight.current = true; setPending(true); setError(null);
    try {
      // Participation owns its open/save locks. An outer lock here would reject its own calls.
      const accepted = await initial.participation.change(plan.sites);
      if (!active()) { if (lease.current === current) setError('stale'); return false; }
      if (!accepted || !sameTaskSites(latest.current.participation.currentSites(), plan.sites)) { setError('failed'); return false; }
      if (plan.tier !== null) {
        const results = await initial.lock.run(() => latest.current.changeTier(plan.tier));
        if (!active()) { if (lease.current === current) setError('stale'); return false; }
        if (!results || !plan.sites.every(site => results.some(result => result.site === site && result.ok))) { setError('failed'); return false; }
      }
      if (!sameTaskSites(latest.current.participation.currentSites(), plan.sites)) { setError('stale'); return false; }
      latest.current.onApply(plan.text); completed.current = true; close(); return true;
    } catch {
      if (lease.current === current) setError(active() ? 'failed' : 'stale');
      return false;
    } finally { inFlight.current = false; setPending(false); }
  };
  return { session, pending, error, open, close, edit, apply };
}
