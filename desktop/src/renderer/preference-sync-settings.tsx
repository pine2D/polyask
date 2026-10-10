import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import type { PreferenceSyncCopy } from '../shared/preference-sync-copy';
import type { PreferenceGroup } from '../shared/preferences';
import type { PreferenceSyncSettingsState } from './use-synced-preferences';
import { formatBackupValue } from './backup-data';

export function PreferenceSyncSettings(props: PreferenceSyncSettingsState & {
  readonly copy: DesktopCopy & PreferenceSyncCopy; readonly busy: boolean;
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
  const titles: Record<PreferenceGroup, string> = { display: copy.preferenceSyncDisplay,
    layout: copy.preferenceSyncLayout, siteZoom: copy.preferenceSyncSiteZoom };
  const values: Record<PreferenceGroup, string> = {
    display: snapshot ? formatCopy(copy.preferenceSyncCurrentDisplay, {
      density: snapshot.values.display.density === 'compact' ? copy.compactDensity : copy.comfortableDensity,
      scale: `${Math.round(snapshot.values.display.siteScale * 100)}%`
    }) : copy.preferenceSyncLoading,
    layout: snapshot ? snapshot.values.layoutMode === 'overview' ? copy.overview : copy.focus : copy.preferenceSyncLoading,
    siteZoom: !snapshot ? copy.preferenceSyncLoading : Object.keys(snapshot.values.siteZoom).length ? Object.entries(snapshot.values.siteZoom)
      .map(([site, zoom]) => `${formatBackupValue(site, 'site', copy, '')} ${Math.round(zoom * 100)}%`).join(' · ')
      : copy.preferenceSyncZoomDefault
  };
  return <section className="settings-card settings-display" aria-labelledby="settings-preference-sync-title" aria-busy={pending}>
    <h2 id="settings-preference-sync-title" tabIndex={-1}>{copy.preferenceSyncTitle}</h2>
    <p>{copy.preferenceSyncDescription}</p>
    {(['display', 'layout', 'siteZoom'] as const).map(group => <fieldset key={group} disabled={disabled} data-preference-group={group}
      aria-describedby={`settings-follow-${group}-facts settings-follow-${group}-hint`}>
      <legend>{titles[group]}</legend>
      <dl id={`settings-follow-${group}-facts`} className="settings-preference-facts">
        <div><dt>{copy.preferenceSyncSource}</dt><dd data-preference-source>{!snapshot ? copy.preferenceSyncLoading : snapshot.following[group] ? copy.preferenceSyncSourceShared : copy.preferenceSyncSourceLocal}</dd></div>
        <div><dt>{copy.preferenceSyncCurrent}</dt><dd data-preference-current>{values[group]}</dd></div>
        <div><dt>{copy.preferenceSyncScope}</dt><dd data-preference-scope>{!snapshot ? copy.preferenceSyncLoading : snapshot.following[group] ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal}</dd></div>
      </dl>
      <p id={`settings-follow-${group}-hint`}>{group === 'siteZoom' ? copy.preferenceSyncZoomHint : copy.preferenceSyncFollowHint}</p>
      <div className="settings-display-options">{(['local', 'shared'] as const).map(value => <label key={value}>
        <input type="radio" name={`settings-follow-${group}`} value={value} disabled={disabled}
          checked={(snapshot?.following[group] ?? false) === (value === 'shared')}
          onChange={() => { void change(() => latest.current.onFollowingChange(group, value === 'shared')); }} />
        <span>{value === 'shared' ? copy.preferenceSyncFollow : copy.preferenceSyncLocal}</span>
      </label>)}</div>
    </fieldset>)}
    <fieldset disabled={disabled} aria-describedby="settings-layout-mode-hint settings-layout-mode-scope">
      <legend>{copy.preferenceSyncLayoutValue}</legend>
      <p id="settings-layout-mode-hint">{copy.preferenceSyncLayoutHint}</p>
      <p id="settings-layout-mode-scope">{!snapshot ? copy.preferenceSyncLoading : snapshot.following.layout ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal}</p>
      <div className="settings-display-options">{(['overview', 'focus'] as const).map(mode => <label key={mode}>
        <input type="radio" name="settings-layout-mode" value={mode} disabled={disabled}
          checked={(snapshot?.values.layoutMode ?? 'overview') === mode}
          onChange={() => { void change(() => latest.current.onLayoutModeChange(mode)); }} />
        <span>{mode === 'overview' ? copy.overview : copy.focus}</span>
      </label>)}</div>
    </fieldset>
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
