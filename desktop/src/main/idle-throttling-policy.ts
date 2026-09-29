// Experimental only: a single ambiguous site keeps the entire window unthrottled.
export interface IdleSite {
  readonly id: number;
  readonly phase: string;
  readonly loading: boolean;
  readonly attached: boolean;
  readonly set: (allowed: boolean) => void;
}
interface Options {
  enabled: boolean;
  minimized(): boolean;
  sites(): IdleSite[];
  probe(id: number): Promise<unknown>;
  listen(event: 'minimize' | 'restore' | 'show' | 'closed', callback: () => void): () => void;
  interval(callback: () => void): () => void;
}
export function createIdleThrottlingExperiment(options: Options) {
  const noop = { wake() {}, dispose() {} };
  if (!options.enabled) return noop;
  let epoch = 0, disposed = false, locked = false, checking = false;
  const applied = new Map<number, IdleSite>();
  const restore = () => {
    // Try every peer even if one renderer was destroyed while applying the policy.
    for (const site of applied.values()) { try { site.set(false); } catch {} }
    applied.clear();
  };
  const wake = () => { epoch++; locked = options.minimized(); restore(); };
  const eligible = (sites: IdleSite[]) => sites.length > 0 && sites.every(site =>
    site.attached && !site.loading && ['ready', 'complete'].includes(site.phase));
  const check = async () => {
    if (disposed || checking || locked) return;
    if (!options.minimized()) { restore(); return; }
    checking = true;
    const token = epoch;
    try {
      const sites = options.sites();
      if (!eligible(sites)) { restore(); return; }
      const states = await Promise.all(sites.map(site => options.probe(site.id)));
      if (disposed || token !== epoch || locked || !options.minimized()) return;
      const current = options.sites();
      if (!eligible(current) || current.length !== sites.length || current.some((site, i) => site.id !== sites[i].id)
        || states.some(state => state !== 'idle' && state !== 'complete')) { restore(); return; }
      for (const site of current) {
        if (applied.has(site.id)) continue;
        applied.set(site.id, site);
        site.set(true);
      }
    } catch { wake(); } finally { checking = false; }
  };
  const reset = () => { epoch++; locked = false; restore(); };
  const cleanup = [options.listen('minimize', () => { void check(); }),
    options.listen('restore', reset), options.listen('show', reset),
    options.interval(() => { void check(); })];
  const dispose = () => {
    if (disposed) return;
    disposed = true; wake(); cleanup.forEach(stop => stop());
  };
  cleanup.push(options.listen('closed', dispose));
  return { wake, dispose };
}
