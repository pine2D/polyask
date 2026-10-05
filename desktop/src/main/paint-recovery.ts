import type { EventEmitter } from "node:events";

import { powerMonitor, webContents, type BrowserWindow } from "electron";

import type { DiagnosticSource } from "./runtime-gates";

// 站点视图停帧（I1）：WebContentsView 在被遮挡时（兄弟视图盖住、整窗被别的应用盖住、锁屏、最小化）
// 提交跨文档导航，新文档的 RenderWidgetHost 以 hidden 状态诞生，之后 rAF=0、RO/IO/视图过渡全停，
// 而计时器、MutationObserver 照常、visibilityState 仍是 visible——站点脚本以为自己在前台，实际不出帧。
// invalidate() 无效；在 getBackgroundThrottling() 已是 false 时再设一次 false 会走 Electron 的
// 「IsHidden → ShowWithVisibility(kHiddenButPainting)」分支把它救回来（Linux/Windows 均实测）。
// 只在当前值为 false 时重设：空闲节流实验（idle-throttling.ts）可能刻意把它设成 true，不能覆盖。

export interface PaintableContents {
  isDestroyed(): boolean;
  getBackgroundThrottling(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
}

/** 重新声明「不节流」以唤醒被遮挡期间以 hidden 诞生的渲染部件；返回是否真的重设了。 */
export function reassertPainting(contents: PaintableContents | null | undefined): boolean {
  if (!contents || contents.isDestroyed()) return false;
  if (contents.getBackgroundThrottling() !== false) return false;
  contents.setBackgroundThrottling(false);
  return true;
}

// Electron 没有「窗口不再被遮挡」事件；focus 是用户把窗口切回前台时最接近的信号，show/restore 覆盖
// 最小化与隐藏（Windows 上最小化连从未导航过的视图也会停帧），解锁/唤醒覆盖锁屏。重设在视图本就出帧时
// 是空操作（!IsHidden 不进分支），所以多发几次无害。
export const PAINT_RECOVERY_WINDOW_EVENTS = ["restore", "show", "focus"] as const;
export const PAINT_RECOVERY_POWER_EVENTS = ["unlock-screen", "resume"] as const;
// 事件当下原生窗口可能还没真正可见（合成器尚未把视图标回 shown），补一次延后重设。
// 不在任何群发 deadline 链上，只是一次性的后台补救。
export const PAINT_RECOVERY_SETTLE_MS = 1_000;

interface PaintRecoveryDeps {
  readonly power?: EventEmitter | null;
  readonly fromId?: (id: number) => PaintableContents | null | undefined;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export function startPaintRecovery(
  window: BrowserWindow,
  source: DiagnosticSource,
  deps: PaintRecoveryDeps = {}
): () => void {
  const emitter = window as unknown as EventEmitter;
  const power = deps.power === undefined ? powerMonitor as unknown as EventEmitter : deps.power;
  const fromId = deps.fromId ?? ((id: number) => webContents.fromId(id));
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  let timer: unknown = null;
  let disposed = false;
  const sweep = () => {
    if (disposed || window.isDestroyed()) return;
    for (const site of source.getDiagnosticSites()) reassertPainting(fromId(site.webContentsId));
  };
  const recover = () => {
    sweep();
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; sweep(); }, PAINT_RECOVERY_SETTLE_MS);
  };
  for (const event of PAINT_RECOVERY_WINDOW_EVENTS) emitter.on(event, recover);
  for (const event of PAINT_RECOVERY_POWER_EVENTS) power?.on(event, recover);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const event of PAINT_RECOVERY_WINDOW_EVENTS) emitter.removeListener(event, recover);
    for (const event of PAINT_RECOVERY_POWER_EVENTS) power?.removeListener(event, recover);
    emitter.removeListener("closed", dispose);
  };
  emitter.on("closed", dispose);
  return dispose;
}
