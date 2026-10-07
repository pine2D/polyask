import { useState } from 'react';

/** 保存副本与收集比较的导航意图，共用根层已存目标。 */
export function useArchiveNavigation() {
  const [target, setTarget] = useState<{ id: string | null; mode: 'read' | 'compare'; revision: number }>({ id: null, mode: 'read', revision: 0 });
  return {
    preferredId: target.id,
    comparisonId: target.mode === 'compare' ? target.id : null,
    revision: target.revision,
    history: (id: string, mode: 'read' | 'compare') => setTarget(old => ({ id, mode, revision: old.revision + 1 })),
    collection: (id?: string) => setTarget(old => ({ id: id ?? null, mode: id ? 'compare' : 'read', revision: old.revision + 1 })),
    clear: () => setTarget(old => ({ id: null, mode: 'read', revision: old.revision + 1 }))
  };
}
