import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Portaled overlays stay above scrolling panes; Escape only dismisses this layer. */
export function useLibraryPopover() {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 });
  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const upwards = below < 220 && above > below;
      const maxHeight = Math.max(80, Math.min(360, upwards ? above : below));
      const height = Math.min(panel.current?.scrollHeight ?? maxHeight, maxHeight);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: upwards ? Math.max(12, rect.top - height - 6) : rect.bottom + 6, width, maxHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    };
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close]);
  return { trigger, panel, open, setOpen, close, position };
}
