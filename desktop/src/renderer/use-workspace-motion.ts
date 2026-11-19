import { useEffect, useLayoutEffect } from "react";
import type { DesktopSurface, LayoutState } from "../shared/protocol";
import { WINDOW_TITLEBAR_HEIGHT, shellHeightForComposer, toolbarLayoutForWidth, type Density } from "../shared/display";
import { PANEL_EXIT_MS } from "./motion";
import { usePresence } from "./presence";
import { shell } from "./shell-api";
import { useComposerSession } from "./use-composer-session";

/** Lock shell toolbar/composer geometry to native WebContentsView layout updates for split-free 0ms snaps. */
export function useWorkspaceMotion(surface: DesktopSurface, drawerOpen: boolean,
  inputMethod: "pointer" | "keyboard", imagePresent: boolean,
  geometry?: { readonly layout: LayoutState; readonly density: Density; readonly covered: boolean; readonly titlebarHeight?: number }) {
  const active = surface === "sites" || surface === "confirmation" || surface === "question-history";
  const drawerPresent = usePresence(drawerOpen, inputMethod === "keyboard" ? 0 : PANEL_EXIT_MS, active);
  const composer = useComposerSession(surface);
  useLayoutEffect(() => shell.setDrawerOpen(active && (drawerPresent || imagePresent)), [active, drawerPresent, imagePresent]);
  useLayoutEffect(() => shell.setComposerExpanded(active && composer.expanded), [active, composer.expanded]);
  useEffect(() => shell.onComposerOutsidePointer?.(() => composer.setExpanded(false)), [composer.setExpanded]);
  const hasLivePlacements = Boolean(geometry && !geometry.covered && geometry.layout.placements.length > 0);
  const titlebar = geometry?.titlebarHeight ?? WINDOW_TITLEBAR_HEIGHT;
  const layoutExpanded = hasLivePlacements && (
    geometry!.layout.composerExpanded !== undefined
      ? geometry!.layout.composerExpanded
      : geometry!.layout.placements.every(
          placement => placement.bounds.y >= titlebar + shellHeightForComposer(geometry!.density, true, toolbarLayoutForWidth(window.innerWidth))
        )
  );
  const syncedExpanded = active && (hasLivePlacements ? layoutExpanded : composer.reservedExpanded);
  return {
    composer: { ...composer, reservedExpanded: syncedExpanded, revealedExpanded: syncedExpanded },
    drawerPresent
  };
}
