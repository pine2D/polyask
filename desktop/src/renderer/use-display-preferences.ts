import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplayPreferences } from '../shared/display';
import { applyDisplayPreferences } from './display-preferences';
import { shell } from './shell-api';

/** 菜单推送与设置共用已接受状态；迟到的保存回包不得覆盖更近的菜单选择。 */
export function useDisplayPreferences(initial: DisplayPreferences, onPersistenceFailure: () => void) {
  const [value, setValue] = useState(initial);
  const revision = useRef(0), mounted = useRef(true);
  const failure = useRef(onPersistenceFailure); failure.current = onPersistenceFailure;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const accept = useCallback((next: DisplayPreferences) => {
    if (!mounted.current) return;
    revision.current++;
    setValue(next);
    applyDisplayPreferences(document.documentElement, window.localStorage, next, () => failure.current());
  }, []);
  const save = async (next: DisplayPreferences) => {
    const requestRevision = revision.current;
    const accepted = await shell.setDisplayPreferences(next);
    if (mounted.current && requestRevision === revision.current) accept(accepted);
  };
  return { value, accept, save };
}
