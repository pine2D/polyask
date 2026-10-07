import { useEffect, useRef, useState } from 'react';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import type { DesktopCopy } from '../shared/copy';
import type { ExclusiveActionLock } from './broadcast-flow-state';
import type { useBroadcastFlow } from './use-broadcast-flow';
import { BroadcastRetryReview } from './broadcast-retry-review';

interface Review { runId: string; sites: readonly SiteKey[]; selected: readonly SiteKey[] }

export function useBroadcastRetryReview(options: {
  copy: DesktopCopy; sites: readonly SiteDefinition[]; flow: ReturnType<typeof useBroadcastFlow>;
  lock: ExclusiveActionLock; busy: boolean; onOpen: () => void; onClose: () => void; onInspect: (site: SiteKey, active: () => boolean) => unknown;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const inspection = useRef(0), inspectionPending = useRef(false), mounted = useRef(true);
  const latest = useRef(options); latest.current = options;
  const snapshot = useRef(review); snapshot.current = review;
  const commit = (value: Review | null) => { snapshot.current = value; setReview(value); };
  const close = () => { inspection.current++; inspectionPending.current = false; setInspecting(false); commit(null); latest.current.onClose(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; inspection.current++; }; }, []);
  useEffect(() => {
    if (snapshot.current && snapshot.current.runId !== options.flow.runId) close();
  }, [options.flow.runId]);
  const inspect = async (site: SiteKey) => {
    if (latest.current.busy || inspectionPending.current || !snapshot.current) return;
    inspectionPending.current = true; setInspecting(true);
    const ticket = ++inspection.current, runId = snapshot.current.runId;
    const active = () => mounted.current && ticket === inspection.current && latest.current.flow.runId === runId;
    try { await latest.current.onInspect(site, active); }
    finally { if (active()) close(); }
  };
  const confirm = () => {
    const current = latest.current, value = snapshot.current;
    if (!value || current.busy || inspectionPending.current || value.runId !== current.flow.runId) return;
    const selected = value.selected.filter(site => current.flow.uncertainSites.includes(site));
    if (!selected.length) return;
    close();
    void current.lock.run(() => latest.current.flow.retry(selected, true, value.runId));
  };
  const open = (onlySite?: SiteKey) => {
    const current = latest.current;
    if (current.busy || inspectionPending.current || !current.flow.runId || snapshot.current) return;
    const sites = current.flow.uncertainSites.filter(site => !onlySite || site === onlySite);
    if (!sites.length) return;
    commit({runId: current.flow.runId, sites, selected: []}); current.onOpen();
  };
  const request = (site?: SiteKey) => {
    const current = latest.current;
    if (current.busy || inspectionPending.current || !current.flow.runId) return;
    if (site ? current.flow.uncertainSites.includes(site) : !current.flow.failureCount) { open(site); return; }
    current.onClose();
    const runId = current.flow.runId;
    void current.lock.run(() => latest.current.flow.retry(site, false, runId));
  };
  const active = review?.runId === options.flow.runId ? review : null;
  const sites = active?.sites.filter(site => options.flow.uncertainSites.includes(site)) ?? [];
  const selected = active?.selected.filter(site => sites.includes(site)) ?? [];
  return { open: !!active, request, reviewUncertain: () => open(), review: active ? <BroadcastRetryReview
    copy={options.copy} sites={sites.map(key => options.sites.find(site => site.key === key)!).filter(Boolean)} selected={selected}
    busy={options.busy || inspecting} inspecting={inspecting} onCancel={close} onInspect={site => { void inspect(site); }} onConfirm={confirm}
    onToggle={site => {
      const current = snapshot.current;
      if (!current || latest.current.busy || inspectionPending.current || !sites.includes(site)) return;
      commit({...current, selected: selected.includes(site) ? selected.filter(key => key !== site) : [...selected, site]});
    }} /> : null };
}
