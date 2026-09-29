// Empty in normal runs. Notify controllers before dispatch, including newly
// created renderers that have not appeared in a periodic view inventory yet.
const listeners = new Set<(id: number) => void>();
export function observeSiteCommands(wake: (id: number) => void): () => void {
  listeners.add(wake);
  return () => { listeners.delete(wake); };
}
export function beforeSiteSubmit(id: number): void { for (const wake of listeners) wake(id); }
