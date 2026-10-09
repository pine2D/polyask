import { useEffect, useRef } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { focusableControls } from './focusable-controls';
import { currentPlatform } from './platform';
import type { LocalDataAction, LocalDataConfirmation } from './use-local-data-confirmation';

export const LOCAL_DATA_COPY: Record<LocalDataAction, { title: keyof DesktopCopy; message: keyof DesktopCopy; action: keyof DesktopCopy }> = {
  history: { title: 'clearHistoryConfirmTitle', message: 'clearHistoryConfirmMessage', action: 'clearHistoryAction' },
  archives: { title: 'clearArchivesConfirmTitle', message: 'clearArchivesConfirmMessage', action: 'clearArchivesAction' },
  decisions: { title: 'clearDecisionsConfirmTitle', message: 'clearDecisionsConfirmMessage', action: 'clearDecisionsAction' },
  folders: { title: 'clearFoldersConfirmTitle', message: 'clearFoldersConfirmMessage', action: 'clearFoldersAction' },
  drafts: { title: 'clearDraftsConfirmTitle', message: 'clearDraftsConfirmMessage', action: 'clearDraftsAction' },
  reset: { title: 'resetLocalConfirmTitle', message: 'resetLocalConfirmMessage', action: 'resetLocalAction' }
};

export function LocalDataConfirm({ copy, state, busy, onCancel, onConfirm, onRetry, onBackup }: {
  copy: DesktopCopy; state: LocalDataConfirmation; busy: boolean;
  onCancel: () => void; onConfirm: () => void; onRetry: () => void; onBackup?: () => void;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const latest = useRef({ state, onCancel }); latest.current = { state, onCancel };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (event.isComposing || event.keyCode === 229)) { event.stopImmediatePropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!latest.current.state.executing) latest.current.onCancel(); }
      if (event.key !== 'Tab') return;
      const nodes = panel.current ? focusableControls(panel.current) : [];
      const at = nodes.indexOf(document.activeElement as HTMLElement);
      if (!nodes.length) { event.preventDefault(); panel.current?.focus(); }
      else if (at < 0 || (event.shiftKey ? at === 0 : at === nodes.length - 1)) {
        event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); opener?.focus(); };
  }, []);
  const keys = LOCAL_DATA_COPY[state.action], stats = state.stats;
  const rows: [string, number][] = [];
  if (stats) {
    if (state.action === 'reset') rows.push([copy.localDataHistoryCount, stats.history], [copy.localDataArchivesCount, stats.archives],
      [copy.localDataDecisionsCount, stats.decisions], [copy.localDataFoldersCount, stats.folders], [copy.localDataAnswersCount, stats.reset.answers],
      [copy.localDataMembershipsCount, stats.reset.memberships], [copy.localDataTemplatesCount, stats.reset.templates],
      [copy.localDataGroupsCount, stats.reset.groups], [copy.localDataWorkspaceCount, stats.reset.workspace],
      [copy.localDataDraftsCount, stats.drafts], [copy.localDataPreferencesCount, stats.reset.preferences]);
    else {
      const labels = { history: copy.localDataHistoryCount, archives: copy.localDataArchivesCount, decisions: copy.localDataDecisionsCount, folders: copy.localDataFoldersCount, drafts: copy.localDataDraftsCount };
      rows.push([labels[state.action], stats[state.action]]);
      if (state.action === 'history') rows.push([copy.localDataAnswersCount, stats.answers]);
      if (state.action === 'folders') rows.push([copy.localDataMembershipsCount, stats.memberships]);
    }
  }
  const empty = !!stats && state.action !== 'reset' && stats[state.action] === 0;
  const confirmButton = <button key="confirm" type="button" className="primary" data-local-confirm disabled={busy || state.loading || state.executing || !stats || state.error === 'stats' || empty} onClick={onConfirm}>{state.executing ? state.action === 'reset' ? copy.localDataResetting : copy.localDataClearing : copy[keys.action]}</button>;
  const cancelButton = <button key="cancel" type="button" ref={cancel} disabled={state.executing} onClick={onCancel}>{copy.cancel}</button>;
  return <div className="confirm-scrim"><div className="confirm-dialog local-data-confirm" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="local-confirm-title" aria-describedby="local-confirm-message local-confirm-snapshot" aria-busy={state.loading || state.executing}>
    <header><h2 id="local-confirm-title">{copy[keys.title]}</h2></header>
    <p id="local-confirm-message">{copy[keys.message]}</p>
    {state.changed ? <p className="local-counts-changed">{copy.localDataStatsChanged}</p> : null}
    {state.loading ? <p>{copy.localDataStatsLoading}</p> : null}
    {state.error ? <p role="alert">{state.error === 'stats' ? copy.localDataStatsFailed : copy.localDataActionFailed}</p> : null}
    <ul className="local-data-counts">{rows.map(([label, count]) => <li key={label}>{formatCopy(label, { count })}</li>)}</ul>
    {empty ? <p>{copy.localDataNoActiveRecords}</p> : null}
    <p id="local-confirm-snapshot">{state.action === 'reset' ? copy.localDataResetSnapshot : copy.localDataStatsSnapshot}</p>
    <div className="local-confirm-tools">
      {state.error === 'stats' ? <button type="button" disabled={state.loading} onClick={onRetry}>{copy.localDataStatsRetry}</button> : null}
      {onBackup ? <button type="button" disabled={state.executing} onClick={onBackup}>{copy.localDataBackupFirst}</button> : null}
    </div>
    <div className="confirm-actions">{currentPlatform === 'win32' ? [confirmButton, cancelButton] : [cancelButton, confirmButton]}</div>
  </div></div>;
}
