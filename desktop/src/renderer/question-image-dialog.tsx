import { useEffect, useRef } from 'react';
import type { DesktopImage } from '../shared/images';
import type { DesktopCopy } from '../shared/copy';

export function QuestionImageDialog({ image, copy, onClose }: { image: DesktopImage; copy: DesktopCopy; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null), latest = useRef(onClose); latest.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) { if (event.key === 'Escape') event.stopImmediatePropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); latest.current(); }
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div className="confirm-scrim question-image-scrim">
    <div className="question-image-dialog" role="dialog" aria-modal="true" aria-label={image.name}>
      <button type="button" ref={close} onClick={onClose} aria-label={copy.questionOriginalClose}>{copy.questionOriginalClose}</button>
      <img src={image.dataUrl} alt={image.name} />
    </div>
  </div>;
}
