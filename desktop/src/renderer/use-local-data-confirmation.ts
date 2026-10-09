import { useEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { isLocalDataStats, type LocalDataStats } from '../shared/local-data';
import type { SyncStatus } from '../shared/sync';
import { shell } from './shell-api';

export type LocalDataAction = 'history' | 'archives' | 'decisions' | 'folders' | 'drafts' | 'reset';
export interface LocalDataConfirmation {
  action: LocalDataAction;
  stats: LocalDataStats | null;
  loading: boolean;
  executing: boolean;
  error: 'stats' | 'write' | null;
  changed: boolean;
}
interface LocalDataCallbacks {
  copy: DesktopCopy;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onFeedback: (message: string) => void;
  onStatus: (status: SyncStatus) => void;
  onReset?: () => void;
}

function scope(stats: LocalDataStats, action: LocalDataAction): readonly number[] {
  if (action === 'history') return [stats.history, stats.answers];
  if (action === 'folders') return [stats.folders, stats.memberships];
  if (action !== 'reset') return [stats[action]];
  return [stats.history, stats.archives, stats.decisions, stats.folders, stats.drafts, stats.reset.answers,
    stats.reset.memberships, stats.reset.templates, stats.reset.groups, stats.reset.preferences, stats.reset.workspace];
}

/** 确认前重新读取；仅作快照核对，不把两次 IPC 冒充原子删除。 */
export function useLocalDataConfirmation(props: LocalDataCallbacks) {
  const [state, setState] = useState<LocalDataConfirmation | null>(null);
  const current = useRef(state);
  const latest = useRef(props); latest.current = props;
  const epoch = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const update = (value: LocalDataConfirmation | null) => { current.current = value; setState(value); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const cancel = () => {
    if (current.current?.executing) return;
    epoch.current++; pending.current = false; update(null);
  };
  const read = async (confirming: boolean): Promise<void> => {
    const before = current.current;
    if (!before || pending.current || (confirming && latest.current.busy)) return;
    pending.current = true;
    const request = ++epoch.current;
    update({ ...before, loading: true, error: null });
    try {
      const stats = await shell.getLocalDataStats();
      if (!mounted.current || request !== epoch.current) return;
      if (!isLocalDataStats(stats)) throw Error('invalid_local_data_stats');
      const next = { ...before, stats, loading: false, error: null };
      if (!confirming || !before.stats) { update(next); return; }
      const oldScope = scope(before.stats, before.action), nextScope = scope(stats, before.action);
      if (nextScope.some((value, index) => value !== oldScope[index])) { update({ ...next, changed: true }); return; }
      if ((before.action !== 'reset' && stats[before.action] === 0) || latest.current.busy) { update(next); return; }
      update({ ...next, changed: false, executing: true });
      latest.current.onBusy(true);
      try {
        const { copy } = latest.current;
        let message: string;
        if (before.action === 'reset') {
          const status = await shell.resetLocalData();
          if (!mounted.current || request !== epoch.current || current.current?.action !== before.action) return;
          latest.current.onStatus(status); latest.current.onReset?.(); message = copy.localDataReset;
        } else {
          const actions = {
            history: { run: () => shell.clearHistory(), message: copy.localDataHistoryCleared },
            archives: { run: () => shell.clearArchives(), message: copy.localDataArchivesCleared },
            decisions: { run: () => shell.clearDecisions(), message: copy.localDataDecisionsCleared },
            folders: { run: () => shell.clearFolders(), message: copy.localDataFoldersCleared },
            drafts: { run: () => shell.clearDrafts(true), message: copy.localDataDraftsCleared }
          };
          const action = actions[before.action]; message = formatCopy(action.message, { count: await action.run() });
        }
        if (mounted.current && request === epoch.current) { update(null); latest.current.onFeedback(message); }
      } catch {
        if (mounted.current && request === epoch.current) update({ ...next, executing: false, error: 'write' });
      } finally { latest.current.onBusy(false); }
    } catch {
      if (mounted.current && request === epoch.current) update({ ...before, loading: false, error: 'stats' });
    } finally { if (request === epoch.current) pending.current = false; }
  };
  const open = (action: LocalDataAction) => {
    if (latest.current.busy || current.current || pending.current) return;
    update({ action, stats: null, loading: false, executing: false, error: null, changed: false });
    void read(false);
  };
  return { state, open, cancel, retry: () => { void read(false); }, confirm: () => { void read(true); } };
}
