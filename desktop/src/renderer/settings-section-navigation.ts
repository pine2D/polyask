import { useLayoutEffect, useRef, useState } from 'react';
import { resolveSettingsTarget, type SettingsCategory, type SettingsNavigationTarget, type SettingsTarget } from './settings-categories';

/** Category and scroll positions live only for this settings session. */
export function useSettingsSectionNavigation(initialSection: SettingsTarget | undefined, sectionRequest: number | undefined, closeLocked: boolean) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [currentSection, setCurrentSection] = useState<SettingsCategory>(() => resolveSettingsTarget(initialSection).category);
  const [revision, setRevision] = useState(0);
  const positions = useRef<Partial<Record<SettingsCategory, number>>>({});
  const current = useRef(currentSection), locked = useRef(closeLocked);
  locked.current = closeLocked;
  const pending = useRef<{ category: SettingsCategory; id: string; restore: boolean; focus: 'content' | 'navigation' } | null>(null);
  const navigate = (target: SettingsNavigationTarget, focus: 'content' | 'navigation' = 'content') => {
    if (locked.current) return;
    const next = resolveSettingsTarget(target);
    if (bodyRef.current) positions.current[current.current] = bodyRef.current.scrollTop;
    current.current = next.category;
    pending.current = { ...next, restore: next.id === `settings-category-${next.category}`, focus };
    setCurrentSection(next.category); setRevision(value => value + 1);
  };
  useLayoutEffect(() => {
    if (initialSection !== undefined) navigate(initialSection);
    // A request received during a destructive write is ignored, never replayed on unlock.
  }, [initialSection, sectionRequest]);
  useLayoutEffect(() => {
    const request = pending.current, body = bodyRef.current;
    if (!request || !body || request.category !== currentSection) return;
    pending.current = null;
    body.scrollTop = positions.current[currentSection] ?? 0;
    let target = body.ownerDocument.getElementById(request.id);
    if (request.id === 'backup-card-title') target = target?.closest('section')?.querySelector('button') ?? target;
    if (!target || target.closest('[hidden],[inert]')) return;
    if (!target.matches('summary,button,a[href],input,select,textarea,[tabindex]')) target.tabIndex = -1;
    if (!request.restore) target.scrollIntoView({ block: 'start' });
    if (request.focus === 'content') target.focus({ preventScroll: true });
  }, [currentSection, revision]);
  return { bodyRef, currentSection, navigate };
}
