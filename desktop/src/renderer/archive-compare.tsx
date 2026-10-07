import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ArchiveRecord, ArchiveResult } from "../shared/archive";
import { compareAnswerParagraphs, comparisonParagraphs, type ComparedParagraph } from "../shared/archive-compare";
import { LibrarySelect } from "./library-select";
import { MarkdownPreview } from "./markdown-preview";
import type { DesktopCopy } from "../shared/copy";
import type { LibraryReadingFocus } from './library-reading-focus';
import { ArchiveAnswerReading } from './archive-answer-reading';
import { excerptSource, type ExactExcerpt, type ExcerptSource } from './answer-excerpt';
import { ManualComparison, useComparisonWorksheet } from './manual-comparison';
import type { ComparisonDraftStore } from './comparison-draft-store';
import type { DecisionInput } from '../shared/decision';
import type { ArchiveReaderBinding } from './archive-reader-session';

interface ArchiveCompareProps {
  readonly reader?: ArchiveReaderBinding;
  readonly onOpenLink?: (url: string) => void;
  readonly copy: DesktopCopy;
  readonly results: readonly ArchiveResult[];
  readonly readingFocus?: LibraryReadingFocus;
  readonly busy?: boolean;
  readonly record?: ArchiveRecord;
  readonly onEvidence?: (value: ExactExcerpt) => void;
  readonly onFollowUp?: (host: string, value?: ExactExcerpt) => void;
  readonly comparisonDrafts?: ComparisonDraftStore;
  readonly onCreateDecisionDraft?: (record: ArchiveRecord, draft: DecisionInput) => void;
}

function ComparisonColumn(props: {
  readonly onOpenLink?: (url: string) => void;
  readonly copy: DesktopCopy;
  readonly label: string;
  readonly host: string;
  readonly text: string;
  readonly code?: string;
  readonly paragraphs: readonly ComparedParagraph[];
  readonly source?: ExcerptSource | null;
  readonly busy?: boolean;
  readonly onEvidence?: (value: ExactExcerpt) => void;
  readonly onFollowUp?: (host: string, value?: ExactExcerpt) => void;
  readonly onCompare?: (value: ExactExcerpt) => void;
  readonly initialScroll?: number;
  readonly onPosition?: (top: number) => void;
}): React.JSX.Element {
  const node = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, { text: string; top: number }>());
  useLayoutEffect(() => {
    const saved = positions.current.get(props.host);
    const top = saved ? saved.text === props.text ? saved.top : 0 : props.initialScroll ?? 0;
    positions.current.set(props.host, { text: props.text, top });
    if (node.current) node.current.scrollTop = top;
    props.onPosition?.(top);
  }, [props.host, props.text]);
  useLayoutEffect(() => {
    if (node.current && props.initialScroll !== undefined) node.current.scrollTop = props.initialScroll;
  }, [props.initialScroll]);
  const content = <>
      {props.code === "answer_truncated" ? <p className="answer-capture-warning">{props.copy.answerTruncated}</p> : null}
      {!props.paragraphs.length ? <p role="status">{props.copy.noDifferentParagraphs}</p> : null}
      {props.paragraphs.map((paragraph, index) => (
        <div className={`archive-compare-paragraph ${paragraph.relation}`} data-relation={paragraph.relation} key={`${index}:${paragraph.text}`}>
          {props.paragraphs[index - 1]?.relation !== paragraph.relation ? <span>{paragraph.relation === "shared" ? props.copy.sharedParagraph : props.copy.uniqueParagraph}</span> : null}
          <MarkdownPreview value={paragraph.text} onOpenLink={props.onOpenLink} />
        </div>
      ))}</>;
  return (
    <article ref={node} className="archive-compare-column" onScroll={event => {
      const top = event.currentTarget.scrollTop;
      positions.current.set(props.host, { text: props.text, top }); props.onPosition?.(top);
    }}>
      <h3>{props.label}</h3>
      {props.source ? <ArchiveAnswerReading copy={props.copy} source={props.source} busy={props.busy} onEvidence={props.onEvidence} onCompare={props.onCompare} onFollowUp={props.onFollowUp ? value => props.onFollowUp?.(props.host, value) : undefined}>{content}</ArchiveAnswerReading> : content}
    </article>
  );
}

export function ArchiveCompare(props: ArchiveCompareProps): React.JSX.Element {
  const worksheet = useComparisonWorksheet(props.record, props.comparisonDrafts);
  const [localDifferences, setLocalDifferences] = useState(false);
  const differencesOnly = props.reader?.state.differencesOnly ?? localDifferences;
  const setDifferencesOnly = (value: boolean) => props.reader ? props.reader.change({ differencesOnly: value }) : setLocalDifferences(value);
  const results = props.results.filter((result) => !!result.text?.trim());
  const resultKey = results.map((result) => result.host).join("\n");
  const [localLeft, setLocalLeft] = useState(results[0]?.host ?? "");
  const [localRight, setLocalRight] = useState(results[1]?.host ?? "");
  const leftHost = props.reader?.state.leftHost ?? localLeft, rightHost = props.reader?.state.rightHost ?? localRight;
  const setLeftHost = (host: string) => props.reader ? props.reader.change({ leftHost: host, leftScroll: 0 }) : setLocalLeft(host);
  const setRightHost = (host: string) => props.reader ? props.reader.change({ rightHost: host, rightScroll: 0 }) : setLocalRight(host);
  useEffect(() => {
    const nextLeft = results.find(result => result.host === leftHost) ?? results.find(result => result.host !== rightHost) ?? results[0];
    const nextRight = results.find(result => result.host === rightHost && result.host !== nextLeft?.host) ?? results.find(result => result.host !== nextLeft?.host);
    if (nextLeft?.host !== leftHost) setLeftHost(nextLeft?.host ?? '');
    if (nextRight?.host !== rightHost) setRightHost(nextRight?.host ?? '');
  }, [resultKey]);
  const focusButton = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef(props.readingFocus?.focused);
  useLayoutEffect(() => {
    if (lastFocused.current !== props.readingFocus?.focused) focusButton.current?.focus({ preventScroll: true });
    lastFocused.current = props.readingFocus?.focused;
  }, [props.readingFocus?.focused]);
  const left = results.find((result) => result.host === leftHost) ?? results[0];
  const right = results.find((result) => result.host === rightHost) ?? results[1];
  const comparison = useMemo(
    () => compareAnswerParagraphs(left?.text ?? "", right?.text ?? ""),
    [left?.text, right?.text]
  );
  const leftSource = props.record ? excerptSource(props.record, props.record.results.findIndex(result => result.host === left?.host)) : null;
  const rightSource = props.record ? excerptSource(props.record, props.record.results.findIndex(result => result.host === right?.host)) : null;

  return (
    <section className="archive-compare" aria-labelledby="archive-compare-title">
      <header>
        <h2 id="archive-compare-title">{props.copy.answerComparison}</h2>
        <p>{props.copy.answerComparisonDescription}</p>
        {props.readingFocus ? <button ref={focusButton} className="comparison-focus" type="button" disabled={props.busy} onClick={() => props.readingFocus!.onFocus(!props.readingFocus!.focused)}>{props.readingFocus.focused ? props.copy.comparisonBrowse : props.copy.comparisonExpand}</button> : null}
      </header>
      <label className="comparison-filter"><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} />{props.copy.onlyDifferences}</label>
      <div className="archive-compare-grid">
        <section className="archive-compare-side">
          <label className="archive-compare-picker">{props.copy.leftAnswer}
            <LibrarySelect label={props.copy.leftAnswer} value={left?.host ?? ''} options={results.map(result => ({ value: result.host, label: result.label, disabled: result.host === right?.host }))} onChange={setLeftHost} />
          </label>
          <ComparisonColumn initialScroll={props.reader?.state.leftScroll} onPosition={top => props.reader?.change({ leftScroll: top })} onOpenLink={props.onOpenLink} copy={props.copy} source={leftSource} busy={props.busy} onEvidence={props.onEvidence} onCompare={worksheet.add} onFollowUp={props.onFollowUp} host={left?.host ?? ''} text={left?.text ?? ''} label={left?.label ?? ''} code={left?.code} paragraphs={comparisonParagraphs(comparison.left, differencesOnly)} />
        </section>
        <section className="archive-compare-side">
          <label className="archive-compare-picker">{props.copy.rightAnswer}
            <LibrarySelect label={props.copy.rightAnswer} value={right?.host ?? ''} options={results.map(result => ({ value: result.host, label: result.label, disabled: result.host === left?.host }))} onChange={setRightHost} />
          </label>
          <ComparisonColumn initialScroll={props.reader?.state.rightScroll} onPosition={top => props.reader?.change({ rightScroll: top })} onOpenLink={props.onOpenLink} copy={props.copy} source={rightSource} busy={props.busy} onEvidence={props.onEvidence} onCompare={worksheet.add} onFollowUp={props.onFollowUp} host={right?.host ?? ''} text={right?.text ?? ''} label={right?.label ?? ''} code={right?.code} paragraphs={comparisonParagraphs(comparison.right, differencesOnly)} />
        </section>
      </div>
      {props.record ? <ManualComparison copy={props.copy} record={props.record} worksheet={worksheet} sources={[leftSource, rightSource].filter((value): value is ExcerptSource => !!value)} busy={props.busy ?? false} onCreate={props.onCreateDecisionDraft} /> : null}
    </section>
  );
}
