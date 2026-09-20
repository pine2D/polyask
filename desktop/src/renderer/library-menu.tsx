import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { MoreIcon } from './icons';
import { useLibraryPopover } from './library-popover';

export function LibraryMenu({ label, disabled, actions }: {
  label: string; disabled?: boolean;
  actions: readonly { label: string; run: () => void; danger?: boolean; disabled?: boolean }[];
}): React.JSX.Element {
  const popover = useLibraryPopover();
  const id = useId();
  useEffect(() => {
    if (popover.open) popover.panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [popover.open, popover.panel]);
  useEffect(() => { if (disabled) popover.close(false); }, [disabled, popover.close]);
  return <>
    <button ref={popover.trigger} type="button" className="library-menu-trigger" aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={popover.open} aria-controls={popover.open ? id : undefined} disabled={disabled}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); popover.setOpen(true); } }}
      onClick={() => popover.open ? popover.close() : popover.setOpen(true)}><MoreIcon /></button>
    {popover.open && createPortal(<div ref={popover.panel} id={id} role="menu" aria-label={label}
      className="library-popover library-action-menu" style={popover.position} onKeyDown={event => {
        if (event.key === 'Tab') { popover.close(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = Array.from(popover.panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }}>
      {actions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1}
        className={action.danger ? 'danger' : ''} disabled={action.disabled}
        onClick={() => { popover.close(); action.run(); }}>{action.label}</button>)}
    </div>, document.body)}
  </>;
}
