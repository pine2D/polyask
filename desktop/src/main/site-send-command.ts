import type { WebContentsView } from 'electron';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import type { SiteResult, SubmitSiteCommand } from '../shared/protocol';
import type { SiteCommandChannel } from './site-command-channel';
import { navigationDisposition } from './navigation';
import { SITES } from './sites';

export function sendSiteCommand(site: SiteKey, view: WebContentsView | undefined, pageFailure: string | null,
  reloading: boolean, commands: SiteCommandChannel, command: SubmitSiteCommand, signal: AbortSignal,
  replace: (definition: SiteDefinition, view: WebContentsView, url: string) => void): Promise<SiteResult> {
  if (!view || view.webContents.isDestroyed()) {
    return Promise.resolve({ ok: false, code: "no_view" });
  }
  // A crashed or failed page has no preload left to answer, so the request
  // would burn the whole budget and land on submit_unconfirmed — "maybe sent".
  // It was never dispatched, so report the certain failure instead. Never
  // reload and resend here: automatic resends are forbidden.
  if (pageFailure) return Promise.resolve({ ok: false, code: pageFailure });
  const definition = SITES.find((candidate) => candidate.key === site);
  if (!definition || reloading || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
    return Promise.resolve({ ok: false, code: "not_ready" });
  }
  return commands.send(view.webContents, command, {
    signal,
    timeoutResult: { ok: false, code: "submit_unconfirmed" },
    onAbort: () => {
      if (view.webContents.isDestroyed()) return;
      replace(definition, view, view.webContents.getURL() || definition.url);
    }
  }).then((result) => "ok" in result ? result : { ok: false, code: "invalid_response" });
}
