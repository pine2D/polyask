import { useEffect, useRef, useState } from 'react';

export type DraftBlockingChange = (blocking: boolean, owner: symbol) => void;

/** Acquire synchronously; cleanup always releases the original owner callback. */
export function useDraftDialog(compact: boolean | undefined, context: string | undefined, notify?: DraftBlockingChange) {
  const [open, setOpen] = useState(false);
  const lease = useRef<{ token: symbol; notify?: DraftBlockingChange } | null>(null);
  const release = () => {
    const active = lease.current;
    if (!active) return;
    lease.current = null; active.notify?.(false, active.token);
  };
  const close = () => { setOpen(false); release(); };
  const show = () => {
    if (lease.current) return;
    if (compact) {
      const token = Symbol('draft-confirmation');
      lease.current = { token, notify }; notify?.(true, token);
    }
    setOpen(true);
  };
  useEffect(() => { close(); }, [context]);
  useEffect(() => () => release(), []);
  return { open, show, close };
}
