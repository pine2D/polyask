// desktop/src/renderer/use-proxy-state.ts
// 订阅 polyask:proxy-state-changed，并在挂载时主动读一次 proxy-state。设置卡、同步行与外壳提示都只认这里。
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopCopy } from "../shared/copy";
import { formatCopy } from "../shared/copy";
import { useGlobalFeedback } from "./feedback-provider";
import type { ProxyStateRequest } from "../shared/proxy-state";
import { isProxyStateView, pendingKey, proxyEndpoint, type ProxyStateView } from "./proxy-form";
import { shell } from "./shell-api";

export interface ProxyStateHandle {
  readonly state: ProxyStateView | null;
  /** 主动读取失败或回包形状不对；推送到来后自动恢复。 */
  readonly failed: boolean;
  readonly refresh: () => Promise<void>;
}

/**
 * options.secret 只由设置工作区（设置卡与同步行共用的那一处）传 true：主进程在密码状态 unknown 时后台读一次密码文件（T14）。
 * 其余调用方（外壳顶层待确认提示等）不带标志，启动时不碰 proxy-secret.bin（spec §3.3）。
 */
export function useProxyState(options: ProxyStateRequest = {}): ProxyStateHandle {
  const secret = options.secret === true;
  const [state, setState] = useState<ProxyStateView | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const accept = useCallback((value: unknown): void => {
    if (!alive.current || !isProxyStateView(value)) return;
    setState(value); setFailed(false);
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const value: unknown = await shell.getProxyState(secret ? { secret: true } : undefined);
      if (isProxyStateView(value)) accept(value); else if (alive.current) setFailed(true);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, [accept, secret]);
  useEffect(() => {
    alive.current = true;
    let off: () => void = () => {};
    // 没有代理通道的旧夹具/桥里订阅会抛；设置卡退化为「无法读取」，不连累整个设置页。
    try { off = shell.onProxyState(accept); } catch { off = () => {}; }
    void refresh();
    return () => { alive.current = false; off(); };
  }, [accept, refresh]);
  return { state, failed, refresh };
}

/**
 * 外壳反馈通道的待确认提示（spec §4.5）：同一版本的待确认项只提示一次，附「前往设置」入口。
 * 站点视图里不产任何反馈；这里只用 FeedbackProvider 的底栏与 sr-only live 区。
 */
export function useProxyPendingNotice(copy: DesktopCopy, openSettings: () => void): void {
  const { announce, setNoticeAction } = useGlobalFeedback();
  const { state } = useProxyState(); // 不带 { secret: true }：外壳常驻，启动时不得触发密码读取
  const shown = useRef<string | null>(null);
  const open = useRef(openSettings); open.current = openSettings;
  useEffect(() => {
    const key = pendingKey(state);
    if (key === shown.current) return;
    shown.current = key;
    const pending = state?.pendingConfirm;
    if (!pending) return;
    announce(formatCopy(copy.proxyNoticePending, { endpoint: proxyEndpoint(pending) }));
    setNoticeAction({ label: copy.proxyNoticeOpen, run: () => { setNoticeAction(null); open.current(); } });
  }, [announce, copy, setNoticeAction, state]);
}
