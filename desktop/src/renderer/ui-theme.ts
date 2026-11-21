import { uiThemeDataset, UI_THEME_PALETTE_CSS } from '../shared/ui-theme';
import { shell } from './shell-api';

export function applyUiTheme(document: Document, value: unknown): void {
  if (!document.getElementById('ui-theme-palette')) {
    const palette = document.createElement('style');
    palette.id = 'ui-theme-palette';
    palette.textContent = UI_THEME_PALETTE_CSS;
    document.head.append(palette);
  }
  Object.assign(document.documentElement.dataset, uiThemeDataset(value));
}

/** SQLite is authoritative even after a restore or reset. Paint the first surface in its accepted skin. */
export async function startThemedShell(render: () => void): Promise<void> {
  let initialTheme: string | undefined;
  try { initialTheme = (await shell.getPreferences?.())?.values.uiTheme; } catch { /* Bootstrap owns recovery. */ }
  applyUiTheme(document, initialTheme);
  render();
}
