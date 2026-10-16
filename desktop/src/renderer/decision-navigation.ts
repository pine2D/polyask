import type { CommandId } from '../shared/commands';
import type { DesktopSurface } from '../shared/protocol';

export type NavigationIntent = { kind: 'command'; id: CommandId } | { kind: 'surface'; surface: DesktopSurface };
type NavigationGuard = (action: () => void, intent?: NavigationIntent) => void;
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

export function requestDecisionNavigation(action: () => void, intent?: NavigationIntent): void {
  if (guard && !approvedDepth) guard(() => runApprovedDecisionNavigation(action), intent); else action();
}
