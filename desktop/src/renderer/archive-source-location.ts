import { useLayoutEffect, useState, type RefObject } from 'react';

export function useArchiveSourceLocation(article: RefObject<HTMLElement | null>,
  navigation: RefObject<HTMLElement | null>, archiveId: string, active: boolean): number | null {
  const [location, setLocation] = useState<{ archiveId: string; index: number } | null>(null);
  useLayoutEffect(() => {
    const node = article.current, nav = navigation.current;
    const pane = node?.closest<HTMLElement>('.archive-detail-pane'), view = node?.ownerDocument.defaultView;
    if (!active || !node || !nav || !pane || !view) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      if (pane.clientHeight <= 0) return;
      const sections = [...node.querySelectorAll<HTMLElement>('.archive-answer')];
      let index = 0;
      const boundary = nav.getBoundingClientRect().bottom + 1;
      sections.forEach((section, current) => { if (section.getBoundingClientRect().top <= boundary) index = current; });
      setLocation(previous => sections.length
        ? previous?.archiveId === archiveId && previous.index === index ? previous : { archiveId, index }
        : previous === null ? previous : null);
    };
    const schedule = () => {
      if (frame !== null) return;
      if (view.requestAnimationFrame) frame = view.requestAnimationFrame(measure); else measure();
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    [pane, node, nav].forEach(target => observer?.observe(target));
    pane.addEventListener('scroll', schedule, { passive: true });
    measure();
    // 父级layout effect随后恢复阅读位置；下一帧按恢复后的实际滚动位置再定位。
    schedule();
    return () => {
      pane.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame !== null) view.cancelAnimationFrame?.(frame);
    };
  }, [article, navigation, archiveId, active]);
  return active && location?.archiveId === archiveId ? location.index : null;
}
