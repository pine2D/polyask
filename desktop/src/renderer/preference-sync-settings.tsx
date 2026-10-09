import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { PreferenceSyncCopy } from '../shared/preference-sync-copy';
import type { PreferenceGroup } from '../shared/preferences';
import type { PreferenceSyncSettingsState } from './use-synced-preferences';

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
  return <section className="settings-card settings-display" aria-labelledby="settings-preference-sync-title" aria-busy={pending}>
    <h2 id="settings-preference-sync-title">{copy.preferenceSyncTitle}</h2>
    <p>{copy.preferenceSyncDescription}</p>
    {(['display', 'layout', 'siteZoom'] as const).map(group => <fieldset key={group} disabled={disabled}
      aria-describedby={`settings-follow-${group}-hint`}>
      <legend>{titles[group]}</legend>
      <p id={`settings-follow-${group}-hint`}>{group === 'siteZoom' ? copy.preferenceSyncZoomHint : copy.preferenceSyncFollowHint}</p>
      <div className="settings-display-options">{(['local', 'shared'] as const).map(value => <label key={value}>
        <input type="radio" name={`settings-follow-${group}`} value={value} disabled={disabled}
          checked={(snapshot?.following[group] ?? false) === (value === 'shared')}
          onChange={() => { void change(() => latest.current.onFollowingChange(group, value === 'shared')); }} />
        <span>{value === 'shared' ? copy.preferenceSyncFollow : copy.preferenceSyncLocal}</span>
      </label>)}</div>
    </fieldset>)}
    <fieldset disabled={disabled} aria-describedby="settings-layout-mode-hint">
      <legend>{copy.preferenceSyncLayout}</legend>
      <p id="settings-layout-mode-hint">{copy.preferenceSyncLayoutHint}</p>
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
