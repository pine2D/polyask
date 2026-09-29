import { SITE_KEYS, type SiteKey } from "./contracts";

export type SiteZoomPreferences = Readonly<Partial<Record<SiteKey, number>>>;
export type SiteZoomAction = "in" | "out" | "reset";
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export const SITE_ZOOM_SHORTCUTS = [
  { action: "in", labelKey: "siteZoomIn", accelerator: "CmdOrCtrl+Plus" },
  { action: "out", labelKey: "siteZoomOut", accelerator: "CmdOrCtrl+-" },
  { action: "reset", labelKey: "siteZoomReset", accelerator: "CmdOrCtrl+0" }
] as const;

export function parseSiteZoom(value: unknown): SiteZoomPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  return Object.fromEntries(SITE_KEYS.flatMap(site => {
    const zoom = candidate[site];
    return typeof zoom === "number" && Number.isFinite(zoom) && zoom >= 0.25 && zoom <= 5
      ? [[site, zoom]] : [];
  }));
}

export function stepSiteZoom(current: number, action: SiteZoomAction): number {
  if (action === "reset") return 1;
  // Chromium returns factors with floating-point drift; leave room around each step.
  return action === "in"
    ? ZOOM_STEPS.find(value => value > current + 0.001) ?? 5
    : [...ZOOM_STEPS].reverse().find(value => value < current - 0.001) ?? 0.25;
}

interface ZoomInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly isComposing?: boolean;
}

export function siteZoomAction(input: ZoomInput, platform: string): SiteZoomAction | null {
  if (input.type !== "keyDown" || input.alt || input.isComposing) return null;
  if (!input.control && !(platform === "darwin" && input.meta)) return null;
  if (input.key === "+" || input.key === "=") return "in";
  if (input.key === "-") return "out";
  return input.key === "0" ? "reset" : null;
}
