import type { DesktopCopy } from '../shared/copy';
import { CONFIRMATION_KEYS, type ConfirmationKey } from '../shared/preferences';

const LABELS = {
  sitePageCloseConfirm: ['sitePageCloseConfirmSetting', 'sitePageCloseConfirmSettingHint'],
  newSessionConfirm: ['newSessionConfirmSetting', 'newSessionConfirmSettingHint']
} satisfies Record<ConfirmationKey, readonly [keyof DesktopCopy, keyof DesktopCopy]>;

/** 「不再提示」类确认的总开关：弹窗里勾掉之后，只能从这里恢复。 */
export function SettingsConfirmations(props: {
  readonly copy: DesktopCopy;
  readonly busy: boolean;
  readonly confirmations: Readonly<Record<ConfirmationKey, boolean>>;
  readonly onChange: (key: ConfirmationKey, enabled: boolean) => void;
}): React.JSX.Element {
  return <section className="settings-card settings-confirmations" aria-labelledby="settings-confirmations-title">
    <h2 id="settings-confirmations-title">{props.copy.confirmationsTitle}</h2>
    {CONFIRMATION_KEYS.map(key => <label key={key} className="preference-card">
      <span className="preference-copy">
        <strong id={`confirmation-${key}-title`} className="preference-title">{props.copy[LABELS[key][0]]}</strong>
        <p>{props.copy[LABELS[key][1]]}</p>
      </span>
      <span className="preference-switch">
        <input type="checkbox" name={`confirmation-${key}`} aria-labelledby={`confirmation-${key}-title`}
          checked={props.confirmations[key]} disabled={props.busy}
          onChange={event => props.onChange(key, event.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>)}
  </section>;
}
