import type { CommandId } from '../shared/commands';
import type { DesktopSurface } from '../shared/protocol';

export type NavigationIntent = { kind: 'command'; id: CommandId } | { kind: 'surface'; surface: DesktopSurface };
type NavigationGuard = (action: () => void, intent?: NavigationIntent) => void;
const guards = new Set<{ handler: NavigationGuard }>();
let approvedDepth = 0;

export function runApprovedDecisionNavigation(action: () => void): void {
  approvedDepth++;
  try { action(); } finally { approvedDepth--; }
}

export function registerDecisionNavigationGuard(handler: NavigationGuard): () => void {
  const entry = { handler };
  guards.add(entry);
  return () => { guards.delete(entry); };
}

export function requestDecisionNavigation(action: () => void, intent?: NavigationIntent): void {
  if (approvedDepth) { action(); return; }
  // 先处理后打开的浮层；所有仍挂载的保护放行后，才批准最终导航及其嵌套动作。
  const pending = [...guards].reverse();
  const next = (index: number): void => {
    const entry = pending[index];
    if (!entry) { runApprovedDecisionNavigation(action); return; }
    if (!guards.has(entry)) { next(index + 1); return; }
    let continued = false;
    entry.handler(() => {
      if (continued) return;
      continued = true;
      next(index + 1);
    }, intent);
  };
  next(0);
}
