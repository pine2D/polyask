import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';

/** 阅读正文内的动作自带外观，不依赖历史或结果库的父级按钮规则。 */
export function ReadingAction({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return <button {...props} type={type} className={`reading-action ${className}`} />;
}

export function ReadingNavigation({ children, className = '', activeSource, navigationRef }: {
  children: ReactNode; className?: string; activeSource: string | number;
  navigationRef?: RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const ownRef = useRef<HTMLDivElement>(null), root = navigationRef ?? ownRef;
  useLayoutEffect(() => {
    const node = root.current, pane = node?.closest<HTMLElement>('.archive-detail-pane, .question-reader');
    if (!node || !pane) return;
    const property = '--reading-navigation-height', previous = pane.style.getPropertyValue(property);
    // 原生锚点、Tab 和程序滚动都避让导航的实际高度，覆盖换行和缩放。
    const update = () => pane.style.setProperty(property, `${Math.ceil(node.getBoundingClientRect().height)}px`);
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      if (previous) pane.style.setProperty(property, previous);
      else pane.style.removeProperty(property);
    };
  }, []);
  useLayoutEffect(() => {
    const list = root.current?.querySelector<HTMLElement>('.reading-source-list');
    const current = list?.querySelector<HTMLElement>('[aria-current="location"], [aria-pressed="true"]');
    if (!list || !current) return;
    // 只调整来源条自身的横向位置，不移动正文、焦点或页面滚动。
    const reveal = () => {
      const viewport = list.getBoundingClientRect(), item = current.getBoundingClientRect();
      if (item.left < viewport.left) list.scrollLeft += item.left - viewport.left;
      else if (item.right > viewport.right) list.scrollLeft += item.right - viewport.right;
    };
    reveal();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reveal) : null;
    observer?.observe(list);
    return () => observer?.disconnect();
  }, [activeSource]);
  return <div ref={root} className={`reading-navigation ${className}`}>{children}</div>;
}
