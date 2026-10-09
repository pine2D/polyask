import type { PendingSynthesis } from "../shared/synthesis";
import { clearDraft } from "./prompt-draft";
import { writeWorkbenchGuidePreference } from './local-ui-preferences';
import { COMPLETION_NOTIFICATIONS_KEY } from './completion-notification-preference';
import { invalidatePersistentDrafts } from './use-persistent-draft';

interface LocalSessionState {
  readonly setText: (value: string) => void;
  readonly imageSelection: { clear(): void };
  readonly broadcast: { invalidate(): void };
  readonly archiveCapture: { invalidate(): void };
  readonly synthesis: { acceptPending(value: PendingSynthesis | null): void; clearDrafts?(): void };
  readonly guide?: { invalidate(): void };
  readonly onGuidePreferenceFailed?: () => void;
}

/** 本机库重置成功后同步作废渲染层旧载荷及尚在读取的附件。 */
export function resetLocalSession(storage: Storage, state: LocalSessionState): void {
  invalidatePersistentDrafts();
  let preferenceFailed = false;
  try { storage.removeItem(COMPLETION_NOTIFICATIONS_KEY); }
  catch { preferenceFailed = true; }
  state.guide?.invalidate();
  if (!writeWorkbenchGuidePreference(storage, null)) preferenceFailed = true;
  if (preferenceFailed) state.onGuidePreferenceFailed?.();
  clearDraft(storage);
  state.setText("");
  state.imageSelection.clear();
  state.broadcast.invalidate();
  state.archiveCapture.invalidate();
  state.synthesis.acceptPending(null);
  state.synthesis.clearDrafts?.();
}
