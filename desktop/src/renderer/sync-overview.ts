import type { DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";
import { describeSync } from "./sync-status";

export type SyncOverviewTone = "ok" | "busy" | "attention" | "error" | "off";
export type SyncPrimaryAction = "connect" | "reconnect" | "sync";

export interface SyncOverview {
  readonly title: string;
  readonly detail: string;
  readonly tone: SyncOverviewTone;
  readonly primary: SyncPrimaryAction;
  readonly primaryLabel: string;
}

/** 配置类 OAuth 失败重新授权也解决不了，留给「同步受阻」与诊断。 */
const OAUTH_CONFIG_REASONS = new Set(["oauth_not_configured", "oauth_invalid_client", "oauth_redirect_mismatch"]);

/** 授权链上的失败：令牌已失效或本次授权没完成，「立即同步」只会再失败一次。 */
export function syncNeedsReauthorization(status: SyncStatus): boolean {
  if (!status.connected) return false;
  if (status.state === "auth") return true;
  const reason = status.reason ?? "";
  return reason === "drive_unauthorized" || (reason.startsWith("oauth_") && !OAUTH_CONFIG_REASONS.has(reason));
}

/**
 * 同步卡的单一结论：一个标题、一句说明、一个主操作。
 * 说明只用翻译后的文案；原始原因码只进「复制诊断报告」。
 */
export function syncOverview(copy: DesktopCopy, status: SyncStatus): SyncOverview {
  const detail = describeSync(copy, status);
  if (!status.connected) return { title: copy.syncDisconnected, detail, tone: "off", primary: "connect", primaryLabel: copy.syncConnect };
  if (syncNeedsReauthorization(status)) {
    return { title: copy.syncNeedsReauth, detail, tone: "error", primary: "reconnect", primaryLabel: copy.syncReconnect };
  }
  if (status.state === "syncing") return { title: copy.syncConnected, detail, tone: "busy", primary: "sync", primaryLabel: detail };
  if (status.state === "idle" && !status.reason) return { title: copy.syncConnected, detail, tone: "ok", primary: "sync", primaryLabel: copy.syncNow };
  // 服务繁忙已排定自动重试：仍是「已连接」，只提示等待，可手动提前同步。
  if (status.state === "waiting") return { title: copy.syncConnected, detail, tone: "attention", primary: "sync", primaryLabel: copy.syncNow };
  const tone = status.state === "blocked" || status.state === "error" ? "error" : "attention";
  return { title: copy.syncNeedsAttention, detail, tone, primary: "sync", primaryLabel: copy.syncRetry };
}
