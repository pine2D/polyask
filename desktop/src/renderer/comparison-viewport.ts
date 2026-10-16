import { useLayoutEffect, type RefObject } from 'react';

export function useComparisonViewport(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = root.current, pane = node?.closest<HTMLElement>('.archive-detail-pane');
    const column = node?.querySelector<HTMLElement>('.archive-compare-column');
    const view = node?.ownerDocument.defaultView;
    if (!node || !pane || !column || !view) return;
    const property = '--comparison-reading-height', previous = node.style.getPropertyValue(property);
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      if (pane.clientHeight <= 0) return;
      // 选择器也在grid内：从正文栏起点算，避免把选择器高度重复占用。
      const offset = column.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
      const value = Math.max(160, Math.floor(pane.clientHeight - offset - 16)) + 'px';
      if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
    };
    const schedule = () => {
      if (frame !== null) return;
      if (view.requestAnimationFrame) frame = view.requestAnimationFrame(measure);
      else measure();
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    [pane, node.closest('.archive-detail'), node.querySelector('.archive-compare-grid')].forEach(target => {
      if (target) observer?.observe(target);
    });
    measure();
    return () => {
      observer?.disconnect();
      if (frame !== null) view.cancelAnimationFrame?.(frame);
      if (previous) node.style.setProperty(property, previous); else node.style.removeProperty(property);
    };
  }, [root]);
}
