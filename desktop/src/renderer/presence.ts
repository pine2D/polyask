import { useEffect, useState } from "react";

export function usePresence(open: boolean, exitMs: number, enabled = true): boolean {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!enabled) { setPresent(false); return undefined; }
    if (open) {
      setPresent(true);
      return undefined;
    }
    if (motion.matches || exitMs === 0) { setPresent(false); return undefined; }
    const timer = window.setTimeout(() => setPresent(false), exitMs);
    const onMotionChange = () => { if (motion.matches) { window.clearTimeout(timer); setPresent(false); } };
    motion.addEventListener('change', onMotionChange);
    return () => { window.clearTimeout(timer); motion.removeEventListener('change', onMotionChange); };
  }, [exitMs, open, enabled]);
  return enabled && (open || present);
}
