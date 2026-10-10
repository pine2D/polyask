import { RELOAD_COMMIT_CAP_MS } from "./reload-commit";

interface UnloadContents {
  isDestroyed(): boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

const pending = new WeakMap<object, () => void>();

/**
 * 应用发起的导航（新会话、历史恢复、重载、后退/前进、首次加载）不让站点的 beforeunload 拦下。
 * Electron 默认在页面 beforeunload 要求挽留时发 will-prevent-unload 并**静默取消**导航：新会话 20s 后被钉成
 * load_failed、重载停在旧文档上却显示就绪。用户已在应用里做了选择（新会话还有应用内确认），这里只对这一次导航
 * 放行（preventDefault = 忽略挽留、照常卸载）；站点自己发起的导航不受影响。须在发起导航之前调用。
 * 解除：主帧提交（did-navigate）、主帧真失败（非 ERR_ABORTED）、视图销毁、下一次调用或到上限（同重载提交上限）。
 */
export function allowAppNavigationUnload(contents: UnloadContents, capMs = RELOAD_COMMIT_CAP_MS): void {
  pending.get(contents)?.();
  if (contents.isDestroyed()) return;
  const onPrevent = (event: { preventDefault(): void }) => event.preventDefault();
  const onCommit = () => clear();
  const onFail = (_event: unknown, code: number, _description: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame && code !== -3) clear();
  };
  const timer = setTimeout(() => clear(), capMs);
  const clear = () => {
    clearTimeout(timer);
    contents.removeListener("will-prevent-unload", onPrevent);
    contents.removeListener("did-navigate", onCommit);
    contents.removeListener("did-fail-load", onFail);
    contents.removeListener("destroyed", onCommit);
    if (pending.get(contents) === clear) pending.delete(contents);
  };
  contents.on("will-prevent-unload", onPrevent);
  contents.on("did-navigate", onCommit);
  contents.on("did-fail-load", onFail);
  contents.on("destroyed", onCommit);
  pending.set(contents, clear);
}
