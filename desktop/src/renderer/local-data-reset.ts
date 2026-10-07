import type { PendingSynthesis } from "../shared/synthesis";
import { clearDraft } from "./prompt-draft";

interface LocalSessionState {
  readonly setText: (value: string) => void;
  readonly imageSelection: { clear(): void };
  readonly broadcast: { invalidate(): void };
  readonly archiveCapture: { invalidate(): void };
  readonly synthesis: { acceptPending(value: PendingSynthesis | null): void; clearDrafts?(): void };
}

/** 本机库重置成功后同步作废渲染层旧载荷及尚在读取的附件。 */
export function resetLocalSession(storage: Storage, state: LocalSessionState): void {
  clearDraft(storage);
  state.setText("");
  state.imageSelection.clear();
  state.broadcast.invalidate();
  state.archiveCapture.invalidate();
  state.synthesis.acceptPending(null);
  state.synthesis.clearDrafts?.();
}
