import { webContents, type BrowserWindow } from 'electron';
import type { DesktopSurface } from '../shared/protocol';
import type { ViewManager } from './view-manager';
import { NativePanelFocus } from './native-panel-focus';

interface PanelIpc {
  on(channel: string, listener: (event: any, value: unknown) => void): unknown;
  handle(channel: string, listener: (event: any, value?: unknown) => unknown): void;
  removeAllListeners(channel: string): unknown;
  removeHandler(channel: string): void;
}

/** Accepted surface changes acquire native focus before the renderer's DOM focus can receive keys. */
export function registerShellPanelIpc(ipc: PanelIpc, window: BrowserWindow, manager: ViewManager,
  trusted: (event: any) => boolean): () => void {
  const focus = new NativePanelFocus({
    capture: () => {
      const contents = webContents.getFocusedWebContents();
      return contents && manager.owns(contents) ? contents.id : null;
    },
    activate: () => { if (!window.isDestroyed()) window.webContents.focus(); },
    restore: id => {
      if (window.isDestroyed() || !window.isFocused() || !window.webContents.isFocused()) return false;
      const contents = webContents.fromId(id), site = contents && !contents.isDestroyed() ? manager.owns(contents) : null;
      if (!contents || !site || !manager.getLayout().placements.some(placement => placement.key === site)) return false;
      contents.focus(); return true;
    }
  });
  ipc.on('polyask:set-surface', (event, value) => {
    if (!trusted(event) || typeof value !== 'string' || !['sites', 'archive', 'settings', 'commands', 'confirmation', 'question-history'].includes(value)) return;
    focus.change('surface', value === 'sites' ? false : value, () => manager.setSurface(value as DesktopSurface));
  });
  ipc.on('polyask:set-drawer-open', (event, value) => {
    if (trusted(event) && typeof value === 'boolean') focus.change('drawer', value, () => manager.setDrawerOpen(value));
  });
  ipc.handle('polyask:question-panel', (event, value) => {
    if (!trusted(event)) throw Error('untrusted_sender');
    if (typeof value !== 'boolean') throw Error('invalid_question');
    focus.change('history', value, () => manager.historyAccess.setPanelOpen(value));
  });
  ipc.handle('polyask:restore-panel-focus', (event, restore) => {
    if (!trusted(event)) throw Error('untrusted_sender');
    if (restore !== undefined && typeof restore !== 'boolean') throw Error('invalid_request');
    if (restore === false) { focus.cancel(); return false; }
    return focus.restore();
  });
  // A fresh user action while an exit animation is finishing supersedes the pending return.
  const input = (_event: unknown, value: { type: string }) => {
    if (value.type === 'keyDown' || value.type === 'mouseDown' || value.type === 'touchStart') focus.cancelPending();
  };
  const reset = () => focus.reset();
  // Retain the emitter: accessing window.webContents throws after the window's closed event.
  const shellContents = window.webContents;
  shellContents.on('input-event', input);
  shellContents.on('did-navigate', reset);
  return () => {
    focus.reset();
    shellContents.removeListener('input-event', input);
    shellContents.removeListener('did-navigate', reset);
    for (const name of ['set-surface', 'set-drawer-open']) ipc.removeAllListeners(`polyask:${name}`);
    for (const name of ['question-panel', 'restore-panel-focus']) ipc.removeHandler(`polyask:${name}`);
  };
}
