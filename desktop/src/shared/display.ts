import type { LayoutMode } from "./contracts";

export const MIN_SITE_COLUMN_WIDTH = 380;
export const WINDOW_TITLEBAR_HEIGHT = 22;
export const WORKSPACE_FEEDBACK_HEIGHT = 26;
export const TILE_FRAME_INSET = 3;

export type Density = "compact" | "comfortable";
export type ToolbarLayout = 'inline' | 'stacked';
export const MIN_SINGLE_ROW_TOOLBAR_WIDTH = 960;

export function toolbarLayoutForWidth(width: number): ToolbarLayout {
  return width > 0 && width < MIN_SINGLE_ROW_TOOLBAR_WIDTH ? 'stacked' : 'inline';
}
export type SiteScale = 0.9 | 1;

export interface DisplayPreferences {
  readonly density: Density;
  readonly siteScale: SiteScale;
}

export interface DisplayMetrics {
  readonly shellHeight: number;
  readonly tileHeaderHeight: number;
  readonly edgeGap: number;
  readonly viewGap: number;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  density: "compact",
  siteScale: 0.9
};

export function parseDisplayPreferences(value: unknown): DisplayPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.density !== "compact" && candidate.density !== "comfortable") return null;
  if (candidate.siteScale !== 0.9 && candidate.siteScale !== 1) return null;
  return { density: candidate.density, siteScale: candidate.siteScale };
}

export function metricsForDensity(density: Density): DisplayMetrics {
  return density === "compact"
    ? { shellHeight: 44, tileHeaderHeight: 24, edgeGap: 6, viewGap: 8 }
    : { shellHeight: 54, tileHeaderHeight: 30, edgeGap: 8, viewGap: 10 };
}

export function shellHeightForComposer(density: Density, expanded: boolean, layout: ToolbarLayout = 'inline'): number {
  if (layout === 'stacked') return density === 'compact' ? expanded ? 176 : 104 : expanded ? 212 : 128;
  return expanded ? density === "compact" ? 112 : 132 : metricsForDensity(density).shellHeight;
}

export function zoomForSite(
  preferences: DisplayPreferences,
  mode: LayoutMode,
  isFocused: boolean
): SiteScale {
  if (preferences.siteScale === 1 || (mode === "focus" && isFocused)) return 1;
  return 0.9;
}
