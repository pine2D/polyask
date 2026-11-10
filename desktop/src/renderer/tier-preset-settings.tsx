import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SITE_KEYS, type SiteKey } from '../shared/contracts';
import { formatCopy } from '../shared/copy';
import { presetLabel } from '../shared/tier-presets';
import { ConfirmDialog } from './confirm-dialog';
import { registerDecisionNavigationGuard } from './decision-navigation';
import { sameDraft, useTierPresets, type TierPresetSettingsProps } from './use-tier-presets';

const SETTINGS_COMMANDS = new Set(['open-settings', 'open-display-settings', 'open-data-settings', 'open-drive-diagnostics']);
export function TierPresetSettings(props: TierPresetSettingsProps): React.JSX.Element {
  const { copy } = props, [site, setSite] = useState<SiteKey>('claude'), form = useTierPresets(props, site);
  const siteNames: Record<SiteKey, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', deepseek: 'DeepSeek', kimi: 'Kimi',
    doubao: copy.draftSiteDoubao, qianwen: copy.draftSiteQianwen, yuanbao: copy.draftSiteYuanbao, chatglm: copy.draftSiteChatglm };
  const [leaveOpen, setLeaveOpen] = useState(false), navigation = useRef<(() => void) | null>(null);
  const dirty = !sameDraft(form.drafts.fast, form.saved.fast) || !sameDraft(form.drafts.think, form.saved.think);
  const latest = useRef({ dirty, saving: false }); latest.current = { dirty, saving: form.pending === 'save' };
  useEffect(() => registerDecisionNavigationGuard((action, intent) => {
    if (navigation.current || latest.current.saving) return;
    if (!latest.current.dirty || (intent?.kind === 'command' && SETTINGS_COMMANDS.has(intent.id))) { action(); return; }
    navigation.current = action; setLeaveOpen(true);
  }), []);
  useEffect(() => { if (!dirty) { navigation.current = null; setLeaveOpen(false); } }, [dirty]);
  const blocked = !!props.disabled || !!form.pending || !props.snapshot;
  return <section className="settings-card settings-display tier-presets" aria-labelledby="tier-presets-title" aria-busy={!!form.pending}>
    <h2 id="tier-presets-title" tabIndex={-1}>{copy.presetTitle}</h2>
    <p>{copy.presetDescription}</p>
    <label className="tier-preset-site" htmlFor="tier-preset-site">{copy.presetSite}
      <select id="tier-preset-site" className="settings-control" value={site} disabled={blocked} onChange={event => {
        const next = event.target.value as SiteKey; if (blocked || !SITE_KEYS.includes(next) || next === site) return;
        if (dirty) { navigation.current = () => setSite(next); setLeaveOpen(true); } else setSite(next);
      }}>{SITE_KEYS.map(key => <option key={key} value={key}>{siteNames[key]}</option>)}</select>
    </label>
    <p id="tier-presets-hint" className="settings-control-hint">{copy.presetReadHint}</p>
    {site === 'kimi' ? <p className="settings-control-hint">{copy.presetKimiHint}</p> : null}
    <div className="settings-actions"><button type="button" className="settings-control" data-preset-action="refresh" disabled={blocked}
      onClick={() => void form.refresh()}>{form.models ? copy.presetRefreshAgain : copy.presetRefresh}</button></div>
    {(['fast', 'think'] as const).map(mode => {
      const draft = form.drafts[mode], saved = form.saved[mode], catalog = (draft && form.catalogs.get(draft.model)) || form.catalogs.values().next().value;
      const choices = draft ? form.catalogs.get(draft.model)?.efforts : undefined;
      const modeOnly = catalog?.primary === 'mode' && !catalog.efforts.length;
      const primary = !catalog ? copy.presetChoice : catalog.primary === 'mode' ? copy.presetMode : catalog.primary === 'feature' ? copy.presetFeature : copy.presetModel;
      const secondary = catalog?.secondary === 'toggle' ? copy.presetToggle : catalog?.secondary === 'mode' ? copy.presetMode : copy.presetEffort;
      const effortLabel = (value: string) => catalog?.secondary === 'toggle' ? value === 'On' ? copy.presetOn : value === 'Off' ? copy.presetOff : value : value;
      const missingModel = !!draft && !!form.models && !form.models.includes(draft.model);
      const missingEffort = !!draft?.effort && !!choices && !choices.includes(draft.effort);
      const names = form.models ?? [], id = `${site}-${mode}`;
      return <fieldset key={mode} data-preset-mode={mode} disabled={blocked} aria-describedby="tier-presets-hint">
        <legend>{mode === 'fast' ? copy.presetFast : copy.presetThink}</legend>
        <p className="settings-control-hint" data-preset-saved={mode}>{formatCopy(copy.presetSavedLabel, { choice: saved ? presetLabel(form.catalogs.get(saved.model)?.secondary === 'toggle' && saved.effort ? { ...saved, effort: effortLabel(saved.effort) } : saved) : copy.presetRecommended })}</p>
        <div className="tier-preset-fields" data-single={modeOnly}>
          <label htmlFor={`${id}-model`}>{primary}<select id={`${id}-model`} className="settings-control" value={draft?.model ?? ''}
            disabled={!form.models} onChange={event => form.chooseModel(mode, event.target.value)}>
            <option value="">{copy.presetChooseChoice}</option>
            {draft && !names.includes(draft.model) ? <option value={draft.model}>{draft.model}</option> : null}
            {names.map(model => <option key={model} value={model}>{model}</option>)}
          </select></label>
          {!modeOnly ? <label htmlFor={`${id}-effort`}>{secondary}<select id={`${id}-effort`} className="settings-control" value={draft?.effort ?? ''}
            disabled={!draft || !choices?.length || missingModel} onChange={event => form.chooseEffort(mode, event.target.value)}>
            <option value="">{draft && choices?.length === 0 ? copy.presetNoEffort : copy.presetChooseChoice}</option>
            {draft?.effort && !choices?.includes(draft.effort) ? <option value={draft.effort}>{effortLabel(draft.effort)}</option> : null}
            {choices?.map(effort => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}
          </select></label> : null}
        </div>
        {missingModel || missingEffort ? <p className="settings-control-hint">{copy.presetChoiceUnavailable}</p> : null}
        <div className="settings-actions">
          <button type="button" className="settings-control" data-preset-action="save" disabled={!form.available(draft)} onClick={() => void form.save(mode)}>{copy.presetSave}</button>
          <button type="button" className="settings-control" data-preset-action="current" onClick={() => void form.useCurrent(mode)}>{copy.presetCurrent}</button>
          <button type="button" className="settings-control" data-preset-action="reset" disabled={!saved} onClick={() => void form.save(mode, true)}>{copy.presetReset}</button>
          {!sameDraft(draft, saved) ? <button type="button" className="settings-control" onClick={() => form.cancel(mode)}>{copy.presetCancel}</button> : null}
        </div>
      </fieldset>;
    })}
    <p id="tier-presets-status" className="settings-control-hint" role={props.onFeedback ? undefined : 'status'}>{form.pending ? copy.presetWorking : form.notice}</p>
    {leaveOpen && dirty ? createPortal(<ConfirmDialog copy={copy} title={copy.presetLeaveTitle} message={copy.presetLeaveMessage}
      cancelLabel={copy.presetKeepEditing} confirmLabel={copy.presetDiscard}
      onCancel={() => { navigation.current = null; setLeaveOpen(false); }} onConfirm={() => {
        const action = navigation.current; navigation.current = null; setLeaveOpen(false); form.cancel(); action?.();
      }} />, document.body) : null}
  </section>;
}
