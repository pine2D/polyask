import { registerMarkdownExportIpc } from './markdown-export-ipc';
import { ipcMain, type WebContents, type WebFrameMain } from 'electron';
import type { ShellIpcOptions } from './shell-ipc';
import type { OperationGate } from '../shared/operation-gate';
import { registerDataAdminIpc } from './data-admin-ipc';
import { registerNotificationIpc } from './notification-ipc';
import { registerCommandPaletteShortcutIpc } from './command-palette-shortcut-ipc';
import { registerGlobalPromptShortcutIpc } from './global-prompt-shortcut-ipc';
import { registerReportExportIpc } from './report-export-ipc';

/** Window-owned IPC handlers; the shortcut registration itself belongs to the app. */
export function registerDesktopToolsIpc(options: ShellIpcOptions, bindings: {
  readonly trusted: (event: { readonly sender: WebContents; readonly senderFrame: WebFrameMain | null }) => boolean;
  readonly gate: OperationGate;
  readonly publishWorkspace: () => unknown;
  readonly publishPromptLibrary: () => unknown;
  readonly publishDrafts: () => void;
}): () => void {
  const { trusted, gate, publishWorkspace, publishPromptLibrary, publishDrafts } = bindings;
  const cleanup = [registerDataAdminIpc({ admin: options.dataAdmin, trusted,
    afterHistoryChange: () => { options.questions.publishRunProgress(); publishPromptLibrary(); },
    afterDraftsChange: () => { options.preferences?.drafts.invalidate(); publishDrafts(); },
    afterReset: () => {
      options.globalPromptShortcut?.refreshAfterReset();
      options.commandPaletteShortcut?.refreshAfterReset();
      options.completionNotifications?.reset();
      options.questions.publishRunProgress(); options.preferences?.reset(); options.manager.siteZoom.clear();
      publishWorkspace(); publishPromptLibrary(); publishDrafts();
    }
  }), registerReportExportIpc({ window: options.window, archives: options.archives, decisions: options.decisions, trusted,
    epoch: () => options.questions.repository.lifecycle,
    isCurrent: () => !options.dataAdmin.isResetting && !options.window.isDestroyed()
  }), registerMarkdownExportIpc({ window: options.window, archives: options.archives, decisions: options.decisions,
    questions: options.questions.repository, trusted, epoch: () => options.questions.repository.lifecycle,
    isCurrent: () => !options.dataAdmin.isResetting && !options.window.isDestroyed()
  })];
  if (options.completionNotifications) cleanup.push(registerNotificationIpc({ notifications: options.completionNotifications, trusted }));
  if (options.globalPromptShortcut) cleanup.push(registerGlobalPromptShortcutIpc({ ipcMain, trustedShell: trusted,
    runtime: options.globalPromptShortcut, gate, isResetting: () => options.dataAdmin.isResetting }));
  if (options.commandPaletteShortcut) cleanup.push(registerCommandPaletteShortcutIpc({ ipcMain, trustedShell: trusted,
    runtime: options.commandPaletteShortcut, gate, isResetting: () => options.dataAdmin.isResetting }));
  return () => { for (const dispose of cleanup.reverse()) dispose(); };
}
