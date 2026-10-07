import { useEffect, useRef, useState } from 'react';
import type { SiteKey } from '../shared/contracts';
import { isPageReorder, pagesNeededForParticipation, participationSites, reconcileParticipation } from './site-participation';

export interface SiteParticipationOptions {
  readonly opened: readonly SiteKey[];
  readonly ready: boolean;
  readonly busy?: boolean;
  readonly openPages: (next: readonly SiteKey[]) => Promise<readonly SiteKey[]>;
  readonly onError: () => void;
}

/** Page membership is persistent; send membership only belongs to this shell session. */
export function useSiteParticipation(options: SiteParticipationOptions) {
  const latest = useRef(options); latest.current = options;
  const initialized = useRef(false), mounted = useRef(true), revision = useRef(0);
  const desired = useRef<readonly SiteKey[]>([]);
  const opening = useRef(new Map<number, readonly SiteKey[]>());
  const [members, setMembers] = useState<readonly SiteKey[]>([]);
  const [pending, setPending] = useState(false), [resetRevision, setResetRevision] = useState(0);
  const accept = (next: readonly SiteKey[]) => { desired.current = next; setMembers(next); };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; };
  }, []);
  useEffect(() => {
    if (!options.ready) return;
    if (!initialized.current) { initialized.current = true; accept(participationSites(options.opened)); }
    else {
      const next = desired.current.filter(site => options.opened.includes(site));
      if (next.join(',') !== desired.current.join(',')) accept(next);
    }
  }, [options.opened, options.ready, resetRevision]);
  const currentSites = () => desired.current.filter(site => latest.current.opened.includes(site));
  const active = (request: number) => mounted.current && request === revision.current;
  const change = async (value: readonly SiteKey[]): Promise<boolean> => {
    if (!latest.current.ready || latest.current.busy) return false;
    let target: readonly SiteKey[];
    try { target = participationSites(value); } catch { latest.current.onError(); return false; }
    const request = ++revision.current;
    const opened = latest.current.opened;
    // Missing pages become participants only after their own accepted open ACK.
    accept(target.filter(site => opened.includes(site)));
    if (target.every(site => opened.includes(site))) { setPending(false); return true; }
    const inFlight = [...opening.current.values()].flat();
    const base = pagesNeededForParticipation(opened, [...new Set(inFlight)]);
    const next = pagesNeededForParticipation(base, target);
    opening.current.set(request, next); setPending(true);
    try {
      const accepted = participationSites(await latest.current.openPages(next));
      if (!active(request)) return false;
      accept(target.filter(site => accepted.includes(site)));
      const complete = target.every(site => accepted.includes(site));
      if (!complete) latest.current.onError();
      return complete;
    } catch {
      if (active(request)) latest.current.onError();
      return false;
    } finally {
      opening.current.delete(request);
      if (active(request)) setPending(false);
    }
  };
  const reorderOpened = async (value: readonly SiteKey[]): Promise<boolean> => {
    if (!latest.current.ready || latest.current.busy) return false;
    try { if (!isPageReorder(latest.current.opened, value)) return false; }
    catch { latest.current.onError(); return false; }
    const request = ++revision.current, previous = desired.current;
    accept(value.filter(site => previous.includes(site))); setPending(true);
    try {
      const accepted = participationSites(await latest.current.openPages(value));
      if (!active(request)) return false;
      accept(accepted.filter(site => desired.current.includes(site)));
      return true;
    } catch {
      if (active(request)) { accept(previous.filter(site => latest.current.opened.includes(site))); latest.current.onError(); }
      return false;
    } finally { if (active(request)) setPending(false); }
  };
  const snapshot = reconcileParticipation(options.opened, members);
  return {
    ...snapshot, pending, currentSites, change, reorderOpened,
    toggle: (site: SiteKey) => {
      const next = currentSites();
      return change(next.includes(site) ? next.filter(key => key !== site) : [...next, site]);
    },
    reset: () => {
      revision.current++; initialized.current = false; opening.current.clear(); accept([]); setPending(false);
      setResetRevision(value => value + 1);
    }
  };
}
