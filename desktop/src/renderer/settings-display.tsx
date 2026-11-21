import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from '../shared/display';
import { useActionFocus } from './use-action-focus';
import { isUiTheme, UI_THEMES, UI_THEME_IDS, type UiTheme } from '../shared/ui-theme';

/** 显示值始终来自外壳已接受的偏好，保存失败不显示未经接受的新值。 */
export function SettingsDisplay({ copy, display = DEFAULT_DISPLAY_PREFERENCES, busy, following = false, onChange, theme, onThemeChange }: {
  copy: DesktopCopy;
  display?: DisplayPreferences;
  busy: boolean;
  following?: boolean;
  theme?: string;
  onThemeChange?: (theme: UiTheme) => Promise<void>;
  onChange?: (preferences: DisplayPreferences) => Promise<void>;
}): React.JSX.Element {
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const inFlight = useRef(false), mounted = useRef(true);
  const latest = useRef({ display, busy, onChange }); latest.current = { display, busy, onChange };
  const disabled = pending || busy || !onChange;
  const rememberFocus = useActionFocus(pending || busy, target => target.closest('fieldset')?.querySelector<HTMLInputElement>('input:checked') ?? null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async (action: () => Promise<void>) => {
    if (inFlight.current || latest.current.busy) return;
    const finishFocus = rememberFocus();
    inFlight.current = true; setPending(true); setFailed(false);
    try { await action(); }
    catch { if (mounted.current) setFailed(true); }
    finally { finishFocus(true); inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const change = (patch: Partial<DisplayPreferences>) => {
    const { display, onChange } = latest.current;
    if (onChange) void save(() => onChange({ ...display, ...patch }));
  };
  return <section className="settings-card settings-display" aria-labelledby="settings-display-title" aria-busy={pending}>
    <h2 id="settings-display-title" tabIndex={-1}>{copy.settingsDisplayTitle}</h2>
    <p className="settings-control-hint">{following ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal}</p>
    <fieldset disabled={pending || busy || !onThemeChange || theme === undefined} aria-describedby="settings-theme-hint">
      <legend>{copy.settingsThemeLabel}</legend>
      <p id="settings-theme-hint">{theme !== undefined && !isUiTheme(theme) ? copy.settingsThemeUnavailable : copy.settingsThemeScope}</p>
      <div className="settings-display-options">
        {UI_THEME_IDS.map(id => <label key={id}>
          <input type="radio" name="settings-theme" value={id} checked={theme === id}
            onChange={() => { if (onThemeChange) void save(() => onThemeChange(id)); }} />
          <span className="theme-option"><i className="theme-swatch" data-swatch={id} aria-hidden="true" />{copy[UI_THEMES[id].label]}</span>
        </label>)}
      </div>
    </fieldset>
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
