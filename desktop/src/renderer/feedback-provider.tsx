import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { DesktopCopy } from "../shared/copy";
import { WORKSPACE_FEEDBACK_HEIGHT } from "../shared/display";

interface FeedbackState {
  readonly announcement: string;
  readonly announcementSeq: number;
  readonly announce: (text: string, visible?: boolean, transient?: boolean) => void;
}
const FeedbackContext = createContext<FeedbackState | null>(null);

export function FeedbackProvider({ children, copy }: { children: ReactNode; copy: DesktopCopy }): React.JSX.Element {
  const [announced, setAnnounced] = useState({ text: "", seq: 0 });
  const [notice, setNotice] = useState({ text: "", seq: 0, transient: false });
  const announce = useCallback((text: string, visible = true, transient = false): void => {
    setAnnounced((current) => ({ text, seq: current.seq + 1 }));
    if (visible) setNotice((current) => ({ text, seq: current.seq + 1, transient }));
  }, []);
  useEffect(() => {
    if (!notice.transient) return;
    const timer = setTimeout(() => setNotice((current) => current.seq === notice.seq ? { ...current, text: "" } : current), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => { document.documentElement.style.setProperty("--feedback-height", `${WORKSPACE_FEEDBACK_HEIGHT}px`); }, []);
  return <FeedbackContext.Provider value={{ announcement: announced.text, announcementSeq: announced.seq, announce }}>
    {children}
    <div className="sr-only" aria-live="polite" aria-atomic="true" key={announced.seq}>{announced.text}</div>
    <footer className="feedback-bar" style={{ height: WORKSPACE_FEEDBACK_HEIGHT }}>
      <span title={notice.text}>{notice.text || copy.feedbackReady}</span>
      {notice.text ? <button type="button" onClick={() => setNotice((current) => ({ ...current, text: "" }))}>{copy.dismissFeedback}</button> : null}
    </footer>
  </FeedbackContext.Provider>;
}

export function useGlobalFeedback(): FeedbackState {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("FeedbackProvider missing");
  return value;
}
