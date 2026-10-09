import type { DesktopCopy } from '../shared/copy';
import type { SyncStatus } from '../shared/sync';
import { LocalDataConfirm, LOCAL_DATA_COPY } from './local-data-confirm';
import { useLocalDataConfirmation, type LocalDataAction } from './use-local-data-confirmation';

interface LocalDataCardProps {
  readonly copy: DesktopCopy;
  readonly busy: boolean;
  readonly onBusy: (value: boolean) => void;
  readonly onFeedback: (message: string) => void;
  readonly onStatus: (status: SyncStatus) => void;
  /** 重置成功后由外壳清掉只存在渲染层的状态（提问草稿）。 */
  readonly onReset?: () => void;
  readonly onBackup?: () => void;
}

// 先核对活动数量，最终执行仍复用原有清空/重置服务和返回值。
export function LocalDataCard(props: LocalDataCardProps): React.JSX.Element {
  const confirmation = useLocalDataConfirmation(props);
  const active = confirmation.state?.executing ? confirmation.state.action : null;
  const actionButton = (action: LocalDataAction) => <button key={action} type="button" className="settings-control" disabled={props.busy || !!active} onClick={() => confirmation.open(action)}>{active === action ? action === 'reset' ? props.copy.localDataResetting : props.copy.localDataClearing : props.copy[LOCAL_DATA_COPY[action].action]}</button>;
  return <section className="settings-card danger-zone" aria-labelledby="local-data-title">
    <h2 id="local-data-title">{props.copy.localDataTitle}</h2>
    <p>{props.copy.localDataDescription}</p>
    <p className="settings-control-hint">{props.copy.localDataDeletionSync}</p>
    <div className="settings-actions">{(['history', 'archives', 'decisions', 'folders', 'drafts'] as const).map(actionButton)}</div>
    {props.busy && !active ? <p className="settings-control-hint">{props.copy.settingsWait}</p> : null}
    <div className="local-reset"><p className="sync-privacy">{props.copy.localDataCloudUntouched}</p>{actionButton('reset')}</div>
    {confirmation.state ? <LocalDataConfirm copy={props.copy} state={confirmation.state} busy={props.busy}
      onCancel={confirmation.cancel} onConfirm={confirmation.confirm} onRetry={confirmation.retry}
      onBackup={props.onBackup ? () => { confirmation.cancel(); props.onBackup?.(); } : undefined} /> : null}
  </section>;
}
