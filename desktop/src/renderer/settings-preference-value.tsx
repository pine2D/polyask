import type { DesktopCopy } from '../shared/copy';

/** 当前值和传播范围常驻；来源由已选单选项及来源详情表达。 */
export function SettingsPreferenceValue({ copy, id, value, scope }: {
  readonly copy: DesktopCopy;
  readonly id: string;
  readonly value: string;
  readonly scope: string;
}): React.JSX.Element {
  return <dl id={id} className="settings-preference-value">
    <div><dt className="sr-only">{copy.preferenceSyncCurrent}</dt><dd data-preference-current>{value}</dd></div>
    <div><dt className="sr-only">{copy.preferenceSyncScope}</dt><dd data-preference-scope>{scope}</dd></div>
  </dl>;
}
