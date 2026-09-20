import { useMemo, useState } from "react";

import type { ArchiveRecord } from "../shared/archive";
import type { SiteDefinition } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import { answerSourceId } from "../shared/answer-source";
import {
  buildSynthesisPrompt,
  selectedSynthesisAnswers,
  SYNTHESIS_PROMPT_LIMIT,
  type SynthesisSendRequest
} from "../shared/synthesis";
import { LibrarySelect } from "./library-select";
import { CloseIcon, SendIcon, SparklesIcon, StopIcon } from "./icons";

interface SynthesisWorkspaceProps {
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly sites: readonly SiteDefinition[];
  readonly defaultTier: Tier;
  readonly followUpHost?: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSend: (request: SynthesisSendRequest) => void;
}

export function SynthesisWorkspace(props: SynthesisWorkspaceProps): React.JSX.Element {
  const successful = useMemo(() => props.record.results.filter((result) => !!result.text?.trim()), [props.record]);
  const [selectedHosts, setSelectedHosts] = useState(() => props.followUpHost ? [props.followUpHost] : successful.map((result) => result.host));
  const [targetSite, setTargetSite] = useState("");
  const [tier, setTier] = useState<Tier>(props.defaultTier);
  const [instruction, setInstruction] = useState(props.followUpHost ? "" : props.copy.synthesisDefaultInstruction);
  const [excerpt, setExcerpt] = useState("");
  const followUp = props.followUpHost !== undefined;
  const title = followUp ? props.copy.followUpTitle : props.copy.synthesisTitle;
  const selected = selectedSynthesisAnswers(props.record.results, selectedHosts);
  const preview = buildSynthesisPrompt({ record: props.record, selectedHosts, instruction, excerpt: followUp ? excerpt : undefined });
  const tooLong = [...preview].length > SYNTHESIS_PROMPT_LIMIT;
  const source = selected[0];
  const invalidExcerpt = !excerpt.trim() || !instruction.trim() || !source?.text?.includes(excerpt);
  const invalid = (followUp ? selected.length !== 1 || invalidExcerpt : selected.length < 2) || !props.sites.some(site => site.key === targetSite) || tooLong;
  const toggle = (host: string) => setSelectedHosts((current) =>
    current.includes(host) ? current.filter((item) => item !== host) : [...current, host]);

  return (
    <section className="synthesis-workspace" aria-label={title}>
      <header>
        <strong><SparklesIcon />{title}</strong>
        <button type="button" title={props.busy ? props.copy.cancel : props.copy.synthesisCancel} aria-label={props.busy ? props.copy.cancel : props.copy.synthesisCancel} onClick={props.onCancel}>{props.busy ? <StopIcon /> : <CloseIcon />}</button>
      </header>
      <div className="synthesis-config">
        {followUp ? <>
          <p>{source ? `${answerSourceId(props.record.results.indexOf(source))} ${source.label}` : ""}</p>
          <label>{props.copy.followUpOriginal}<textarea name="follow-up-original" readOnly value={source?.text ?? ""} /></label>
          <label>{props.copy.followUpExcerpt}<textarea name="follow-up-excerpt" value={excerpt} onChange={event => setExcerpt(event.target.value)} /></label>
          <p className="citation-notice">{props.copy.followUpHint}</p>
        </> : <fieldset>
          <legend>{props.copy.synthesisAnswers}</legend>
          {successful.map((result) => {
            const state = result.state === "think" ? props.copy.think : result.state === "fast" ? props.copy.fast : props.copy.synthesisUnknownTier;
            const label = `${answerSourceId(props.record.results.indexOf(result))} ${result.label} · ${state}`;
            return <label key={result.host}><input type="checkbox" name="synthesis-answer" value={result.host} checked={selectedHosts.includes(result.host)} onChange={() => toggle(result.host)} /><span title={label}>{label}</span></label>;
          })}
        </fieldset>}
        <small>{props.copy.synthesisCount.replace("{count}", String(selected.length))}</small>
        {selected.filter((result) => result.code === "answer_truncated").map((result) => <p className="answer-capture-warning" key={result.host}>{answerSourceId(props.record.results.indexOf(result))} {props.copy.answerTruncated}</p>)}
        <label>{props.copy.synthesisTarget}<LibrarySelect name="synthesis-target" label={props.copy.synthesisTarget} value={targetSite} disabled={props.busy}
          options={[{ value: '', label: props.copy.synthesisTargetMissing }, ...props.sites.map(site => ({ value: site.key, label: site.label }))]} onChange={setTargetSite} /></label>
        <label>{props.copy.synthesisTier}<LibrarySelect name="synthesis-tier" label={props.copy.synthesisTier} value={tier ?? ''} disabled={props.busy}
          options={[{ value: '', label: props.copy.followSite }, { value: 'fast', label: props.copy.fast }, { value: 'think', label: props.copy.think }]} onChange={value => setTier(value === 'think' || value === 'fast' ? value : null)} /></label>
        <label>{followUp ? props.copy.followUpQuestion : props.copy.synthesisInstruction}<textarea name="synthesis-instruction" autoComplete="off" maxLength={4000} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
        {!followUp ? <button type="button" className="citation-preset" disabled={props.busy} onClick={() => setInstruction(props.copy.citationReportInstruction)}>{props.copy.citationReportPreset}</button> : null}
        <p className="citation-notice">{props.copy.citationReportNotice}</p>
      </div>
      <label className="synthesis-preview">{props.copy.synthesisPreview}<textarea name="synthesis-preview" readOnly value={preview} /></label>
      <footer>
        <span role="status" aria-live="polite">{tooLong ? props.copy.synthesisTooLong : followUp && invalid ? props.copy.followUpInvalid : !followUp && selected.length < 2 ? props.copy.synthesisNotEnough : props.busy ? props.copy.synthesisSending : ""}</span>
        <button type="button" disabled={props.busy || invalid} onClick={() => props.onSend({ archiveId: props.record.id, targetSite: targetSite as SynthesisSendRequest["targetSite"], tier, selectedHosts, instruction, ...(followUp ? { excerpt } : {}) })}><SendIcon />{followUp ? props.copy.followUpSend : props.copy.synthesisSend}</button>
      </footer>
    </section>
  );
}
