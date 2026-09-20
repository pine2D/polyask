import { useEffect, useRef } from 'react';
import type { DesktopCopy } from '../shared/copy';

export function FolderModal({ copy, title, busy, onCancel, children }: {
  copy: DesktopCopy; title: string; busy: boolean; onCancel: () => void; children: React.ReactNode;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const latest = useRef({ busy, onCancel }); latest.current = { busy, onCancel };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!latest.current.busy) latest.current.onCancel(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
      const current = nodes.indexOf(document.activeElement as HTMLElement);
      if (current < 0 || (!event.shiftKey && current === nodes.length - 1) || (event.shiftKey && current === 0)) {
        event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); opener?.focus(); };
  }, []);
  return <div className="confirm-scrim"><div className="confirm-dialog folder-modal" ref={panel} role="dialog" aria-modal="true" aria-labelledby="folder-modal-title" aria-busy={busy}>
    <header><h2 id="folder-modal-title">{title}</h2><button ref={cancel} disabled={busy} onClick={onCancel}>{copy.cancel}</button></header>{children}
  </div></div>;
}
