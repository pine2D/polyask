import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DesktopCopy } from "../shared/copy";
import { useControlHint } from "./control-hints";
import { WORKSPACE_FEEDBACK_HEIGHT } from "../shared/display";

interface FeedbackAction { readonly label: string; readonly run: () => void; }

interface FeedbackState {
  readonly workspaceHost: HTMLElement | null;
  readonly setUndoAction: (action: FeedbackAction | null) => void;
  readonly setNoticeAction: (action: FeedbackAction | null) => void;
  readonly setIdleAction: (action: FeedbackAction | null) => void;
  readonly announcement: string;
  readonly announcementSeq: number;
  readonly announce: (text: string, visible?: boolean, transient?: boolean) => void;
  readonly clearNotice: (text: string) => void;
  /** 无操作反馈时底栏显示的当前状态（由命令栏按选站/失败/未确认计数提供）。 */
  readonly setIdleNotice?: (text: string | null) => void;
}
const FeedbackContext = createContext<FeedbackState | null>(null);

export function FeedbackProvider({ children, copy }: { children: ReactNode; copy: DesktopCopy }): React.JSX.Element {
  const hintId = useId();
  const [workspaceHost, setWorkspaceHost] = useState<HTMLElement | null>(null);
  const [undoAction, setUndoAction] = useState<FeedbackAction | null>(null);
  const [noticeAction, setNoticeAction] = useState<FeedbackAction | null>(null);
  const [announced, setAnnounced] = useState({ text: "", seq: 0 });
  const [notice, setNotice] = useState({ text: "", seq: 0, transient: false });
  const [idleNotice, setIdleNotice] = useState<string | null>(null);
  const [idleAction, setIdleAction] = useState<FeedbackAction | null>(null);
  const [live, setLive] = useState("");
  const hint = useControlHint(hintId, notice.seq);
  const announce = useCallback((text: string, visible = true, transient = false): void => {
    setAnnounced((current) => ({ text, seq: current.seq + 1 }));
    if (visible) { setNoticeAction(null); setNotice((current) => ({ text, seq: current.seq + 1, transient })); }
  }, []);
  const clearNotice = useCallback((text: string): void => {
    setNotice((current) => current.text === text ? { ...current, text: "" } : current);
  }, []);
  useEffect(() => {
    if (!notice.transient) return;
    const timer = setTimeout(() => setNotice((current) => current.seq === notice.seq ? { ...current, text: "" } : current), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => { document.documentElement.style.setProperty("--feedback-height", `${WORKSPACE_FEEDBACK_HEIGHT}px`); }, []);
  // R33：live 区节点常驻；每次播报先清空，下一帧再写入，同文重复播报也会被读屏重新读出。
  useEffect(() => {
    setLive("");
    if (!announced.seq) return;
    const frame = typeof requestAnimationFrame === "function";
    const handle = frame ? requestAnimationFrame(() => setLive(announced.text)) : setTimeout(() => setLive(announced.text), 16);
    return () => { if (frame) cancelAnimationFrame(handle as number); else clearTimeout(handle); };
  }, [announced]);
  return <FeedbackContext.Provider value={{ workspaceHost, announcement: announced.text, announcementSeq: announced.seq, announce, clearNotice, setUndoAction, setNoticeAction, setIdleNotice, setIdleAction }}>
    {children}
    <div className="sr-only" aria-live="polite" aria-atomic="true">{live}</div>
    <footer className="feedback-bar" data-hint-visible={!!hint} data-has-notice={!!notice.text} style={{ height: WORKSPACE_FEEDBACK_HEIGHT }}>
      <span className="feedback-notice" hidden={!notice.text && !!hint} title={notice.text || (idleNotice ?? "")}>{notice.text || idleNotice || copy.feedbackReady}</span>
      <span className="feedback-hint" id={hintId} role={hint ? "tooltip" : undefined} hidden={!hint} title={hint}>{hint}</span>
      <div className="feedback-workspace" ref={setWorkspaceHost} />
      {!(notice.text && noticeAction) && !undoAction && idleAction ? <button type="button" className="feedback-next-step" onClick={idleAction.run}>{idleAction.label}</button> : null}
      {undoAction ? <button type="button" onClick={undoAction.run}>{undoAction.label}</button> : null}
      {notice.text && noticeAction ? <button type="button" onClick={noticeAction.run}>{noticeAction.label}</button> : null}
      {notice.text ? <button type="button" onClick={() => setNotice((current) => ({ ...current, text: "" }))}>{copy.dismissFeedback}</button> : null}
    </footer>
  </FeedbackContext.Provider>;
}

/** 命令栏等宿主上报空闲状态；没有 FeedbackProvider 的独立夹具里是空操作。 */
export function useIdleNotice(text: string): void {
  const set = useContext(FeedbackContext)?.setIdleNotice;
  useEffect(() => { set?.(text); }, [set, text]);
  useEffect(() => () => set?.(null), [set]);
}

/** 下一步只在可用时出现；错误恢复与撤销始终优先，回调随当前工作范围更新。 */
export function useIdleAction(label: string, run: (() => void) | undefined): void {
  const set = useContext(FeedbackContext)?.setIdleAction;
  const latest = useRef(run); latest.current = run;
  const available = !!run;
  useEffect(() => {
    set?.(available ? { label, run: () => latest.current?.() } : null);
    return () => set?.(null);
  }, [set, label, available]);
}

export function useGlobalFeedback(): FeedbackState {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("FeedbackProvider missing");
  return value;
}
