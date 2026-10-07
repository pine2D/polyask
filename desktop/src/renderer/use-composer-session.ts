import { useEffect, useState } from "react";
import type { DesktopSurface } from "../shared/protocol";

export function useComposerSession(surface: DesktopSurface) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (surface !== "sites" && surface !== "confirmation" && surface !== "question-history") setExpanded(false);
  }, [surface]);
  return { expanded, setExpanded, reset: () => setExpanded(false) };
}
