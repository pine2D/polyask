import type { SiteKey } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { DesktopSurface, SiteResult } from '../shared/protocol';
import { confirmNewSession, type PendingSessionConfirmation } from './session-confirmation';

export async function confirmAndStartNewSession(options: {
  sites: readonly SiteKey[]; copy: DesktopCopy;
  show: (pending: PendingSessionConfirmation | null) => void;
  changeSurface: (surface: DesktopSurface) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  invalidate: () => void; recover: () => void; announce: (message: string) => void;
  send: (sites: readonly SiteKey[]) => Promise<readonly SiteResult[]>;
}): Promise<void> {
  if (!options.sites.length || !await confirmNewSession(options.sites.length, options.show, options.changeSurface)) return;
  await options.run(async () => {
    options.invalidate();
    try {
      const results = await options.send(options.sites), failed = results.filter(result => !result.ok).length;
      options.announce(failed
        ? formatCopy(options.copy.newSessionPartial, { ok: results.length - failed, failed })
        : formatCopy(options.copy.newSessionDone, { count: results.length }));
    } catch { options.recover(); }
  });
}
