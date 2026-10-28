import { useEffect, useRef } from 'react';
import { shell } from './shell-api';

const PANELS = '.command-surface,.settings-workspace,.folder-workspace,.workspace-drawer,.question-history,.image-tray,.confirm-scrim';
interface Anchor { element: HTMLElement; id: string; label: string | null; name: string | null; classes: string; }

function resolveAnchor(anchor: Anchor | null): HTMLElement | null {
  if (!anchor) return document.querySelector('.scope-main');
  if (anchor.element.isConnected && !anchor.element.closest('[inert],[hidden]')) return anchor.element;
  if (anchor.id) return document.getElementById(anchor.id);
  return [...document.querySelectorAll<HTMLElement>(anchor.element.tagName)].find(node =>
    !node.closest(`${PANELS},[inert],[hidden]`) && (anchor.label ? node.getAttribute('aria-label') === anchor.label
      : anchor.name ? node.getAttribute('name') === anchor.name : !!anchor.classes && node.className === anchor.classes))
    ?? document.querySelector('.scope-main');
}

/** DOM openers may be recreated when the whole surface changes; native sources belong to main. */
export function usePanelFocusReturn(active: boolean): void {
  const current = useRef(active), previous = useRef(active), epoch = useRef(0), anchor = useRef<Anchor | null>(null);
  current.current = active;
  useEffect(() => {
    const remember = () => {
      const element = document.activeElement;
      if (current.current || previous.current || !(element instanceof HTMLElement) || element === document.body || element.closest(PANELS)) return;
      anchor.current = { element, id: element.id, label: element.getAttribute('aria-label'), name: element.getAttribute('name'), classes: element.className };
    };
    document.addEventListener('focusin', remember); remember();
    return () => { epoch.current++; document.removeEventListener('focusin', remember); };
  }, []);
  useEffect(() => {
    const wasOpen = previous.current; previous.current = active;
    const request = ++epoch.current;
    if (active || !wasOpen) return;
    const focused = document.activeElement;
    // Explicit prompt editing or another text target takes precedence over dismissal restoration.
    if (focused instanceof HTMLElement && !focused.closest(PANELS) && focused.matches('textarea,input,[contenteditable="true"]')) {
      void shell.restorePanelFocus?.(false).catch(() => {}); return;
    }
    void shell.restorePanelFocus?.().then(native => {
      if (native || current.current || epoch.current !== request || !document.hasFocus() || document.activeElement !== focused) return;
      resolveAnchor(anchor.current)?.focus({ preventScroll: true });
    }).catch(() => {});
  }, [active]);
}
