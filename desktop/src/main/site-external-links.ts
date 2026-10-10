import type { NavigationDisposition } from "./navigation";

/**
 * 被视图拒绝、应改交用户浏览器的目标：外部 https 域，以及任何明文 http:// 链接。
 * 后者在 navigationDisposition 里是 block（受管视图绝不降级到明文加载，登录链 302 放行也不认它），
 * 但用户点到的 http 链接不该静默无反应；最终仍经 safeExternalUrl 校验才交给系统浏览器。
 */
export function handsOffToBrowser(disposition: NavigationDisposition, url: string): boolean {
  if (disposition === "external") return true;
  if (disposition !== "block") return false;
  try { return new URL(url).protocol === "http:"; } catch { return false; }
}

// 用户确实操作了这个视图的输入：点击、按键、触摸。mouseMove/滚轮不算，否则悬停就能给第三方脚本授权。
const GESTURES = new Set(["mouseDown", "mouseUp", "rawKeyDown", "keyDown", "touchStart", "touchEnd", "gestureTap"]);

// 一次手势后允许转交的窗口。点引用链接到 window.open 通常是同一事件循环；留给站点先发请求再打开的余量。
export const EXTERNAL_OPEN_GESTURE_MS = 10_000;

/**
 * 站点视图转交外部浏览器的闸门：须有近期用户输入，且一次输入只放行一次。
 * window.open 不带发起帧，任何嵌入的第三方 iframe 都能调用；不设闸就能在用户毫无操作时反复拉起系统浏览器。
 */
export class ExternalOpenGate {
  private armedUntil = 0;

  constructor(private readonly windowMs = EXTERNAL_OPEN_GESTURE_MS, private readonly now: () => number = Date.now) {}

  noteInput(type: string | undefined): void {
    if (type && GESTURES.has(type)) this.armedUntil = this.now() + this.windowMs;
  }

  take(): boolean {
    if (this.now() > this.armedUntil) return false;
    this.armedUntil = 0;
    return true;
  }
}
