import { useLayoutEffect, useRef } from 'react';

interface Attempt {
  readonly target: HTMLElement;
  moved: boolean;
  restore?: boolean;
  stop: () => void;
}

// 禁用控件会让 Chromium 将焦点移至 BODY；操作完成后仅恢复非主动丢失的焦点。
export function useActionFocus(busy: boolean, resolveTarget: (target: HTMLElement) => HTMLElement | null = target => target) {
  const pending = useRef<Attempt | null>(null);
  useLayoutEffect(() => () => { pending.current?.stop(); pending.current = null; }, []);
  useLayoutEffect(() => {
    const attempt = pending.current;
    if (busy || !attempt || attempt.restore === undefined) return;
    pending.current = null; attempt.stop();
    const original = attempt.target, doc = original.ownerDocument;
    if (!attempt.restore || attempt.moved || !original.isConnected || original.closest('[hidden],[inert]')) return;
    if (doc.activeElement !== doc.body && doc.activeElement !== original) return;
    const target = resolveTarget(original);
    if (target?.isConnected && !target.matches(':disabled') && !target.closest('[hidden],[inert]')) target.focus({ preventScroll: true });
  });
  return () => {
    pending.current?.stop(); pending.current = null;
    const target = document.activeElement;
    if (!(target instanceof HTMLElement) || target === document.body) return (_restore: boolean) => {};
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
    return (restore: boolean) => { attempt.restore = restore; };
  };
}
