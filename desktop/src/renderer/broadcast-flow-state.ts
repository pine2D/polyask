import type { SiteKey } from "../shared/contracts";
import type { SubmissionStatus } from "../shared/protocol";
import { acceptSubmissionEvidence, type BroadcastRun } from "./broadcast-run";
import type { RunState } from "./command-bar";

export interface BroadcastOperation {
  readonly generation: number;
}

export class ExclusiveActionLock {
  private active = false;

  async run<T>(action: () => Promise<T>): Promise<T | null> {
    if (this.active) return null;
    this.active = true;
    try {
      return await action();
    } finally {
      this.active = false;
    }
  }
}

export class BroadcastFlowState {
  private generation = 0;
  private activeGeneration: number | null = null;
  private currentRun: BroadcastRun | null = null;
  private phase: RunState = "idle";
  // 群发回包前可先收到同轮已发送证据，保留其档位/证据类型，避免不确定回包重新开放重试。
  // 新一轮清空；重试的站和后续非 sent 状态各自作废。
  private readonly sent = new Map<SiteKey, SubmissionStatus>();

  get run(): BroadcastRun | null {
    return this.currentRun;
  }

  get runState(): RunState {
    return this.phase;
  }

  begin(clearRun: boolean): BroadcastOperation | null {
    if (this.activeGeneration !== null) return null;
    this.generation += 1;
    this.activeGeneration = this.generation;
    if (clearRun) { this.currentRun = null; this.sent.clear(); }
    this.phase = "sending";
    return { generation: this.generation };
  }

  commit(operation: BroadcastOperation, run: BroadcastRun): boolean {
    if (!this.isCurrent(operation)) return false;
    this.currentRun = this.withSent(run);
    return true;
  }

  /** 重试前作废这些站的旧「已发送」证据：新尝试的结论只能来自新尝试。 */
  forgetSent(sites: readonly SiteKey[]): void {
    for (const site of sites) this.sent.delete(site);
  }

  /** 记下状态通道的提交态；当前一轮因此变化（迟到确认升为已发送）时返回 true。 */
  acceptSubmission(site: SiteKey, submission: SubmissionStatus | undefined): boolean {
    if (!submission) return false;
    if (submission.state !== "sent") { this.sent.delete(site); return false; }
    this.sent.set(site, submission);
    if (!this.currentRun) return false;
    const next = acceptSubmissionEvidence(this.currentRun, site, submission);
    if (next === this.currentRun) return false;
    this.currentRun = next;
    return true;
  }

  private withSent(run: BroadcastRun): BroadcastRun {
    let next = run;
    for (const [site, submission] of this.sent) next = acceptSubmissionEvidence(next, site, submission);
    return next;
  }

  settle(operation: BroadcastOperation): boolean {
    if (operation.generation !== this.activeGeneration) return false;
    this.activeGeneration = null;
    this.phase = "idle";
    return true;
  }

  cancel(): void {
    this.phase = "cancelling";
  }

  invalidate(): void {
    this.generation += 1;
    this.currentRun = null;
    this.sent.clear();
    if (this.activeGeneration === null) this.phase = "idle";
  }

  isCurrent(operation: BroadcastOperation): boolean {
    return operation.generation === this.generation;
  }
}

export async function runWithBroadcastLock<T>(
  state: BroadcastFlowState,
  clearRun: boolean,
  task: (operation: BroadcastOperation) => Promise<T>,
  onSettled: () => void
): Promise<T | null> {
  const operation = state.begin(clearRun);
  if (!operation) return null;
  try {
    return await task(operation);
  } finally {
    if (state.settle(operation)) onSettled();
  }
}

export function cancelBroadcast(
  state: BroadcastFlowState,
  publish: (runState: RunState) => void,
  cancelIpc: () => void
): void {
  state.cancel();
  publish(state.runState);
  cancelIpc();
}
