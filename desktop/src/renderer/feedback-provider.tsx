import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import type { DesktopCopy } from "../shared/copy";
import { useControlHint } from "./control-hints";
import { WORKSPACE_FEEDBACK_HEIGHT } from "../shared/display";

interface FeedbackAction { readonly label: string; readonly run: () => void; }

interface FeedbackState {
  readonly setUndoAction: (action: FeedbackAction | null) => void;
  readonly announcement: string;
  readonly announcementSeq: number;
  readonly announce: (text: string, visible?: boolean, transient?: boolean) => void;
  readonly clearNotice: (text: string) => void;
}
const FeedbackContext = createContext<FeedbackState | null>(null);

export function FeedbackProvider({ children, copy }: { children: ReactNode; copy: DesktopCopy }): React.JSX.Element {
  const hintId = useId();
  const [undoAction, setUndoAction] = useState<FeedbackAction | null>(null);
  const [announced, setAnnounced] = useState({ text: "", seq: 0 });
  const [notice, setNotice] = useState({ text: "", seq: 0, transient: false });
  const hint = useControlHint(hintId, notice.seq);
  const announce = useCallback((text: string, visible = true, transient = false): void => {
    setAnnounced((current) => ({ text, seq: current.seq + 1 }));
    if (visible) setNotice((current) => ({ text, seq: current.seq + 1, transient }));
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
  return <FeedbackContext.Provider value={{ announcement: announced.text, announcementSeq: announced.seq, announce, clearNotice, setUndoAction }}>
    {children}
    <div className="sr-only" aria-live="polite" aria-atomic="true" key={announced.seq}>{announced.text}</div>
    <footer className="feedback-bar" data-hint-visible={!!hint} style={{ height: WORKSPACE_FEEDBACK_HEIGHT }}>
      <span id={hintId} role={hint ? "tooltip" : undefined} title={hint || notice.text}>{hint || notice.text || copy.feedbackReady}</span>
      {undoAction ? <button type="button" onClick={undoAction.run}>{undoAction.label}</button> : null}
      {notice.text ? <button type="button" onClick={() => setNotice((current) => ({ ...current, text: "" }))}>{copy.dismissFeedback}</button> : null}
    </footer>
  </FeedbackContext.Provider>;
}

export function useGlobalFeedback(): FeedbackState {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("FeedbackProvider missing");
  return value;
}
