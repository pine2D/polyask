import type { WebContentsView } from "electron";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import {
  normalizeSubmitted,
  type CollectSiteCommand,
  type SiteCollectionResult,
  type SiteResult,
  type SiteSubmittedResponse,
  type SubmitSiteCommand,
  type WasSubmittedSiteCommand
} from "../shared/protocol";
import { navigationDisposition } from "./navigation";
import type { SiteCommandChannel } from "./site-command-channel";
import { SITES } from "./sites";

export function sendSiteCommand(
  site: SiteKey,
  view: WebContentsView | undefined,
  pageFailure: string | null,
  reloading: boolean,
  commands: SiteCommandChannel,
  command: SubmitSiteCommand,
  signal: AbortSignal,
  replace: (definition: SiteDefinition, view: WebContentsView, url: string) => void
): Promise<SiteResult> {
  if (!view || view.webContents.isDestroyed()) {
    return Promise.resolve({ ok: false, code: "no_view" });
  }
  // A crashed or failed page has no preload left to answer, so the request
  // would burn the whole budget and land on submit_unconfirmed — "maybe sent".
  // It was never dispatched, so report the certain failure instead. Never
  // reload and resend here: automatic resends are forbidden.
  if (pageFailure) return Promise.resolve({ ok: false, code: pageFailure });
  const definition = SITES.find((candidate) => candidate.key === site);
  if (!definition || reloading || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
    return Promise.resolve({ ok: false, code: "not_ready" });
  }
  return commands.send(view.webContents, command, {
    signal,
    timeoutResult: { ok: false, code: "submit_unconfirmed" },
    onAbort: () => {
      if (view.webContents.isDestroyed()) return;
      replace(definition, view, view.webContents.getURL() || definition.url);
    }
  }).then((result) => "ok" in result ? result : { ok: false, code: "invalid_response" });
}

// 只读确认，配合 BroadcastCoordinator 的 submit_unconfirmed 恢复。页面有回包才归一（fail-closed）；
// 通道超时/取消返回 null = 这一次没人应答（页面重挂中），协调器会在窗口内再问，不能读成「不支持」。
export function confirmSiteSubmitted(
  view: WebContentsView | undefined,
  commands: SiteCommandChannel,
  command: WasSubmittedSiteCommand,
  signal: AbortSignal
): Promise<SiteSubmittedResponse | null> {
  if (!view || view.webContents.isDestroyed()) return Promise.resolve({ supported: false, ok: false });
  return commands.send(view.webContents, command, { signal, timeoutResult: { ok: false, code: "timeout" } })
    .then((result) => "supported" in result ? normalizeSubmitted(result) : null);
}

export function collectSiteAnswer(
  site: SiteKey,
  view: WebContentsView | undefined,
  pageFailure: string | null,
  reloading: boolean,
  commands: SiteCommandChannel,
  deadline: number
): Promise<SiteCollectionResult> {
  if (!view || view.webContents.isDestroyed()) return Promise.resolve({ code: "no_view" });
  if (pageFailure) return Promise.resolve({ code: pageFailure });
  const definition = SITES.find((candidate) => candidate.key === site);
  if (!definition || reloading || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
    return Promise.resolve({ code: "not_ready" });
  }
  const command: CollectSiteCommand = { source: "AMS", cmd: "collect", deadline };
  return commands.send(view.webContents, command, { timeoutResult: { code: "not_ready" } })
    .then((result): SiteCollectionResult => "ok" in result ? { code: "not_ready" } : result as SiteCollectionResult);
}
