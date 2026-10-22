import { useLayoutEffect, useRef, useState } from 'react';

function revealSection(body: HTMLElement | null, section: string): void {
  const scroller = body?.querySelector<HTMLElement>('.settings-section-scroller');
  const button = [...scroller?.querySelectorAll<HTMLElement>('[data-settings-section]') ?? []].find(item => item.dataset.settingsSection === section);
  if (!scroller || !button) return;
  const bounds = scroller.getBoundingClientRect(), item = button.getBoundingClientRect();
  if (item.left < bounds.left) scroller.scrollLeft -= bounds.left - item.left;
  else if (item.right > bounds.right) scroller.scrollLeft += item.right - bounds.right;
}

/** 分区位置只反映当前可见内容，不移动焦点或触发设置写入。 */
export function useSettingsSectionNavigation() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [currentSection, setCurrentSection] = useState('display');
  const anchor = useRef<{ key: string; top: number } | null>(null);
  const markSection = (section: string) => {
    const key = section === 'preferences' || section === 'backup' ? 'overview'
      : section === 'updates' ? 'proxy' : section === 'notifications' || section === 'confirmations' ? 'display' : section;
    anchor.current = { key, top: bodyRef.current?.scrollTop ?? 0 };
    setCurrentSection(key);
  };
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const view = body.ownerDocument.defaultView!;
    const update = () => {
      if (!body.clientHeight) return;
      const sections = [...body.querySelectorAll<HTMLButtonElement>('[data-settings-section]')].flatMap(button => {
        const target = body.ownerDocument.getElementById(button.getAttribute('aria-controls') ?? '');
        const group = target?.closest('.settings-group');
        return target?.getClientRects().length && group ? [{ key: button.dataset.settingsSection!, bottom: group.getBoundingClientRect().bottom }] : [];
      });
      if (!sections.length) return;
      const nav = body.querySelector('.settings-section-navigation');
      const edge = Math.max(nav?.getBoundingClientRect().bottom ?? 0,
        body.getBoundingClientRect().top + (parseFloat(view.getComputedStyle(body).scrollPaddingTop) || 0)) + 1;
      // 跳转可被底部夹住：同一滚动位置仍代表用户明确选择的分区。
      const requested = anchor.current;
      const pinned = requested?.top === body.scrollTop ? sections.find(item => item.key === requested.key) : null;
      if (!pinned) anchor.current = null;
      // 分组间隙也归入下一段可见内容，避免已藏到吸顶导航后的分组仍高亮。
      const section = pinned ?? sections.find(item => item.bottom > edge) ?? sections.at(-1)!;
      setCurrentSection(section.key);
      revealSection(body, section.key);
    };
    body.addEventListener('scroll', update, { passive: true });
    view.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(body);
    body.querySelectorAll('.settings-group').forEach(group => observer?.observe(group));
    update();
    return () => { body.removeEventListener('scroll', update); view.removeEventListener('resize', update); observer?.disconnect(); };
  }, []);
  useLayoutEffect(() => {
    revealSection(bodyRef.current, currentSection);
  }, [currentSection]);
  return { bodyRef, currentSection, markSection };
}
