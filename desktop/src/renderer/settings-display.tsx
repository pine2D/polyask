import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from '../shared/display';

/** 显示值始终来自外壳已接受的偏好，保存失败不显示未经接受的新值。 */
export function SettingsDisplay({ copy, display = DEFAULT_DISPLAY_PREFERENCES, busy, following = false, onChange }: {
  copy: DesktopCopy;
  display?: DisplayPreferences;
  busy: boolean;
  following?: boolean;
  onChange?: (preferences: DisplayPreferences) => Promise<void>;
}): React.JSX.Element {
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true);
  const latest = useRef({ display, busy, onChange }); latest.current = { display, busy, onChange };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = async (patch: Partial<DisplayPreferences>) => {
    const current = latest.current;
    if (inFlight.current || current.busy || !current.onChange) return;
    inFlight.current = true; setPending(true); setFailed(false);
    try { await current.onChange({ ...current.display, ...patch }); }
    catch { if (mounted.current) setFailed(true); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const disabled = pending || busy || !onChange;
  return <section className="settings-card settings-display" aria-labelledby="settings-display-title" aria-busy={pending}>
    <h2 id="settings-display-title" tabIndex={-1}>{copy.settingsDisplayTitle}</h2>
    <p className="settings-control-hint">{following ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal}</p>
    <fieldset disabled={disabled} aria-describedby="settings-density-hint">
      <legend>{copy.settingsDensityLabel}</legend>
      <p id="settings-density-hint">{copy.settingsDensityScope}</p>
      <div className="settings-display-options">
        {(['compact', 'comfortable'] as const).map(value => <label key={value}>
          <input type="radio" name="settings-density" value={value} checked={display.density === value} disabled={disabled}
            onChange={() => { void change({ density: value }); }} />
          <span>{value === 'compact' ? copy.compactDensity : copy.comfortableDensity}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset disabled={disabled} aria-describedby="settings-scale-hint">
      <legend>{copy.settingsScaleLabel}</legend>
      <p id="settings-scale-hint">{copy.settingsScaleScope}</p>
      <div className="settings-display-options">
        {([0.9, 1] as const).map(value => <label key={value}>
          <input type="radio" name="settings-site-scale" value={value} checked={display.siteScale === value} disabled={disabled}
            onChange={() => { void change({ siteScale: value }); }} />
          <span>{value === 0.9 ? copy.fitSiteScale : copy.actualSiteScale}</span>
        </label>)}
      </div>
    </fieldset>
    {pending ? <p className="settings-control-hint">{copy.settingsDisplayUpdating}</p> : null}
    {failed ? <p className="settings-control-hint" role="alert">{copy.settingsDisplayFailed}</p> : null}
  </section>;
}
