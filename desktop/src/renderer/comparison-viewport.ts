import { useLayoutEffect, type RefObject } from 'react';

export function useComparisonViewport(root: RefObject<HTMLElement | null>, manualOpen = false): void {
  useLayoutEffect(() => {
    const node = root.current, pane = node?.closest<HTMLElement>('.archive-detail-pane');
    const column = node?.querySelector<HTMLElement>(manualOpen ? '.manual-comparison' : '.archive-compare-column');
    const view = node?.ownerDocument.defaultView;
    if (!node || !pane || !column || !view) return;
    const property = '--comparison-reading-height';
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
      // 保留本节点的测量值；重挂期间退回 vh 高度会夹取已恢复的滚动位置。
    };
  }, [root, manualOpen]);
}
