import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { PreferenceSyncSettingsState } from './use-synced-preferences';

/** 只移动编辑入口；接受值、跟随范围与保存仍由偏好快照负责。 */
export function SettingsLayout(props: Pick<PreferenceSyncSettingsState, 'snapshot' | 'onLayoutModeChange'> & {
  readonly copy: DesktopCopy;
  readonly busy: boolean;
}): React.JSX.Element {
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const mounted = useRef(true), inFlight = useRef(false), latest = useRef(props); latest.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = async (mode: 'overview' | 'focus') => {
    if (inFlight.current || latest.current.busy || !latest.current.snapshot) return;
    inFlight.current = true; setPending(true); setFailed(false);
    try { await latest.current.onLayoutModeChange(mode); }
    catch { if (mounted.current) setFailed(true); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const { copy, snapshot } = props;
  return <section className="settings-card settings-display settings-layout" aria-labelledby="settings-layout-title" aria-busy={pending}>
    <h2 id="settings-layout-title" tabIndex={-1}>{copy.preferenceSyncLayout}</h2>
    <p id="settings-layout-mode-hint">{copy.preferenceSyncLayoutHint}</p>
    <fieldset disabled={props.busy || pending || !snapshot} aria-describedby="settings-layout-mode-hint settings-layout-scope">
      <legend className="sr-only">{copy.preferenceSyncLayoutValue}</legend>
      <div className="settings-display-options">{(['overview', 'focus'] as const).map(mode => <label key={mode}>
        <input type="radio" name="settings-layout-mode" value={mode} disabled={props.busy || pending || !snapshot}
          checked={snapshot?.values.layoutMode === mode} onChange={() => { void change(mode); }} />
        <span>{mode === 'overview' ? copy.overview : copy.focus}</span>
      </label>)}</div>
    </fieldset>
    <p id="settings-layout-scope" className="settings-control-hint">{!snapshot ? copy.preferenceSyncLoading
      : snapshot.following.layout ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal}</p>
    {pending ? <p className="settings-control-hint" role="status">{copy.preferenceSyncUpdating}</p> : null}
    {failed ? <p className="settings-control-hint" role="alert">{copy.preferenceSyncFailed}</p> : null}
  </section>;
}
