import { useLayoutEffect, type RefObject } from 'react';

interface SurfaceLayout {
  width: number;
  font: string;
  count: number;
  heights: number[];
}
/** 只随当前阅读会话保留布局数值，不保存正文、DOM 或跨记录的全局缓存。 */
export interface ReadingLayoutMemory {
  revision?: number;
  surfaces: Record<string, SurfaceLayout>;
}

export function useReadingLayout(root: RefObject<HTMLElement | null>, selector: string, key: string,
  revision: number, memory: ReadingLayoutMemory | undefined, active = true): void {
  useLayoutEffect(() => {
    const node = root.current;
    if (!active || !node || !memory || typeof ResizeObserver === 'undefined') return;
    if (memory.revision !== revision) { memory.revision = revision; memory.surfaces = {}; }
    const blocks = [...node.querySelectorAll<HTMLElement>(selector)];
    if (!blocks.length) return;
    const style = getComputedStyle(node), width = node.clientWidth;
    const font = `${style.font};${style.getPropertyValue('--font-reading')};${node.ownerDocument.documentElement.lang}`;
    const previous = memory.surfaces[key];
    const saved = previous?.width === width && previous.font === font && previous.count === blocks.length
      ? previous : { width, font, count: blocks.length, heights: [] };
    memory.surfaces[key] = saved;
    // 子组件的layout effect先于外层滚动恢复；补回已知占位尺寸，避免被短占位夹取scrollTop。
    blocks.forEach((block, index) => {
      const height = saved.heights[index];
      if (Number.isFinite(height) && height >= 0) block.style.containIntrinsicBlockSize = `auto ${height}px`;
      else block.style.removeProperty('contain-intrinsic-block-size');
    });
    const indices = new Map(blocks.map((block, index) => [block, index]));
    const observer = new ResizeObserver(entries => {
      const currentWidth = node.clientWidth;
      if (currentWidth <= 0) return; // hidden/inert阶段不覆盖已知尺寸。
      if (saved.width !== currentWidth) {
        saved.width = currentWidth; saved.heights = [];
        blocks.forEach(block => block.style.removeProperty('contain-intrinsic-block-size'));
      }
      for (const entry of entries) {
        const index = indices.get(entry.target as HTMLElement);
        if (index !== undefined && entry.contentRect.width > 0) saved.heights[index] = entry.contentRect.height;
      }
    });
    blocks.forEach(block => observer.observe(block));
    return () => observer.disconnect();
  }, [root, selector, key, revision, memory, active]);
}
