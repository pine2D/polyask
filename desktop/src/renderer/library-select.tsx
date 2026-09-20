import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from './icons';
import { useLibraryPopover } from './library-popover';

export interface LibraryOption { value: string; label: string; disabled?: boolean }
export function nextEnabledOption(options: readonly LibraryOption[], current: number, direction: 1 | -1): number {
  for (let step = 1; step <= options.length; step++) {
    const index = (current + direction * step + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function LibrarySelect({ label, value, options, onChange, disabled, searchLabel, emptyLabel }: {
  label: string; value: string; options: readonly LibraryOption[]; onChange: (value: string) => void;
  disabled?: boolean; searchLabel?: string; emptyLabel?: string;
}): React.JSX.Element {
  const popover = useLibraryPopover();
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const current = options.find(option => option.value === value);
  const show = () => {
    if (disabled) return;
    setQuery('');
    const index = options.findIndex(option => option.value === value && !option.disabled);
    setActive(index >= 0 ? index : nextEnabledOption(options, -1, 1));
    popover.setOpen(true);
  };
  useEffect(() => { if (popover.open && searchLabel) search.current?.focus(); }, [popover.open, searchLabel]);
  useEffect(() => { if (disabled) popover.close(false); }, [disabled, popover.close]);
  useEffect(() => {
    if (popover.open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id, popover.open]);
  const choose = (index: number) => {
    const option = filtered[index];
    if (!option || option.disabled) return;
    popover.close(); onChange(option.value);
  };
  const keydown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Tab') { if (popover.open) popover.close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!popover.open) { show(); return; }
      if (event.key === 'Home') setActive(nextEnabledOption(filtered, -1, 1));
      else if (event.key === 'End') setActive(nextEnabledOption(filtered, 0, -1));
      else setActive(nextEnabledOption(filtered, active, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target === popover.trigger.current)) {
      event.preventDefault(); event.stopPropagation();
      if (popover.open) choose(active); else show();
    }
  };
  return <>
    <button type="button" className="library-select" ref={popover.trigger} role="combobox" aria-label={label}
      aria-expanded={popover.open} aria-controls={popover.open ? id : undefined} aria-haspopup="listbox"
      aria-activedescendant={popover.open && active >= 0 && !searchLabel ? `${id}-${active}` : undefined}
      disabled={disabled} onKeyDown={keydown} onClick={() => popover.open ? popover.close() : show()}>
      <span>{current?.label ?? label}</span><ChevronDownIcon />
    </button>
    {popover.open && createPortal(<div ref={popover.panel} className="library-popover" style={popover.position} onKeyDown={keydown}>
      {searchLabel ? <input ref={search} type="search" name="library-option-search" autoComplete="off" role="combobox"
        aria-label={searchLabel} placeholder={`${searchLabel}…`} aria-expanded="true" aria-controls={id}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} value={query}
        onChange={event => { setQuery(event.target.value); setActive(-1); }} /> : null}
      <div id={id} role="listbox" aria-label={label} className="library-options">
        {filtered.map((option, index) => <div id={`${id}-${index}`} key={option.value} role="option"
          aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          data-active={active === index} onMouseDown={event => event.preventDefault()}
          onMouseMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
          <span>{option.label}</span><span aria-hidden="true">{option.value === value ? '✓' : ''}</span>
        </div>)}
        {!filtered.length ? <p role="status">{emptyLabel}</p> : null}
      </div>
    </div>, document.body)}
  </>;
}
