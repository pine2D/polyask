type NavigationGuard = (action: () => void) => void;
let guard: NavigationGuard | null = null;
let approvedDepth = 0;

export function runApprovedDecisionNavigation(action: () => void): void {
  approvedDepth++;
  try { action(); } finally { approvedDepth--; }
}

export function registerDecisionNavigationGuard(handler: NavigationGuard): () => void {
  guard = handler;
  return () => { if (guard === handler) guard = null; };
}

export function requestDecisionNavigation(action: () => void): void {
  if (guard && !approvedDepth) guard(() => runApprovedDecisionNavigation(action)); else action();
}
