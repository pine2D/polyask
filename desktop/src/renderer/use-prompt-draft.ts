import { useEffect, useRef, useState } from "react";
import { DraftRevision, loadDraft, saveDraft } from "./prompt-draft";
import { getCopy, type DesktopCopy } from '../shared/copy';
import type { DraftReceipt } from './draft-receipt';
import { usePersistentDraft } from './use-persistent-draft';

export function usePromptDraft(copy?: DesktopCopy) {
  const [text, updateText] = useState(() => loadDraft(window.localStorage).text);
  const revision = useRef(new DraftRevision()).current;
  const setText = (value: string): void => { revision.edit(); updateText(value); };
  useEffect(() => { saveDraft(window.localStorage, text); }, [text]);
  const persistent = usePersistentDraft({ kind: 'prompt', context: 'composer', title: [...text].slice(0, 160).join(''),
    content: { text }, dirty: text.length > 0, copy: copy ?? getCopy(navigator.language), onRestore: content => {
      if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
      const restored = (content as { text?: unknown }).text;
      if (typeof restored !== 'string' || [...restored].length > 100_000) return false;
      setText(restored); return true;
    } });
  return {
    text, setText, revision, recovery: persistent.recovery, flushDraft: persistent.flush,
    clearSent: (sentRevision: number, savedDraft?: DraftReceipt): void => {
      if (!revision.isCurrent(sentRevision)) return;
      void persistent.clearSaved(savedDraft); setText('');
    }
  };
}
