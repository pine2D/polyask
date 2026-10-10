import { useEffect, useRef } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { focusableControls } from './focusable-controls';

export function FolderModal({ copy, title, busy, onCancel, children, closeLabel }: {
  copy: DesktopCopy; title: string; busy: boolean; onCancel: () => void; children: React.ReactNode;
  /** 只读/浏览类弹窗不是事务，头部按钮写「关闭」而不是「取消」。 */
  closeLabel?: string;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const latest = useRef({ busy, onCancel }); latest.current = { busy, onCancel };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (event.isComposing || event.keyCode === 229)) { event.stopImmediatePropagation(); return; }
      if (panel.current?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!latest.current.busy) latest.current.onCancel(); }
      if (event.key !== 'Tab') return;
      const nodes = panel.current ? focusableControls(panel.current) : [];
      if (!nodes.length) { event.preventDefault(); panel.current?.focus(); return; }
      const current = nodes.indexOf(document.activeElement as HTMLElement);
      if (current < 0 || (!event.shiftKey && current === nodes.length - 1) || (event.shiftKey && current === 0)) {
        event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); opener?.focus(); };
  }, []);
  return <div className="confirm-scrim"><div className="confirm-dialog folder-modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="folder-modal-title" aria-busy={busy}>
    <header><h2 id="folder-modal-title">{title}</h2><button ref={cancel} disabled={busy} onClick={onCancel}>{closeLabel ?? copy.cancel}</button></header>{children}
  </div></div>;
}
