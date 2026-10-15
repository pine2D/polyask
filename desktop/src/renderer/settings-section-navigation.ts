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
  const [currentSection, markSection] = useState('overview');
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const view = body.ownerDocument.defaultView!;
    const update = () => {
      if (!body.clientHeight) return;
      const sections = [...body.querySelectorAll<HTMLButtonElement>('[data-settings-section]')].flatMap(button => {
        const target = body.ownerDocument.getElementById(button.getAttribute('aria-controls') ?? '');
        return target?.getClientRects().length ? [{ key: button.dataset.settingsSection!, top: target.getBoundingClientRect().top }] : [];
      });
      if (!sections.length) return;
      const nav = body.querySelector('.settings-section-navigation');
      const edge = Math.max(nav?.getBoundingClientRect().bottom ?? 0,
        body.getBoundingClientRect().top + (parseFloat(view.getComputedStyle(body).scrollPaddingTop) || 0)) + 1;
      const atBottom = body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
      const section = atBottom ? sections.at(-1)! : sections.filter(item => item.top <= edge).at(-1) ?? sections[0];
      markSection(section.key);
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
