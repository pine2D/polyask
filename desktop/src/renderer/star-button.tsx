import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { StarIcon } from './icons';

/** Keep focus while saving; only the acknowledged record changes the visible star. */
export function StarButton({ starred, copy, title, disabled = false, onChange, onError }: {
  starred: boolean; copy: DesktopCopy; title?: string; disabled?: boolean;
  onChange: () => Promise<unknown>; onError?: () => void;
}) {
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const label = starred ? copy.unfavoriteArchive : copy.favoriteArchive;
  return <span className="star-control">
    <button type="button" className="star-button" data-star-button aria-pressed={starred}
      aria-label={title ? `${label}: ${title}` : label} title={pending ? copy.librarySaving : label}
      disabled={disabled} aria-disabled={pending || undefined} aria-busy={pending || undefined}
      onClick={async event => {
        if (disabled || locked.current) return;
        const button = event.currentTarget;
        const root = button.closest('.folder-content-list, .question-browser');
        const buttons = [...(root?.querySelectorAll<HTMLButtonElement>('[data-star-button]') ?? [])];
        const index = buttons.indexOf(button);
        const next = buttons[index + 1] ?? buttons[index - 1];
        locked.current = true; setPending(true); setFailed(false);
        try {
          await onChange();
          // Removing a row in the starred view must leave a usable keyboard position.
          const restoreFocus = () => {
            if (button.isConnected || !root?.isConnected || document.activeElement !== document.body || !document.hasFocus()) return;
            (next?.isConnected ? next : root.querySelector<HTMLButtonElement>('[data-star-filter]'))?.focus({ preventScroll: true });
          };
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restoreFocus);
          else restoreFocus();
        } catch {
          if (mounted.current) { setFailed(true); onError?.(); }
        } finally { locked.current = false; if (mounted.current) setPending(false); }
      }}><StarIcon /></button>
    {failed && <span className="star-error" role="alert">{copy.starSaveFailed}</span>}
  </span>;
}

export function StarFilter({ active, copy, disabled, onChange }: {
  active: boolean; copy: DesktopCopy; disabled?: boolean; onChange: () => void;
}) {
  return <button type="button" className="star-filter" data-star-filter aria-pressed={active}
    aria-label={copy.favoriteArchives} title={copy.favoriteArchives} disabled={disabled} onClick={onChange}>
    <StarIcon /><span>{copy.starredFilter}</span>
  </button>;
}
