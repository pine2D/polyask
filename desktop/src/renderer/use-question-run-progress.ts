import { useEffect, useRef, useState } from 'react';
import type { QuestionRunProgress } from '../shared/question-run-progress';
import { shell } from './shell-api';

export function useQuestionRunProgress(runId: string | null, bootstrap?: QuestionRunProgress | null): {
  readonly value: QuestionRunProgress | null;
  readonly runId: string | null;
  readonly invalidate: () => void;
} {
  const [value, setValue] = useState<QuestionRunProgress | null>(null);
  const [reset, setReset] = useState(0);
  const epoch = useRef(0), fallbackDisabled = useRef(false), suppressed = useRef<string | null>(null);
  const target = runId ?? (fallbackDisabled.current ? null : bootstrap?.runId ?? null);
  const current = useRef(target); current.current = target;
  useEffect(() => {
    const ticket = ++epoch.current;
    if (!target || suppressed.current === target) { setValue(null); return; }
    suppressed.current = null;
    const active = () => ticket === epoch.current && current.current === target;
    const accept = (next: QuestionRunProgress | null) => {
      if (!active() || !next || next.runId !== target) return;
      setValue(old => old?.runId === target && old.revision >= next.revision ? old : next);
    };
    if (bootstrap?.runId === target) accept(bootstrap);
    const read = () => {
      void shell.getQuestionRunProgress(target).then(accept).catch(() => { if (active()) setValue(null); });
    };
    const offProgress = shell.onQuestionRunProgress(accept);
    const offSync = shell.onSyncStatus(read);
    read();
    return () => { epoch.current++; offProgress(); offSync(); };
  }, [target, bootstrap, reset]);
  return { value: value?.runId === target && suppressed.current !== target ? value : null, runId: target,
    invalidate: () => { fallbackDisabled.current = true; suppressed.current = target; epoch.current++;
      setValue(null); setReset(old => old + 1); } };
}
