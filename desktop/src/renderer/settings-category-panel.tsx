import { createContext, useContext, type ReactNode } from 'react';
import type { SettingsCategory } from './settings-categories';

const SettingsCategoryActive = createContext(true);
// Portalled content needs the same visibility as its owning settings category.
export const useSettingsCategoryActive = () => useContext(SettingsCategoryActive);
export function SettingsCategoryPanel({ category, active, title, children }: {
  category: SettingsCategory; active: boolean; title: string; children: ReactNode;
}): React.JSX.Element {
  return <SettingsCategoryActive value={active}>
    <section className="settings-category" data-settings-category={category} hidden={!active} inert={!active}
      aria-labelledby={`settings-category-${category}`}>
      <h1 id={`settings-category-${category}`} tabIndex={-1}>{title}</h1>
      <div className="settings-group">{children}</div>
    </section>
  </SettingsCategoryActive>;
}
