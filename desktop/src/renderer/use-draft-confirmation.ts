import { useRef, useState } from 'react';
import type { DesktopSurface } from '../shared/protocol';
import type { CommandActions } from './command-dispatcher';

/** A draft dialog may only release the native cover that it acquired. */
export function useDraftConfirmation(commands: { current: CommandActions }) {
  const [blocking, setBlocking] = useState(false);
  const owner = useRef<{ token: symbol; revision: number } | null>(null);
  const revision = useRef(0), surface = useRef<DesktopSurface>('sites');
  const surfaceChanged = (value: DesktopSurface) => { surface.current = value; revision.current++; };
  const change = (value: boolean, token: symbol, changeSurface: (value: DesktopSurface) => void) => {
    if (value) {
      commands.current = {};
      changeSurface('confirmation');
      owner.current = { token, revision: revision.current };
      setBlocking(true);
      return;
    }
    const lease = owner.current;
    if (!lease || lease.token !== token) return;
    owner.current = null; setBlocking(false);
    if (lease.revision === revision.current && surface.current === 'confirmation') changeSurface('sites');
  };
  return { blocking, isBlocking: () => owner.current !== null, surfaceChanged, change };
}
