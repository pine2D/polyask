import { useEffect, useRef, useState } from "react";
import { DraftRevision, loadDraft, saveDraft } from "./prompt-draft";

export function usePromptDraft() {
  const [text, updateText] = useState(() => loadDraft(window.localStorage).text);
  const revision = useRef(new DraftRevision()).current;
  const setText = (value: string): void => { revision.edit(); updateText(value); };
  useEffect(() => { saveDraft(window.localStorage, text); }, [text]);
  return {
    text, setText, revision,
    clearSent: (sentRevision: number): void => {
      if (revision.isCurrent(sentRevision)) setText("");
    }
  };
}
