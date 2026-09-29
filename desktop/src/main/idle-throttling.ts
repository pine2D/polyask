import type { EventEmitter } from 'node:events';
import { ipcMain, webContents, type BrowserWindow, type IpcMainEvent, type WebContents } from 'electron';
import type { SiteResponseEnvelope, SiteStatus } from '../shared/protocol';
import type { DiagnosticSource } from './runtime-gates';
import { createIdleThrottlingExperiment } from './idle-throttling-policy';
import { observeSiteCommands } from './site-command-activity';
import { SiteCommandChannel } from './site-command-channel';

export function startIdleThrottlingExperiment(window: BrowserWindow, source: DiagnosticSource): () => void {
  if (process.env.POLYASK_IDLE_THROTTLING_EXPERIMENT !== '1') return () => {};
  const statusSource = source as DiagnosticSource & { getStatuses?: () => SiteStatus[] };
  const channel = new SiteCommandChannel();
  const tracked = new Map<number, { contents: WebContents; stop: () => void }>();
  const receive = (event: IpcMainEvent, envelope: SiteResponseEnvelope) => channel.receive(event.sender, envelope);
  ipcMain.on('polyask:site-response', receive);
  const policy = createIdleThrottlingExperiment({ enabled: true,
    minimized: () => !window.isDestroyed() && window.isMinimized(),
    sites: () => {
      track();
      const statuses = statusSource.getStatuses?.() ?? [];
      return source.getDiagnosticSites().map(site => {
        const contents = webContents.fromId(site.webContentsId);
        const alive = contents && !contents.isDestroyed();
        const status = statuses.find(status => status.site === site.site);
        return { id: site.webContentsId, phase: status?.submission?.state === 'unconfirmed' ? 'unknown' : status?.phase ?? 'unknown',
          attached: site.attached && site.bounds.width > 0 && site.bounds.height > 0,
          loading: !alive || contents.isLoading(),
          set: (allowed: boolean) => { if (contents && !contents.isDestroyed()) contents.setBackgroundThrottling(allowed); } };
      });
    },
    probe: async id => {
      const contents = webContents.fromId(id);
      if (!contents || contents.isDestroyed()) return null;
      const result = await channel.send(contents, { source: 'AMS', cmd: 'generation', runId: 'idle-throttling-experiment', deadline: Date.now() + 2500 },
        { timeoutResult: { state: null } });
      return 'state' in result ? result.state : null;
    },
    listen: (event, callback) => { (window as EventEmitter).on(event, callback); return () => { (window as EventEmitter).removeListener(event, callback); }; },
    interval: callback => { const timer = setInterval(() => { track(); callback(); }, 5000); return () => clearInterval(timer); }
  });
  // Navigation or a new send disables throttling for this minimized period;
  // unknown/cancelled submissions must not be mistaken for completed activity.
  function track() {
    const live = new Set<number>();
    for (const site of source.getDiagnosticSites()) {
      const contents = webContents.fromId(site.webContentsId);
      if (!contents || contents.isDestroyed()) continue;
      live.add(contents.id);
      if (tracked.has(contents.id)) continue;
      policy.wake();
      const navigation = (details: { isMainFrame?: boolean }) => { if (details.isMainFrame !== false) policy.wake(); };
      contents.on('did-start-navigation', navigation);
      contents.on('did-navigate-in-page', policy.wake);
      contents.on('did-start-loading', policy.wake);
      tracked.set(contents.id, { contents, stop: () => {
        contents.removeListener('did-start-navigation', navigation);
        contents.removeListener('did-navigate-in-page', policy.wake);
        contents.removeListener('did-start-loading', policy.wake);
      } });
    }
    for (const [id, entry] of tracked) if (!live.has(id)) { policy.wake(); entry.stop(); tracked.delete(id); }
  }
  const stopCommands = observeSiteCommands(id => {
    try { if (source.getDiagnosticSites().some(site => site.webContentsId === id)) policy.wake(); }
    catch { policy.wake(); }
  });
  // Initial sites are known before the first minimize event; don't latch startup.
  track();
  const dispose = () => {
    stopCommands(); policy.dispose(); channel.dispose(); ipcMain.removeListener('polyask:site-response', receive);
    for (const entry of tracked.values()) entry.stop();
    tracked.clear(); window.removeListener('closed', dispose);
  };
  window.on('closed', dispose);
  return dispose;
}
