import { useEffect, useRef, useState } from "react";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { SelectionMark } from "./selection-mark";
import { CloseIcon } from './icons';
import type { SitesMode } from './workspace-panel-state';

interface SiteChecklistProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly participating: ReadonlySet<SiteKey>;
  readonly disabled?: boolean;
  readonly mode: SitesMode;
  readonly onToggle: (site: SiteKey) => void;
  readonly onReorder: (sites: readonly SiteKey[]) => void;
  readonly onCloseSitePage?: (site: SiteKey) => void;
}

export function SiteChecklist(props: SiteChecklistProps): React.JSX.Element {
  const dragged = useRef<SiteKey | null>(null);
  const [dragging, setDragging] = useState<SiteKey | null>(null);
  const [drop, setDrop] = useState<{ site: SiteKey; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const previousMode = useRef(props.mode);
  const previousDisabled = useRef(props.disabled);
  const focusedOrderControl = useRef<{ site: SiteKey; index: number; node: HTMLElement } | null>(null);
  const selected = [...props.selected];
  const sites = [...selected, ...(props.mode === 'select' ? props.sites.map(site => site.key).filter(key => !props.selected.has(key)) : [])]
    .flatMap(key => props.sites.find(site => site.key === key) ?? []);
  const resetDrag = () => { dragged.current = null; setDragging(null); setDrop(null); };
  useEffect(() => {
    resetDrag();
    if (props.mode === 'order' && previousMode.current !== 'order') list.current?.querySelector<HTMLButtonElement>('.site-drag-handle')?.focus();
    const focused = focusedOrderControl.current, document = list.current?.ownerDocument;
    if (props.mode === 'order' && focused && document && (!document.activeElement || document.activeElement === document.body)) {
      if (!props.selected.has(focused.site) && !focused.node.isConnected) {
        const handles = list.current?.querySelectorAll<HTMLButtonElement>('.site-drag-handle');
        const next = handles?.[Math.min(focused.index, handles.length - 1)] ??
          list.current?.closest('.workspace-sites')?.querySelector<HTMLButtonElement>('[data-sites-mode-toggle]');
        next?.focus();
      } else if (previousDisabled.current && !props.disabled && focused.node.isConnected) {
        const next = focused.node.matches(':disabled')
          ? list.current?.querySelector<HTMLButtonElement>(`[data-site-key="${focused.site}"] .site-drag-handle`)
          : focused.node;
        next?.focus();
      }
    }
    if (props.mode !== 'order') focusedOrderControl.current = null;
    previousMode.current = props.mode;
    previousDisabled.current = props.disabled;
  }, [props.mode, props.disabled, selected.join(',')]);
  const move = (site: SiteKey, position: number) => {
    const from = selected.indexOf(site);
    if (from < 0 || position < 0 || position >= selected.length || position === from) return;
    const next = selected.filter(key => key !== site);
    next.splice(position, 0, site);
    props.onReorder(next);
    setAnnouncement(formatCopy(props.copy.siteOrderChanged, {
      site: props.sites.find(item => item.key === site)?.label ?? site, position: position + 1, total: next.length
    }));
  };
  const dropPosition = (event: React.DragEvent, site: SiteKey) => ({
    site, after: event.clientY >= event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2
  });

  return <>
    {props.mode === 'order' && <p className="site-order-hint" id="site-order-hint">{props.copy.siteOrderHint}</p>}
    <div className="site-checklist" id="site-checklist" ref={list} onFocusCapture={event => {
      if (props.mode !== 'order') return;
      const site = event.target.closest<HTMLElement>('[data-site-key]')?.dataset.siteKey as SiteKey | undefined;
      if (site && props.selected.has(site)) focusedOrderControl.current = { site, index: selected.indexOf(site), node: event.target };
    }} onKeyDownCapture={event => {
      if (event.key === 'Escape' && dragged.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); resetDrag();
      }
    }}>
      {sites.map(site => {
        const index = selected.indexOf(site.key);
        const opened = index >= 0;
        const checked = props.participating.has(site.key);
        const label = formatCopy(props.copy.reorderSite, { site: site.label });
        return <div className="site-choice" key={site.key} data-site-key={site.key} data-selected={checked} data-opened={opened}
          data-dragging={dragging === site.key || undefined} data-drop={drop?.site === site.key ? drop.after ? "after" : "before" : undefined}
          onDragOver={event => {
            if (props.disabled || !dragged.current || !props.selected.has(dragged.current) || !opened) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDrop(dropPosition(event, site.key));
          }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
          onDrop={event => {
            const source = dragged.current;
            if (props.disabled || !source || !props.selected.has(source) || !opened) return;
            event.preventDefault();
            const { after } = dropPosition(event, site.key);
            const position = selected.filter(key => key !== source).indexOf(site.key) + (after ? 1 : 0);
            if (source !== site.key) move(source, position);
            resetDrag();
          }}>
          {opened && props.mode === 'order' ? <button type="button" className="site-drag-handle" disabled={props.disabled} draggable={!props.disabled} aria-label={label} aria-describedby="site-order-hint" data-hint={label}
            onDragStart={event => {
              dragged.current = site.key; setDragging(site.key);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", site.key);
            }} onDragEnd={resetDrag} onKeyDown={event => {
              if (props.disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              move(site.key, index + (event.key === "ArrowUp" ? -1 : 1));
            }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h1m4 0h1M5 8h1m4 0h1M5 13h1m4 0h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
            : null}
          {props.mode === 'select' ? <label data-selected={checked}>
            <input className="sr-only" type="checkbox" name="scope-sites" value={site.key} checked={checked} disabled={props.disabled} onChange={() => props.onToggle(site.key)} />
            <span>{site.label}</span><SelectionMark />
          </label> : <span className="site-order-label">{site.label}</span>}
          <span className="site-page-state">{opened ? !checked ? props.copy.sitePageRetained : '' : props.copy.sitePageClosed}</span>
          {opened && props.mode === 'order' && <div className="site-move-actions">
            <button type="button" data-move="up" aria-label={formatCopy(props.copy.moveSiteUp, { site: site.label })} disabled={props.disabled || index === 0} onClick={() => move(site.key, index - 1)}>↑</button>
            <button type="button" data-move="down" aria-label={formatCopy(props.copy.moveSiteDown, { site: site.label })} disabled={props.disabled || index === selected.length - 1} onClick={() => move(site.key, index + 1)}>↓</button>
          </div>}
          {opened && props.mode === 'select' && props.onCloseSitePage && <button type="button" data-close-site={site.key} className="site-page-close" disabled={props.disabled}
            aria-label={formatCopy(props.copy.closeSitePage, { site: site.label })} data-hint={formatCopy(props.copy.closeSitePage, { site: site.label })}
            onClick={() => props.onCloseSitePage?.(site.key)}><CloseIcon /></button>}
        </div>;
      })}
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
  </>;
}
