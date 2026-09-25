import { Menu, nativeTheme, type BrowserWindow } from 'electron';
import { bindShellTheme, shellBackground, shellContextMenu } from './native-shell-policy';

export const initialShellBackground = (): string => shellBackground(nativeTheme);

export function installNativeShell(window: BrowserWindow): void {
  bindShellTheme(window, nativeTheme);
  // 只接管本地外壳，远程 AI 站点的右键行为仍归站点所有。
  window.webContents.on('context-menu', (_event, params) => {
    const items = shellContextMenu(params);
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  });
}
