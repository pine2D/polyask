import { useRef, useState } from "react";

import type { SiteKey } from "../shared/contracts";
import type { BroadcastPayload, BroadcastRequest, SiteStatus } from "../shared/protocol";
import {
  cancelledRunSites,
  completeRun,
  failedRunSites,
  mergeRunResults,
  retryRequest,
  uncertainRunSites,
  type BroadcastRun
} from "./broadcast-run";
import {
  BroadcastFlowState,
  cancelBroadcast,
  runWithBroadcastLock
} from "./broadcast-flow-state";
import type { RunState } from "./command-bar";
import { shell } from "./shell-api";

export function useBroadcastFlow(
  announce: () => void,
  remember: (run: BroadcastRun) => void,
  forget: () => void,
  report: (run: BroadcastRun) => void
): {
  readonly send: (payload: BroadcastPayload) => Promise<BroadcastRun | null>;
  readonly retry: (sites?: SiteKey | readonly SiteKey[], uncertainConfirmed?: boolean, expectedRunId?: string) => Promise<BroadcastRun | null>;
  readonly cancel: () => void;
  readonly invalidate: () => void;
  readonly acceptStatus: (status: SiteStatus) => void;
  readonly runState: RunState;
  readonly retrySites: readonly SiteKey[];
  readonly uncertainSites: readonly SiteKey[];
  readonly runId: string | null;
  readonly activeSites: readonly SiteKey[];
  readonly failureCount: number;
  readonly cancelledCount: number;
} {
  const [run, setRun] = useState<BroadcastRun | null>(null);
  const [activeRequest, setActiveRequest] = useState<BroadcastRequest | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const state = useRef(new BroadcastFlowState()).current;

  const syncState = (): void => {
    setRun(state.run);
    setRunState(state.runState);
  };

  const send = async (payload: BroadcastPayload): Promise<BroadcastRun | null> => {
    return runWithBroadcastLock(state, true, async (operation) => {
      forget();
      syncState();
      try {
        const request: BroadcastRequest = {
          runId: crypto.randomUUID(),
          text: payload.text,
          tier: payload.tier,
          sites: [...payload.sites],
          images: [...payload.images]
        };
        setActiveRequest(request);
        if (!state.commit(operation, completeRun(request, await shell.broadcast(request)))) return null;
        const completed = state.run!;
        setRun(completed);
        remember(completed);
        report(completed);
        return completed;
      } catch {
        if (state.isCurrent(operation)) announce();
        return null;
      }
    }, () => setRunState(state.runState));
  };

  const retry = async (sites?: SiteKey | readonly SiteKey[], uncertainConfirmed = false, expectedRunId?: string): Promise<BroadcastRun | null> => {
    const current = state.run;
    if (expectedRunId !== undefined && expectedRunId !== current?.request.runId) return null;
    const request = current && retryRequest(current, sites, uncertainConfirmed);
    if (!current || !request) return null;
    return runWithBroadcastLock(state, false, async (operation) => {
      state.forgetSent(request.sites);
      syncState();
      try {
        if (!state.commit(operation, mergeRunResults(current, await shell.broadcast(request)))) return null;
        const merged = state.run!;
        setRun(merged);
        remember(merged);
        report(merged);
        return merged;
      } catch {
        if (state.isCurrent(operation)) announce();
        return null;
      }
    }, () => setRunState(state.runState));
  };

  const cancel = (): void => {
    cancelBroadcast(state, setRunState, shell.cancel);
  };
  // 只读状态通道（effect 闭包只捕获首帧，这里只用稳定的 state / setRun / remember / report）：迟到确认升为已发送后去掉重试入口。
  // 空闲时用现有汇总词条重播一次更正后的结果（aria-live 是读屏唯一的进度通道）；发送中的那轮由它自己的回包播报。
  const acceptStatus = (status: SiteStatus): void => {
    if (!state.acceptSubmission(status.site, status.submission) || !state.run) return;
    setRun(state.run);
    remember(state.run);
    if (state.runState === "idle") report(state.run);
  };
  const invalidate = (): void => {
    state.invalidate();
    setActiveRequest(null);
    syncState();
    forget();
  };

  return {
    send,
    retry,
    cancel,
    invalidate,
    acceptStatus,
    runState,
    retrySites: run ? run.request.sites.filter(site => run.results.get(site)?.ok !== true) : [],
    uncertainSites: run ? uncertainRunSites(run) : [],
    runId: activeRequest?.runId ?? run?.request.runId ?? null,
    activeSites: activeRequest?.sites ?? run?.request.sites ?? [],
    failureCount: run ? failedRunSites(run).length : 0,
    cancelledCount: run ? cancelledRunSites(run).length : 0
  };
}
