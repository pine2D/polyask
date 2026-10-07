import { useEffect, useRef, useState } from 'react';
import type { BackupPreview } from '../shared/backup';
import { shell } from './shell-api';

export function useBackupSelectionPreview(preview: BackupPreview, selected: ReadonlySet<string>) {
  const epoch = useRef(0);
  const [result, setResult] = useState<{ selected: ReadonlySet<string>; token: string; keys: ReadonlySet<string>; error?: unknown }>();
  useEffect(() => {
    const version = ++epoch.current;
    void shell.previewBackupSelection(preview.token, [...selected]).then(value => {
      if (version !== epoch.current) return;
      const available = new Set(preview.items.map(item => item.key));
      if (!Array.isArray(value.keys) || new Set(value.keys).size !== value.keys.length || value.keys.some(key => !selected.has(key) || !available.has(key))
        || value.imported !== value.keys.length || value.skipped !== preview.items.length - value.imported) throw new Error('backup_invalid');
      setResult({ selected, token: preview.token, keys: new Set(value.keys) });
    }).catch(error => {
      if (version === epoch.current) setResult({ selected, token: preview.token, keys: new Set(), error });
    });
    return () => { epoch.current++; };
  }, [preview.token, preview.items, selected]);
  const current = result?.selected === selected && result.token === preview.token;
  return { pending: !current, eligible: current ? result.keys : new Set<string>(), error: current ? result.error : undefined };
}
