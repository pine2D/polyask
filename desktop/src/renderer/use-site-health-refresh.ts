import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { SiteHealth } from '../shared/site-health';
import { shell } from './shell-api';

export function useSiteHealthRefresh(setHealth: Dispatch<SetStateAction<Partial<Record<string, SiteHealth>>>>, onFailure: () => void) {
  const sequence = useRef(0), mounted = useRef(true), failure = useRef(onFailure);
  failure.current = onFailure;
  const [checking, setChecking] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  const refresh = async (keys: readonly SiteHealth['site'][]): Promise<void> => {
    if (!keys.length) return;
    const request = ++sequence.current;
    setChecking(true);
    try {
      const results = await shell.checkSiteHealth(keys);
      if (!mounted.current || request !== sequence.current) return;
      setHealth(current => ({ ...current, ...Object.fromEntries(results.map(result => [result.site, result])) }));
    } catch { if (mounted.current && request === sequence.current) failure.current(); }
    finally { if (mounted.current && request === sequence.current) setChecking(false); }
  };
  return { checking, refresh };
}
