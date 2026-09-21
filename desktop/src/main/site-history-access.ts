import type { WebContentsView } from "electron";
import type { SiteKey } from "../shared/contracts";
import { normalizeHistorySnapshot } from "../shared/question-capture";
import { safeQuestionUrl } from "./question-navigation";
import type { SiteCommandChannel } from "./site-command-channel";
import { SITES } from "./sites";

export class SiteHistoryAccess {
  constructor(private readonly view: (site: SiteKey) => WebContentsView | undefined,
    private readonly commands: SiteCommandChannel,
    private readonly beforeNavigate: (site: SiteKey) => void) {}
  context(site: SiteKey): { id: number; url: string } | null {
    const contents = this.view(site)?.webContents;
    return contents && !contents.isDestroyed() ? { id: contents.id, url: contents.getURL() } : null;
  }
  stop(site: SiteKey): void {
    const contents = this.view(site)?.webContents;
    if (contents && !contents.isDestroyed()) contents.stop();
  }
  async snapshot(site: SiteKey, token: string, deadline: number) {
    const contents = this.view(site)?.webContents;
    if (!contents || contents.isDestroyed()) return { token, owned: false, ended: true };
    const response = await this.commands.send(contents, { source: "AMS", cmd: "historySnapshot", token, deadline },
      { timeoutResult: { token, owned: false } });
    if (this.view(site)?.webContents !== contents || contents.isDestroyed()) return { token, owned: false, ended: true };
    const result = normalizeHistorySnapshot(response, token);
    // The untrusted page cannot supply a different navigation target.
    return { ...result, url: result.owned ? safeQuestionUrl(site, contents.getURL()) : null };
  }
  async navigate(site: SiteKey, url: string, homepage = false): Promise<void> {
    const definition = SITES.find(item => item.key === site);
    const contents = this.view(site)?.webContents;
    if (!contents || contents.isDestroyed() || (homepage ? definition?.url !== url : safeQuestionUrl(site, url) !== url)) throw new Error("invalid_navigation");
    if (!homepage && contents.getURL() === url) return;
    this.beforeNavigate(site);
    await contents.loadURL(url);
  }
}
