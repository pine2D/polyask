import { useLayoutEffect, useRef } from 'react';

interface Attempt {
  readonly target: HTMLElement;
  moved: boolean;
  failed?: boolean;
  stop: () => void;
}

// 禁用控件会让 Chromium 将焦点移至 BODY；失败后只恢复本次丢失的位置。
export function useFailedActionFocus(busy: boolean) {
  const pending = useRef<Attempt | null>(null);
  useLayoutEffect(() => () => { pending.current?.stop(); pending.current = null; }, []);
  useLayoutEffect(() => {
    const attempt = pending.current;
    if (busy || !attempt || attempt.failed === undefined) return;
    pending.current = null; attempt.stop();
    const { target } = attempt, doc = target.ownerDocument;
    if (attempt.failed && !attempt.moved && target.isConnected && !target.matches(':disabled') && doc.activeElement === doc.body) {
      target.focus({ preventScroll: true });
    }
  });
  return () => {
    pending.current?.stop(); pending.current = null;
    const target = document.activeElement;
    if (!(target instanceof HTMLElement) || target === document.body) return (_failed: boolean) => {};
    const doc = target.ownerDocument, win = doc.defaultView;
    const attempt: Attempt = { target, moved: false, stop: () => {
      doc.removeEventListener('focusin', focus); doc.removeEventListener('keydown', move, true);
      doc.removeEventListener('pointerdown', move, true); win?.removeEventListener('blur', move);
    } };
    const move = () => { attempt.moved = true; };
    const focus = (event: FocusEvent) => { if (event.target !== target && event.target !== doc.body) move(); };
    doc.addEventListener('focusin', focus); doc.addEventListener('keydown', move, true);
    doc.addEventListener('pointerdown', move, true); win?.addEventListener('blur', move);
    pending.current = attempt;
    return (failed: boolean) => { attempt.failed = failed; };
  };
}
