import { useLayoutEffect, useRef } from 'react';

export interface LibraryReadingFocus {
  readonly focused: boolean;
  readonly onFocus: (value: boolean) => void;
}

// 布局展开仍使用原来的节点；浏览位置与当前阅读位置分别保存。
export function useLibraryReadingFocus(focused: boolean, identity: string | null) {
  const root = useRef<HTMLElement>(null);
  const browsing = useRef<{ identity: string | null; list: number; detail: number } | null>(null);
  const columns = useRef<readonly number[]>([]);
  const capture = (next: boolean) => {
    const node = root.current;
    if (!node) return;
    if (next && !focused) browsing.current = { identity,
      list: node.querySelector<HTMLElement>('.folder-content-list .archive-list')?.scrollTop ?? 0,
      detail: node.querySelector<HTMLElement>('.archive-detail-pane')?.scrollTop ?? 0 };
    columns.current = [...node.querySelectorAll<HTMLElement>('.archive-compare-column')].map(column => column.scrollTop);
  };
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    node.querySelectorAll<HTMLElement>('.archive-compare-column').forEach((column, index) => {
      if (columns.current[index] !== undefined) column.scrollTop = columns.current[index];
    });
    const saved = browsing.current;
    if (!focused && saved?.identity === identity) {
      const list = node.querySelector<HTMLElement>('.folder-content-list .archive-list');
      const detail = node.querySelector<HTMLElement>('.archive-detail-pane');
      if (list) list.scrollTop = saved.list;
      if (detail) detail.scrollTop = saved.detail;
      browsing.current = null;
    }
  }, [focused]);
  return { root, capture };
}
