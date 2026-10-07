import { useEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import type { DecisionInput } from '../shared/decision';
import type { Tier } from '../shared/protocol';
import type { ExactExcerpt } from './answer-excerpt';
import { excerptDecisionDraft, runExcerptNavigation } from './answer-excerpt-navigation';
import type { SynthesisDraft, SynthesisDraftStore } from './synthesis-draft';
import { requestDecisionNavigation } from './decision-navigation';
import { ExcerptReplacementDialog } from './excerpt-replacement-dialog';
import { shell } from './shell-api';

export function useExcerptActions(props: {
  readonly copy: DesktopCopy;
  readonly busy: boolean;
  readonly defaultTier: Tier;
  readonly drafts?: SynthesisDraftStore;
  readonly onStatus: (value: string) => void;
  readonly onDecision: (record: ArchiveRecord, draft: DecisionInput) => void;
  readonly onFollowUp: (record: ArchiveRecord, value: ExactExcerpt, draft: SynthesisDraft & { sourceChanged: boolean }) => void;
}) {
  const mounted = useRef(false), epoch = useRef(0), busy = useRef(props.busy);
  busy.current = props.busy;
  const [confirmation, setConfirmation] = useState<{ previous: string; selected: ExactExcerpt; confirm: () => void } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const start = (value: ExactExcerpt, apply: (record: ArchiveRecord, current: ExactExcerpt, active: () => boolean) => void) => {
    if (busy.current) return;
    const request = ++epoch.current;
    const active = () => mounted.current && request === epoch.current && !busy.current;
    const verify = () => {
      void runExcerptNavigation(value, { readSource: id => shell.getArchive(id), active,
        apply: (record, current) => {
          // 等待来源期间可能出现新稿；确认等待后再读来源，最后不跨 await 导航。
          let guardReturned = false;
          requestDecisionNavigation(() => {
            if (!active()) return;
            if (guardReturned) verify();
            else apply(record, current, active);
          });
          guardReturned = true;
        },
        onUnavailable: kind => props.onStatus(kind === 'changed' ? props.copy.synthesisSourceVersionChanged
          : kind === 'missing' ? props.copy.excerptSourceMissing : kind === 'invalid' ? props.copy.excerptSourceInvalid : props.copy.archiveLoadFailed) });
    };
    requestDecisionNavigation(() => {
      if (!active()) return;
      verify();
    });
  };
  const evidence = (value: ExactExcerpt) => {
    if ([...value.excerpt].length > 4000) { props.onStatus(props.copy.excerptEvidenceLimit); return; }
    start(value, (record, current) => props.onDecision(record, excerptDecisionDraft(record, current)));
  };
  const followUp = (value: ExactExcerpt) => start(value, (record, current, active) => {
    const previous = props.drafts?.restore(record, current.host);
    const apply = (source: ArchiveRecord, excerpt: ExactExcerpt) => {
      const restored = props.drafts?.restore(source, excerpt.host);
      props.onFollowUp(source, excerpt, { selectedHosts: [excerpt.host], targetSite: restored?.targetSite ?? '',
        tier: restored ? restored.tier : props.defaultTier, instruction: restored?.instruction ?? '',
        excerpt: excerpt.excerpt, sourceChanged: false });
    };
    if (previous?.excerpt && previous.excerpt !== current.excerpt) {
      setConfirmation({ previous: previous.excerpt, selected: current, confirm: () => { if (active()) start(current, apply); } });
    } else apply(record, current);
  });
  const dialog = confirmation ? <ExcerptReplacementDialog copy={props.copy} busy={props.busy} message={props.copy.excerptReplaceMessage}
    previous={confirmation.previous} selected={confirmation.selected}
    onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation.confirm; setConfirmation(null); action(); }} /> : null;
  return { evidence, followUp, dialog };
}
