import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { initialSiteFindState, SITE_FIND_HEIGHT, SITE_FIND_MAX_LENGTH,
  type SiteFindRequest, type SiteFindState } from '../shared/site-find';
import { BackIcon, CloseIcon, InfoIcon, MoreIcon, ReloadIcon } from './icons';
import { shell } from './shell-api';
import type { LayoutState } from '../shared/protocol';
import { SiteFindMarkers } from './site-find-markers';

export function SiteFind({ copy, sites, layout }: { readonly copy: DesktopCopy; readonly sites: readonly SiteDefinition[]; readonly layout?: LayoutState }): React.JSX.Element | null {
  const [state, setState] = useState(initialSiteFindState);
  const [query, setQuery] = useState(''), [scope, setScope] = useState<SiteFindRequest['scope']>('all');
  const [error, setError] = useState(false);
  const bar = useRef<HTMLElement>(null), menuPending = useRef(false);
  const input = useRef<HTMLInputElement>(null), composing = useRef(false), alive = useRef(true);
  const revision = useRef(-1), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const positionRevision = useRef(-1);
  const epoch = useRef(0), openedSession = useRef<number | null>(null);
  const current = useRef({ state, query, scope }); current.current = { state, query, scope };
  const accept = useCallback((value: SiteFindState): void => {
    if (!alive.current || value.revision < revision.current ||
      (value.revision === revision.current && value.positionRevision < positionRevision.current)) return;
    if (value.session !== current.current.state.session || (!value.open && current.current.state.open)) epoch.current++;
    current.current = { ...current.current, state:value };
    revision.current = value.revision; positionRevision.current = value.positionRevision; setState(value);
  }, []);
  const changeQuery = (value: string): void => { current.current.query = value; setQuery(value); };
  const changeScope = (value: SiteFindRequest['scope']): void => { current.current.scope = value; setScope(value); };
  const token = () => ({ epoch:epoch.current, session:current.current.state.session, query:current.current.query, scope:current.current.scope });
  const valid = (attempt: ReturnType<typeof token>): boolean => alive.current && current.current.state.open &&
    attempt.epoch === epoch.current && attempt.session === current.current.state.session &&
    attempt.query === current.current.query && attempt.scope === current.current.scope;
  useEffect(() => {
    alive.current = true;
    let active = true;
    const off = shell.onSiteFind(value => { if (active) accept(value); });
    void shell.getSiteFind().then(value => { if (active) accept(value); }).catch(() => { if (active) setError(true); });
    return () => { active = alive.current = false; epoch.current++; off(); clearTimeout(timer.current); void shell.closeSiteFind(false).catch(() => {}); };
  }, [accept]);
  useEffect(() => {
    if (!state.open) { openedSession.current = null; return; }
    if (openedSession.current !== state.session) {
      changeQuery(state.query); changeScope(state.scope); openedSession.current = state.session;
    }
    setError(false);
    input.current?.focus(); input.current?.select();
  }, [state.open, state.session, state.focusRequest]);
  const find = async (force = false, request?: SiteFindRequest): Promise<void> => {
    clearTimeout(timer.current);
    const { state, query, scope } = current.current;
    const next = request ?? { query, scope };
    if (!state.open || composing.current) return;
    if (force || next.query !== state.query || next.scope !== state.scope) {
      const attempt = token(), value = await shell.findSites(next);
      if (valid(attempt)) accept(value);
    }
  };
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    const attempt = token();
    try { setError(false); await action(); } catch { if (valid(attempt)) setError(true); }
  };
  useEffect(() => {
    if (!state.open || composing.current) return;
    timer.current = setTimeout(() => { void act(() => find()); }, 120);
    return () => clearTimeout(timer.current);
  }, [query, scope, state.open]);
  const move = (direction: -1 | 1): void => { void act(async () => {
    const attempt = token(); await find(); if (!valid(attempt)) return;
    const value = await shell.moveSiteFind(direction); if (!valid(attempt)) return;
    accept(value); input.current?.focus();
  }); };
  const select = (site: SiteKey): void => { void act(async () => {
    const attempt = token(); await find(); if (!valid(attempt)) return;
    const value = await shell.selectSiteFind(site); if (!valid(attempt)) return;
    accept(value); input.current?.focus();
  }); };
  const close = (): void => { epoch.current++; clearTimeout(timer.current); void act(async () => accept(await shell.closeSiteFind())); };
  const showMenu = (): void => { void act(async () => {
    if (menuPending.current || composing.current) return;
    menuPending.current = true;
    try {
      const attempt = token(); await find(); if (!valid(attempt)) return;
      const { session, revision } = current.current.state;
      const value = await shell.showSiteFindMenu({ session, revision });
      if (!valid(attempt)) return;
      accept(value); input.current?.focus();
    } finally { menuPending.current = false; }
  }); };
  useLayoutEffect(() => {
    const node = bar.current; if (!node) return;
    const fit = () => {
      node.dataset.fit = '';
      const chips = node.querySelector<HTMLElement>('.site-find-sites');
      if (chips && chips.scrollWidth > chips.clientWidth) node.dataset.fit = 'sites';
      if ((input.current?.getBoundingClientRect().width ?? 0) < 240 || node.scrollWidth > node.clientWidth)
        node.dataset.fit = 'sites extras';
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit); observer.observe(node);
    return () => observer.disconnect();
  }, [state, query, scope]);
  if (!state.open) return null;
  const fresh = state.query === query && state.scope === scope;
  const results = fresh ? state.sites : [];
  const pending = !fresh || results.some(item => item.status === 'pending');
  const total = results.reduce((sum, item) => sum + item.matches, 0);
  const activeIndex = results.findIndex(item => item.site === state.activeSite);
  const active = activeIndex < 0 ? 0 : results.slice(0, activeIndex).reduce((sum, item) => sum + item.matches, 0) + results[activeIndex].active;
  const summary = error ? copy.findFailed : pending ? copy.findSearching : !query ? '' :
    total ? formatCopy(copy.findCount, { active, total }) : copy.findNoMatches;
  return <><section ref={bar} className="site-find" role="search" aria-label={copy.findPage} style={{ height:SITE_FIND_HEIGHT }}>
      <input ref={input} type="search" name="site-find-query" aria-label={copy.findPage}
        placeholder={copy.findPlaceholder} maxLength={SITE_FIND_MAX_LENGTH} autoComplete="off" spellCheck={false}
        value={query} onChange={event => changeQuery(event.target.value)}
        onCompositionStart={() => { composing.current = true; clearTimeout(timer.current); }}
        onCompositionEnd={event => {
          composing.current = false;
          const text = event.currentTarget.value;
          changeQuery(text); void act(() => find(false, { query:text, scope:current.current.scope }));
        }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
          if (event.key === 'Escape') { event.preventDefault(); close(); }
        }} />
      <select name="site-find-scope" aria-label={copy.findScope} value={scope}
        onChange={event => changeScope(event.target.value as SiteFindRequest['scope'])}>
        <option value="all">{copy.findAll}</option><option value="current">{copy.findCurrent}</option>
      </select>
      <div className="site-find-sites" aria-label={copy.findScope}>
        {query ? results.map(result => {
          const label = sites.find(site => site.key === result.site)?.label ?? result.site;
          const description = result.status === 'unavailable' ? formatCopy(copy.findUnavailable, { site:label })
            : result.status === 'pending' ? `${label}: ${copy.findSearching}` : formatCopy(copy.findSiteCount, { site:label, count:result.matches });
          return <button type="button" data-find-site={result.site} key={result.site} title={description} aria-label={description}
            aria-pressed={state.activeSite === result.site} disabled={result.status !== 'ready' || result.matches === 0}
            onClick={() => select(result.site)}><span>{label}</span><span>{result.status === 'pending' ? '…' : result.status === 'unavailable' ? '?' : result.matches}</span></button>;
        }) : <span className="site-find-limit">{copy.findLimit}</span>}
      </div>
      <span className="site-find-position" data-find-position role="status" title={summary}>{summary}</span>
      <button type="button" name="site-find-previous" aria-label={copy.findPrevious} title={copy.findPrevious}
        disabled={!query || (fresh && !pending && !total)} onClick={() => move(-1)}><BackIcon /></button>
      <button type="button" className="site-find-forward" name="site-find-next" aria-label={copy.findNext} title={copy.findNext}
        disabled={!query || (fresh && !pending && !total)} onClick={() => move(1)}><BackIcon /></button>
      <button type="button" name="site-find-refresh" aria-label={copy.findRefresh} title={copy.findRefresh}
        disabled={!query} onClick={() => { void act(() => find(true)); }}><ReloadIcon /></button>
      <span className="site-find-info" tabIndex={0} aria-label={copy.findLimitHint} title={copy.findLimitHint}><InfoIcon /></span>
      <button type="button" name="site-find-menu" aria-label={copy.findMenu} title={copy.findMenu}
        aria-haspopup="menu" onClick={showMenu}><MoreIcon /></button>
      <button type="button" name="site-find-close" aria-label={copy.findClose} title={copy.findClose} onClick={close}><CloseIcon /></button>
  </section>{fresh && <SiteFindMarkers state={state} layout={layout} />}</>;
}
