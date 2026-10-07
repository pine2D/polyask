import { useEffect, useRef, useState } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import {
  groupSignature,
  workspacePresets,
  type ActiveWorkspaceGroup
} from "../shared/workspace";
import { SaveIcon, TrashIcon } from "./icons";
import { SiteChecklist } from "./site-checklist";
import type { SitesMode } from './workspace-panel-state';

interface WorkspaceSitesProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly participating: ReadonlySet<SiteKey>;
  readonly participationBusy?: boolean;
  readonly sitesMode?: SitesMode;
  readonly onSitesModeChange?: (mode: SitesMode) => void;
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly onSelectionChange: (sites: readonly SiteKey[]) => void;
  readonly onParticipationChange: (sites: readonly SiteKey[]) => void;
  readonly onCloseSitePage?: (site: SiteKey) => void;
  readonly onSaveGroup: (name: string) => Promise<boolean>;
  readonly onDeleteGroup: (id: string) => void;
}

export function WorkspaceSites(props: WorkspaceSitesProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [localMode, setLocalMode] = useState<SitesMode>('select');
  const mode = props.sitesMode ?? localMode;
  const modeButton = useRef<HTMLButtonElement>(null), previousMode = useRef(mode);
  const changeMode = (next: SitesMode) => props.onSitesModeChange ? props.onSitesModeChange(next) : setLocalMode(next);
  useEffect(() => {
    if (previousMode.current === 'order' && mode === 'select') modeButton.current?.focus();
    previousMode.current = mode;
  }, [mode]);
  useEffect(() => setPendingDeleteId(null), [props.groups, props.participating]);
  const choices = workspacePresets(props.sites);
  const selectedSites = [...props.participating];
  const selectedSignature = groupSignature(selectedSites);
  const reservedSignatures = new Set(
    [choices.all, choices.intl, choices.domestic].map(groupSignature)
  );
  const duplicate = props.groups.some((group) => groupSignature(group.sites) === selectedSignature);
  const saveHint = selectedSites.length === 0
    ? props.copy.groupSelectionRequired
    : reservedSignatures.has(selectedSignature)
      ? props.copy.groupPresetReserved
      : duplicate ? props.copy.groupAlreadySaved : "";
  const presets = [
    [props.copy.allSites, choices.all],
    [props.copy.clearSites, choices.clear],
    [props.copy.intlSites, choices.intl],
    [props.copy.domesticSites, choices.domestic]
  ] as const;
  const toggleSite = (site: SiteKey) => {
    const next = new Set(props.participating);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    props.onParticipationChange([...next]);
  };

  return (
    <div className="workspace-sites" data-sites-mode={mode} onKeyDown={event => {
      if (mode === 'order' && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); changeMode('select');
      }
    }}>
      <section className="drawer-section scope-section" aria-label={props.copy.scope} hidden={mode === 'order'}>
        <div className="drawer-section-heading"><h2>{props.copy.scope}</h2></div>
        <div className="scope-presets" aria-label={props.copy.scope}>
          {presets.map(([label, presetSites]) => (
            <button type="button" className="scope-preset" disabled={props.participationBusy} aria-pressed={groupSignature(presetSites) === selectedSignature} key={label} onClick={() => props.onParticipationChange([...selectedSites.filter((site) => presetSites.includes(site)), ...presetSites.filter((site) => !props.participating.has(site))])}>{label}</button>
          ))}
        </div>
      </section>
      <section className="drawer-section">
        <div className="drawer-section-heading"><h2>{props.copy.participationLabel}</h2><span>{formatCopy(props.copy.participationSummary, { opened: props.selected.size, participating: selectedSites.length })}</span></div>
        <button type="button" ref={modeButton} data-sites-mode-toggle aria-pressed={mode === 'order'} aria-controls="site-checklist"
          disabled={props.participationBusy || (mode === 'select' && props.selected.size === 0)} onClick={() => changeMode(mode === 'order' ? 'select' : 'order')}>
          {mode === 'order' ? props.copy.finishSiteOrder : props.copy.adjustSiteOrder}</button>
        {mode === 'select' ? <><p>{props.copy.participationSessionHint}</p><p>{props.copy.participationResourcesHint}</p></> : <p>{props.copy.siteOrderSaveHint}</p>}
        <SiteChecklist copy={props.copy} sites={props.sites} selected={props.selected} participating={props.participating} mode={mode} disabled={props.participationBusy} onToggle={toggleSite} onReorder={props.onSelectionChange} onCloseSitePage={props.onCloseSitePage} />
      </section>
      <section className="drawer-section group-section" hidden={mode === 'order'}>
        <div className="drawer-section-heading"><h2>{props.copy.savedGroups}</h2><span>{props.groups.length}</span></div>
        {props.groups.length === 0 ? <p>{props.copy.noSavedGroups}</p> : (
          <div className="group-list">
            {props.groups.map((group) => pendingDeleteId === group.id ? (
              <div className="group-confirm" data-group-id={group.id} key={group.id}>
                <span>{formatCopy(props.copy.confirmDeleteGroup, { group: group.name })}</span>
                <button type="button" className="danger" onClick={() => props.onDeleteGroup(group.id)}>{props.copy.confirmDelete}</button>
                <button type="button" onClick={() => setPendingDeleteId(null)}>{props.copy.cancelDelete}</button>
              </div>
            ) : (
              <div className="group-row" data-group-id={group.id} key={group.id}>
                <button type="button" className="group-apply" disabled={props.participationBusy} data-hint={group.name} aria-pressed={groupSignature(group.sites) === selectedSignature} onClick={() => props.onParticipationChange(group.sites)}>
                  <strong>{group.name}</strong>
                  <small>{group.sites.map((key) => props.sites.find((site) => site.key === key)?.label).filter(Boolean).join(" · ")}</small>
                </button>
                <button type="button" data-hint={formatCopy(props.copy.deleteGroup, { group: group.name })} aria-label={formatCopy(props.copy.deleteGroup, { group: group.name })} onClick={() => setPendingDeleteId(group.id)}><TrashIcon /></button>
              </div>
            ))}
          </div>
        )}
        <form className="group-save" aria-busy={saving} onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || saveHint || saving) return;
          setSaving(true);
          void props.onSaveGroup(trimmed).then((saved) => { if (saved) setName(""); }).finally(() => setSaving(false));
        }}>
          <input name="group-name" autoComplete="off" value={name} maxLength={80} aria-describedby="group-save-hint" aria-label={props.copy.groupNamePlaceholder} placeholder={props.copy.groupNamePlaceholder} onChange={(event) => setName(event.target.value)} />
          <button type="submit" data-hint={saveHint || props.copy.saveGroup} aria-label={props.copy.saveGroup} disabled={!name.trim() || !!saveHint || saving}><SaveIcon /></button>
          <span id="group-save-hint" className="group-save-hint" role="status">{saving ? props.copy.groupSaving : saveHint}</span>
        </form>
      </section>
    </div>
  );
}
