import { useEffect, useRef, useState } from "react";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { PromptLibraryState } from "../shared/prompt-library";
import { useGlobalFeedback } from "./feedback-provider";
import { UndoableDeletions } from "./template-delete";
import { shell } from "./shell-api";

export function useTemplateDeletion(library: PromptLibraryState, accept: (state: PromptLibraryState) => void, copy: DesktopCopy) {
  const { announce, setUndoAction } = useGlobalFeedback();
  const [deleting, setDeleting] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const queue = useRef<UndoableDeletions | null>(null);
  if (!queue.current) queue.current = new UndoableDeletions(
    (id) => {
      setDeleting((current) => [...current, id]);
      void shell.deletePromptTemplate(id).then((state) => { accept(state); announce(copy.templateDeleted, true, true); })
        .catch(() => announce(copy.promptLibraryDeleteFailed))
        .finally(() => setDeleting((current) => current.filter((key) => key !== id)));
    },
    () => setPending(queue.current!.ids)
  );
  useEffect(() => () => { queue.current!.dispose(); }, []);
  useEffect(() => {
    setUndoAction(pending.length ? {
      label: formatCopy(copy.undoTemplateDelete, { count: pending.length }),
      run: () => { queue.current!.undo(); announce(copy.templateDeleteUndone, true, true); }
    } : null);
    return () => setUndoAction(null);
  }, [pending, copy, announce, setUndoAction]);
  return {
    library: { ...library, templates: library.templates.filter((template) => !pending.includes(template.id) && !deleting.includes(template.id)) },
    request: (id: string): void => {
      if (!library.templates.some((template) => template.id === id)) return;
      queue.current!.add(id);
      announce(copy.templateDeletePending);
    }
  };
}
