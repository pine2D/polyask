import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { LibrarySessionStore } from './library-session';

interface Position {
  readonly identity: string | null;
  readonly focus: string | null;
  readonly details: readonly { key: string; open: boolean }[];
  readonly scrolls: readonly ({ top: number; left: number } | null)[];
}

// 只在取消当前新卡时消费，DOM 位置仅用于同一来源重挂，不写入持久化或同步。
export function useDecisionReturn(root: RefObject<HTMLElement | null>, creating: boolean, identity: string | null, session: LibrarySessionStore) {
  const saved = useRef<Position | null>(null), returning = useRef(false);
  useLayoutEffect(() => {
    if (creating || !returning.current) return;
    returning.current = false;
    const position = saved.current, detail = root.current?.querySelector<HTMLElement>('.folder-detail');
    saved.current = null;
    if (!position || !detail || position.identity !== identity) return;
    detail.querySelectorAll<HTMLDetailsElement>('details[data-library-return]').forEach(node => {
      const value = position.details.find(value => value.key === node.dataset.libraryReturn);
      if (value) node.open = value.open;
    });
    detail.querySelectorAll<HTMLElement>('.archive-detail-pane, .archive-compare-column, .manual-comparison').forEach((node, index) => {
      const value = position.scrolls[index];
      if (!value) return;
      node.scrollTop = value.top; node.scrollLeft = value.left;
    });
    const origin = [...detail.querySelectorAll<HTMLElement>('[data-decision-origin]')].find(node => node.dataset.decisionOrigin === position.focus);
    const target = origin ?? detail.querySelector<HTMLElement>('[data-decision-origin="record"]');
    target?.focus({ preventScroll: true });
  });
  return {
    capture: (origin = 'record') => {
      const detail = root.current?.querySelector<HTMLElement>('.folder-detail');
      if (!detail) return;
      saved.current = { identity, focus: origin,
        details: [...detail.querySelectorAll<HTMLDetailsElement>('details[data-library-return]')].map(node => ({ key: node.dataset.libraryReturn!, open: node.open })),
        scrolls: [...detail.querySelectorAll<HTMLElement>('.archive-detail-pane, .archive-compare-column, .manual-comparison')]
          .map(node => node.closest('[hidden]') ? null : { top: node.scrollTop, left: node.scrollLeft }) };
      // scroll 事件可能尚未派发；重挂布局的读取必须与实际离开位置一致。
      const reader = session.read().reader, positions = saved.current.scrolls;
      if (reader && identity === `archive:${reader.archiveId}` && positions[0]) {
        const outer = reader.view === 'read' ? 'readScroll' : reader.view === 'compare' ? 'comparisonScroll' : 'synthesisScroll';
        session.update({ reader: { ...reader, [outer]: positions[0].top,
          ...(reader.view === 'compare' ? { leftScroll: positions[1]?.top ?? reader.leftScroll, rightScroll: positions[2]?.top ?? reader.rightScroll } : {}) } });
      }
    },
    restore: () => { returning.current = true; }
  };
}
