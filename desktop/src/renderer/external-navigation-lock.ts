// A confirmation owns its current user decision. New commands/notifications must
// wait, while the action already approved by that confirmation can still finish.
const confirmations = new Set<object>();
export function holdExternalNavigation(): () => void {
  const token = {};
  confirmations.add(token);
  return () => { confirmations.delete(token); };
}
export function externalNavigationBlocked(): boolean { return confirmations.size > 0; }
