import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import type { PreferenceSyncCopy } from '../shared/preference-sync-copy';
import type { GeneralPreferenceGroup } from '../shared/preferences';
import type { PreferenceSyncSettingsState } from './use-synced-preferences';
import { formatBackupValue } from './backup-data';
import { ProxySyncRow } from './proxy-sync-row';
import type { ProxyStateHandle } from './use-proxy-state';
import { SettingsPreferenceValue } from './settings-preference-value';

export function PreferenceSyncSettings(props: PreferenceSyncSettingsState & {
  readonly copy: DesktopCopy & PreferenceSyncCopy; readonly busy: boolean;
  /** 代理组不走通用跟随通道（主进程拒收），由 ProxySyncRow 调 proxy-follow。 */
  readonly proxy?: ProxyStateHandle;
  readonly onOpenLayout?: () => void;
}): React.JSX.Element {
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const mounted = useRef(true), inFlight = useRef(false), latest = useRef(props); latest.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = async (action: () => Promise<void>) => {
    if (inFlight.current || latest.current.busy || !latest.current.snapshot) return;
    inFlight.current = true; setPending(true); setFailed(false);
    try { await action(); }
    catch { if (mounted.current) setFailed(true); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const { copy, snapshot } = props;
  const disabled = pending || props.busy || !snapshot;
  // 代理组的跟随不走 preferences-follow（主进程拒收），这里只列通用分组。
  const titles: Record<GeneralPreferenceGroup, string> = { display: copy.preferenceSyncDisplay,
    layout: copy.preferenceSyncLayout, siteZoom: copy.preferenceSyncSiteZoom };
  const values: Record<GeneralPreferenceGroup, string> = {
    display: snapshot ? formatCopy(copy.preferenceSyncCurrentDisplay, {
      density: snapshot.values.display.density === 'compact' ? copy.compactDensity : copy.comfortableDensity,
      scale: `${Math.round(snapshot.values.display.siteScale * 100)}%`
    }) : copy.preferenceSyncLoading,
    layout: snapshot ? snapshot.values.layoutMode === 'overview' ? copy.overview : copy.focus : copy.preferenceSyncLoading,
    siteZoom: !snapshot ? copy.preferenceSyncLoading : Object.keys(snapshot.values.siteZoom).length ? Object.entries(snapshot.values.siteZoom)
      .map(([site, zoom]) => `${formatBackupValue(site, 'site', copy, '')} ${Math.round(zoom * 100)}%`).join(' · ')
      : copy.preferenceSyncZoomDefault
  };
  const groups = ['display', 'layout', 'siteZoom'] as const;
  const source = (following: boolean | undefined) => following === undefined ? copy.preferenceSyncLoading
    : following ? copy.preferenceSyncSourceShared : copy.preferenceSyncSourceLocal;
  return <section className="settings-card settings-display settings-preference-sync" aria-labelledby="settings-preference-sync-title" aria-busy={pending}>
    <h2 id="settings-preference-sync-title" tabIndex={-1}>{copy.preferenceSyncTitle}</h2>
    <p>{copy.preferenceSyncDescription}</p>
    <p id="settings-follow-hint" className="settings-control-hint">{copy.preferenceSyncFollowHint}</p>
    <details className="settings-preference-details">
      <summary>{copy.preferenceSyncDetails}</summary>
      <dl className="settings-preference-facts">
        {groups.map(group => <div key={group}><dt>{titles[group]}</dt>
          <dd data-preference-source={group}>{source(snapshot?.following[group])}</dd></div>)}
        {props.proxy ? <div><dt>{copy.proxySyncTitle}</dt><dd data-preference-source="proxy">{source(props.proxy.state?.following)}</dd></div> : null}
      </dl>
    </details>
    {groups.map(group => <fieldset key={group} disabled={disabled} data-preference-group={group}
      aria-describedby={`settings-follow-${group}-facts ${group === 'siteZoom' ? 'settings-follow-siteZoom-hint ' : ''}settings-follow-hint`}>
      <legend>{titles[group]}</legend>
      <SettingsPreferenceValue copy={copy} id={`settings-follow-${group}-facts`} value={values[group]}
        scope={!snapshot ? copy.preferenceSyncLoading : snapshot.following[group] ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal} />
      {group === 'siteZoom' ? <p id="settings-follow-siteZoom-hint">{copy.preferenceSyncZoomHint}</p> : null}
      <div className="settings-display-options">{(['local', 'shared'] as const).map(value => <label key={value}>
        <input type="radio" name={`settings-follow-${group}`} value={value} disabled={disabled}
          checked={(snapshot?.following[group] ?? false) === (value === 'shared')}
          onChange={() => { void change(() => latest.current.onFollowingChange(group, value === 'shared')); }} />
        <span>{value === 'shared' ? copy.preferenceSyncFollow : copy.preferenceSyncLocal}</span>
      </label>)}</div>
      {group === 'layout' && props.onOpenLayout ? <button type="button" className="settings-inline-action" disabled={disabled}
        onClick={props.onOpenLayout}>{copy.preferenceSyncEditLayout}</button> : null}
    </fieldset>)}
    {props.proxy ? <ProxySyncRow copy={copy} proxy={props.proxy} disabled={pending || props.busy} /> : null}
    <label className="preference-card">
      <span className="preference-copy"><strong id="draft-sync-title" className="preference-title">{copy.draftSyncTitle}</strong>
        <p id="draft-sync-description" data-draft-sync-description>{copy.draftSyncDescription}</p></span>
      <span className="preference-switch"><input type="checkbox" name="draft-sync" aria-labelledby="draft-sync-title"
        aria-describedby="draft-sync-description" checked={snapshot?.draftSync ?? false} disabled={disabled}
        onChange={event => { const enabled = event.target.checked; void change(() => latest.current.onDraftSyncChange(enabled)); }} />
        <span aria-hidden="true" /></span>
    </label>
    {pending ? <p className="settings-control-hint">{copy.preferenceSyncUpdating}</p> : null}
    {failed ? <p className="settings-control-hint" role="alert">{copy.preferenceSyncFailed}</p> : null}
  </section>;
}
