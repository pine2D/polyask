import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandPaletteShortcutState } from '../shared/command-palette-shortcut';
import { shell } from './shell-api';

export function useCommandPaletteShortcut(): {
  state: CommandPaletteShortcutState | null; readFailed: boolean; refresh(): Promise<void>;
} {
  const [state, setState] = useState<CommandPaletteShortcutState | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const mounted = useRef(false), sequence = useRef(0), revision = useRef(-1);
  const accept = useCallback((value: CommandPaletteShortcutState) => {
    if (!mounted.current || value.revision < revision.current) return;
    revision.current = value.revision; setState(value); setReadFailed(false);
  }, []);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    try { const next = await shell.commandPaletteShortcutState(); if (ticket === sequence.current) accept(next); }
    catch { if (mounted.current && ticket === sequence.current && revision.current < 0) setReadFailed(true); }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    // Subscribe before reading: an event can arrive while the initial invoke is in flight.
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = shell.onCommandPaletteShortcut(accept); } catch { setReadFailed(true); }
    void refresh();
    return () => { mounted.current = false; sequence.current++; unsubscribe?.(); };
  }, [accept, refresh]);
  return { state, readFailed, refresh };
}
