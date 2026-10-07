import { useState } from 'react';

/** 保存副本与收集比较的导航意图，共用根层已存目标。 */
export function useArchiveNavigation() {
  const [target, setTarget] = useState<{ id: string | null; mode: 'read' | 'compare' }>({ id: null, mode: 'read' });
  return {
    preferredId: target.id,
    comparisonId: target.mode === 'compare' ? target.id : null,
    history: (id: string, mode: 'read' | 'compare') => setTarget({ id, mode }),
    collection: (id?: string) => setTarget({ id: id ?? null, mode: id ? 'compare' : 'read' }),
    clear: () => setTarget({ id: null, mode: 'read' })
  };
}
