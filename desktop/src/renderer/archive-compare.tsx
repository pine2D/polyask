import { useEffect, useMemo, useState } from "react";

import type { ArchiveResult } from "../shared/archive";
import { compareAnswerParagraphs, comparisonParagraphs, type ComparedParagraph } from "../shared/archive-compare";
import { LibrarySelect } from "./library-select";
import { MarkdownPreview } from "./markdown-preview";
import type { DesktopCopy } from "../shared/copy";

interface ArchiveCompareProps {
  readonly onOpenLink?: (url: string) => void;
  readonly copy: DesktopCopy;
  readonly results: readonly ArchiveResult[];
}

function ComparisonColumn(props: {
  readonly onOpenLink?: (url: string) => void;
  readonly copy: DesktopCopy;
  readonly label: string;
  readonly code?: string;
  readonly paragraphs: readonly ComparedParagraph[];
}): React.JSX.Element {
  return (
    <article className="archive-compare-column">
      <h3>{props.label}</h3>
      {props.code === "answer_truncated" ? <p className="answer-capture-warning">{props.copy.answerTruncated}</p> : null}
      {!props.paragraphs.length ? <p role="status">{props.copy.noDifferentParagraphs}</p> : null}
      {props.paragraphs.map((paragraph, index) => (
        <div className={`archive-compare-paragraph ${paragraph.relation}`} data-relation={paragraph.relation} key={`${index}:${paragraph.text}`}>
          {props.paragraphs[index - 1]?.relation !== paragraph.relation ? <span>{paragraph.relation === "shared" ? props.copy.sharedParagraph : props.copy.uniqueParagraph}</span> : null}
          <MarkdownPreview value={paragraph.text} onOpenLink={props.onOpenLink} />
        </div>
      ))}
    </article>
  );
}

export function ArchiveCompare(props: ArchiveCompareProps): React.JSX.Element {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const results = props.results.filter((result) => !!result.text?.trim());
  const resultKey = results.map((result) => result.host).join("\n");
  const [leftHost, setLeftHost] = useState(results[0]?.host ?? "");
  const [rightHost, setRightHost] = useState(results[1]?.host ?? "");
  useEffect(() => {
    setLeftHost(results[0]?.host ?? "");
    setRightHost(results[1]?.host ?? "");
  }, [resultKey]);
  const left = results.find((result) => result.host === leftHost) ?? results[0];
  const right = results.find((result) => result.host === rightHost) ?? results[1];
  const comparison = useMemo(
    () => compareAnswerParagraphs(left?.text ?? "", right?.text ?? ""),
    [left?.text, right?.text]
  );

  return (
    <section className="archive-compare" aria-labelledby="archive-compare-title">
      <header>
        <h2 id="archive-compare-title">{props.copy.answerComparison}</h2>
        <p>{props.copy.answerComparisonDescription}</p>
      </header>
      <label className="comparison-filter"><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} />{props.copy.onlyDifferences}</label>
      <div className="archive-compare-grid">
        <section className="archive-compare-side">
          <label className="archive-compare-picker">{props.copy.leftAnswer}
            <LibrarySelect label={props.copy.leftAnswer} value={left?.host ?? ''} options={results.map(result => ({ value: result.host, label: result.label, disabled: result.host === right?.host }))} onChange={setLeftHost} />
          </label>
          <ComparisonColumn onOpenLink={props.onOpenLink} copy={props.copy} label={left?.label ?? ''} code={left?.code} paragraphs={comparisonParagraphs(comparison.left, differencesOnly)} />
        </section>
        <section className="archive-compare-side">
          <label className="archive-compare-picker">{props.copy.rightAnswer}
            <LibrarySelect label={props.copy.rightAnswer} value={right?.host ?? ''} options={results.map(result => ({ value: result.host, label: result.label, disabled: result.host === left?.host }))} onChange={setRightHost} />
          </label>
          <ComparisonColumn onOpenLink={props.onOpenLink} copy={props.copy} label={right?.label ?? ''} code={right?.code} paragraphs={comparisonParagraphs(comparison.right, differencesOnly)} />
        </section>
      </div>
    </section>
  );
}
