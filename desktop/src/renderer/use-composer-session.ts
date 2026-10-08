import { useEffect, useState } from "react";
import type { DesktopSurface } from "../shared/protocol";
import { usePresence } from "./presence";
import { COMPOSER_EXIT_MS } from "./motion";

export function useComposerSession(surface: DesktopSurface) {
  const [expanded, setExpanded] = useState(false);
  const active = surface === "sites" || surface === "confirmation" || surface === "question-history";
  const present = usePresence(expanded, COMPOSER_EXIT_MS, active);
  useEffect(() => {
    if (surface !== "sites" && surface !== "confirmation" && surface !== "question-history") setExpanded(false);
  }, [surface]);
  return { expanded, reservedExpanded: active && present, setExpanded, reset: () => setExpanded(false) };
}
