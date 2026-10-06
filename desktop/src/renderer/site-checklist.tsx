import { useRef, useState } from "react";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { SelectionMark } from "./selection-mark";

interface SiteChecklistProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly onToggle: (site: SiteKey) => void;
  readonly onReorder: (sites: readonly SiteKey[]) => void;
}

export function SiteChecklist(props: SiteChecklistProps): React.JSX.Element {
  const dragged = useRef<SiteKey | null>(null);
  const [dragging, setDragging] = useState<SiteKey | null>(null);
  const [drop, setDrop] = useState<{ site: SiteKey; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const selected = [...props.selected];
  const sites = [...selected, ...props.sites.map(site => site.key).filter(key => !props.selected.has(key))]
    .flatMap(key => props.sites.find(site => site.key === key) ?? []);
  const resetDrag = () => { dragged.current = null; setDragging(null); setDrop(null); };
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
    <p className="site-order-hint" id="site-order-hint">{props.copy.siteOrderHint}</p>
    <div className="site-checklist">
      {sites.map(site => {
        const index = selected.indexOf(site.key);
        const checked = index >= 0;
        const label = formatCopy(props.copy.reorderSite, { site: site.label });
        return <div className="site-choice" key={site.key} data-site-key={site.key} data-selected={checked}
          data-dragging={dragging === site.key || undefined} data-drop={drop?.site === site.key ? drop.after ? "after" : "before" : undefined}
          onDragOver={event => {
            if (!dragged.current || !props.selected.has(dragged.current) || !checked) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDrop(dropPosition(event, site.key));
          }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
          onDrop={event => {
            const source = dragged.current;
            if (!source || !props.selected.has(source) || !checked) return;
            event.preventDefault();
            const { after } = dropPosition(event, site.key);
            const position = selected.filter(key => key !== source).indexOf(site.key) + (after ? 1 : 0);
            if (source !== site.key) move(source, position);
            resetDrag();
          }}>
          {checked ? <button type="button" className="site-drag-handle" draggable aria-label={label} aria-describedby="site-order-hint" data-hint={label}
            onDragStart={event => {
              dragged.current = site.key; setDragging(site.key);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", site.key);
            }} onDragEnd={resetDrag} onKeyDown={event => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              move(site.key, index + (event.key === "ArrowUp" ? -1 : 1));
            }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h1m4 0h1M5 8h1m4 0h1M5 13h1m4 0h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
            : <span className="site-handle-spacer" />}
          <label data-selected={checked}>
            <input className="sr-only" type="checkbox" name="scope-sites" value={site.key} checked={checked} onChange={() => props.onToggle(site.key)} />
            <span>{site.label}</span><SelectionMark />
          </label>
          {checked && <div className="site-move-actions">
            <button type="button" data-move="up" aria-label={formatCopy(props.copy.moveSiteUp, { site: site.label })} disabled={index === 0} onClick={() => move(site.key, index - 1)}>↑</button>
            <button type="button" data-move="down" aria-label={formatCopy(props.copy.moveSiteDown, { site: site.label })} disabled={index === selected.length - 1} onClick={() => move(site.key, index + 1)}>↓</button>
          </div>}
        </div>;
      })}
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
  </>;
}
