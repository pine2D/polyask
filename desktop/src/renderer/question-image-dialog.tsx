import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopImage } from '../shared/images';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { focusableControls } from './focusable-controls';
import { CloseIcon } from './icons';

export function QuestionImageDialog({ image, number, count, copy, onClose }: {
  image: DesktopImage; number: number; count: number; copy: DesktopCopy; onClose: () => void;
}) {
  const [size, setSize] = useState<'fit' | 'actual'>('fit');
  const panel = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null), latest = useRef(onClose); latest.current = onClose;
  useLayoutEffect(() => { if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } }, [size]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) { if (event.key === 'Escape') event.stopImmediatePropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); latest.current(); }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = focusableControls(panel.current), first = controls[0], last = controls[controls.length - 1];
      const active = document.activeElement;
      if (active === panel.current || !panel.current.contains(active) || (event.shiftKey && active === first)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div className="confirm-scrim question-image-scrim" onMouseDown={event => {
    if (event.target === event.currentTarget) { event.preventDefault(); panel.current?.focus(); }
  }}>
    <div ref={panel} tabIndex={-1} className="question-image-dialog" data-size={size} role="dialog" aria-modal="true" aria-labelledby="question-image-title">
      <header className="question-image-header">
        <h2 id="question-image-title"><bdi title={image.name}>{image.name}</bdi><span>{formatCopy(copy.questionOriginalPosition, { number, count })}</span></h2>
        <div className="question-image-controls">
          <button type="button" aria-pressed={size === 'fit'} onClick={() => setSize('fit')}>{copy.questionOriginalFit}</button>
          <button type="button" aria-pressed={size === 'actual'} onClick={() => setSize('actual')}>{copy.questionOriginalActual}</button>
          <button type="button" className="question-image-close" ref={close} onClick={onClose} aria-label={copy.questionOriginalClose} title={copy.questionOriginalClose}><CloseIcon /></button>
        </div>
      </header>
      <div ref={viewport} className="question-image-viewport" role="region" tabIndex={0} aria-labelledby="question-image-title">
        <div className="question-image-canvas"><img src={image.dataUrl} alt={image.name} /></div>
      </div>
    </div>
  </div>;
}
