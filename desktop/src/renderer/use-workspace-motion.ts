import { useEffect } from "react";
import type { DesktopSurface, LayoutState } from "../shared/protocol";
import { shellHeightForComposer, type Density } from "../shared/display";
import { PANEL_EXIT_MS } from "./motion";
import { usePresence } from "./presence";
import { shell } from "./shell-api";
import { useComposerSession } from "./use-composer-session";

/** Reserve native geometry at entry and release it after DOM panels finish their exits. */
export function useWorkspaceMotion(surface: DesktopSurface, drawerOpen: boolean,
  inputMethod: "pointer" | "keyboard", imagePresent: boolean,
  geometry?: { readonly layout: LayoutState; readonly density: Density; readonly covered: boolean }) {
  const active = surface === "sites" || surface === "confirmation" || surface === "question-history";
  const drawerPresent = usePresence(drawerOpen, inputMethod === "keyboard" ? 0 : PANEL_EXIT_MS, active);
  const composer = useComposerSession(surface);
  useEffect(() => shell.setDrawerOpen(active && (drawerPresent || imagePresent)), [active, drawerPresent, imagePresent]);
  useEffect(() => shell.setComposerExpanded(composer.reservedExpanded), [composer.reservedExpanded]);
  const ready = !geometry || geometry.covered || !geometry.layout.placements.length ||
    geometry.layout.placements.every(placement => placement.bounds.y >= shellHeightForComposer(geometry.density, true));
  return { composer: { ...composer, revealedExpanded: composer.expanded && ready }, drawerPresent };
}
