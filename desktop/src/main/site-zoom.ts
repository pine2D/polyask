import type { WebContents } from "electron";
import type { SiteKey } from "../shared/contracts";
import { parseSiteZoom, siteZoomAction, stepSiteZoom, type SiteZoomAction, type SiteZoomPreferences } from "../shared/site-zoom";

export class SiteZoomController {
  private preferences: SiteZoomPreferences = {};
  private readonly contents = new Map<SiteKey, WebContents>();
  private readonly defaults = new Map<SiteKey, number>();

  constructor(private readonly changed: () => void) {}

  restore(value: unknown): void { this.preferences = parseSiteZoom(value); }
  snapshot(): SiteZoomPreferences { return { ...this.preferences }; }

  bind(site: SiteKey, contents: WebContents): void {
    this.contents.set(site, contents);
    contents.on("zoom-changed", (_event, direction) => this.change(site, contents, direction));
    contents.on("before-input-event", (event, input) => {
      const action = siteZoomAction(input, process.platform);
      if (!action) return;
      // Prevent the menu accelerator from zooming the shell as well.
      event.preventDefault();
      this.change(site, contents, action);
    });
    contents.on("did-finish-load", () => this.apply(site, contents, this.defaults.get(site) ?? 1));
    contents.once("destroyed", () => {
      if (this.contents.get(site) === contents) this.contents.delete(site);
    });
  }

  apply(site: SiteKey, contents: WebContents, fallback: number): void {
    this.defaults.set(site, fallback);
    if (contents.isDestroyed()) return;
    const zoom = this.preferences[site] ?? fallback;
    if (Math.abs(contents.getZoomFactor() - zoom) > 0.001) contents.setZoomFactor(zoom);
  }

  clear(): void {
    this.preferences = {};
    for (const [site, contents] of this.contents) this.apply(site, contents, this.defaults.get(site) ?? 1);
    this.changed();
  }

  private change(site: SiteKey, contents: WebContents, action: SiteZoomAction): void {
    if (contents.isDestroyed()) return;
    const zoom = stepSiteZoom(contents.getZoomFactor(), action);
    contents.setZoomFactor(zoom);
    this.preferences = { ...this.preferences, [site]: zoom };
    this.changed();
  }
}
