import React from "react";
import { createRoot } from "react-dom/client";
import { DecisionWorkspace } from "../../src/renderer/decision-workspace";
import { setShellApi } from "../../src/renderer/shell-api";
import { getCopy } from "../../src/shared/copy";
import { createArchiveRecord } from "../../src/shared/archive";
import type { DecisionInput, DecisionRecord } from "../../src/shared/decision";
import "../../src/renderer/styles.css";

const locale = new URLSearchParams(location.search).get("locale") || "en";
const copy = getCopy(locale);
const source = createArchiveRecord({ text: "Synthetic decision", task: "Synthetic decision", createdAt: 100,
  results: [{ host: "example.test", label: "Answer A", text: "Exact source excerpt. More context." }] },
{ id: "synthetic-source", now: 100, deviceId: "fixture" });
let attempts = 0;
setShellApi({
  getArchive: async () => source,
  createDecision: async (value: DecisionInput): Promise<DecisionRecord> => {
    if (++attempts === 1) throw new Error("synthetic_save_failure");
    return { ...value, id: "synthetic-card", sourceTitle: source.task, schema: 2, createdAt: 100, updatedAt: 100,
      deviceId: "fixture", evidence: value.evidence.map(item => ({ ...item, host: "example.test", label: "Answer A", capturedAt: 100 })) };
  }
} as any);
document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(<section className="folder-workspace library" data-focused="true">
  <div className="folder-columns"><div className="folder-detail"><DecisionWorkspace copy={copy} locale={locale} embedded
    initialSource={source} onArchives={() => {}} onClose={() => {}} /></div></div>
</section>);

const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const field = (name: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="decision-${name}"]`)!;
const click = async (selector: string) => { const node = document.querySelector<HTMLElement>(selector); check(node, `missing ${selector}`); node.click(); await pause(); };
const enter = async (name: string, value: string) => {
  const node = field(name); check(node, `missing field ${name}`);
  const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true })); await pause();
};
const description = (node: HTMLElement) => node.getAttribute("aria-describedby")!.split(" ").map(id => document.getElementById(id)!.textContent).join(" ");

async function run() {
  while (!document.querySelector(".decision-source button")) await pause();
  await enter("title", ""); await enter("rationale", "Keep this carefully written rationale 😀");
  await click('[role="combobox"]');
  await click('[role="option"]:last-child');
  await click(".library-primary");
  check(document.activeElement === field("title"), "first invalid save must focus the title");
  check(field("title").getAttribute("aria-invalid") === "true", "required title exposes its error");
  check(description(field("title")).includes(copy.decisionTitleRequired), "title error is linked to the input");
  check(field("conclusion").getAttribute("aria-invalid") === "true", "empty final conclusion exposes its error");
  await enter("title", "Reviewed decision 😀");
  check(field("title").getAttribute("aria-invalid") !== "true", "title error clears during correction");
  check(document.activeElement === field("title"), "correction must not move typing focus");
  await click(".library-primary");
  check(document.activeElement === field("conclusion"), "saving again focuses the remaining required conclusion");
  await enter("conclusion", "Use the reviewed choice.");
  document.querySelector<HTMLDetailsElement>(".decision-answer")!.open = true;
  await click(".decision-answer button");
  await enter("evidence-0", "invented");
  await click(".library-primary");
  check(document.activeElement === field("evidence-0"), "invalid excerpt receives focus");
  check(description(field("evidence-0")).includes(copy.decisionExcerptMismatch), "exact-match error is linked to its excerpt");
  await enter("evidence-0", "Exact source excerpt.");
  check(field("evidence-0").getAttribute("aria-invalid") !== "true", "excerpt error clears during correction");
  await click(".library-primary");
  check(document.querySelector(".archive-status")?.textContent === copy.decisionFailed, "save rejection reports retained edits");
  check(field("title").value === "Reviewed decision 😀" && field("conclusion").value === "Use the reviewed choice.", "save rejection retains main fields");
  check(field("rationale").value === "Keep this carefully written rationale 😀" && field("evidence-0").value === "Exact source excerpt.", "save rejection retains rationale and excerpt");
  const titleDescription = description(field("title"));
  check(titleDescription.includes("19 / 160"), `emoji contributes one codepoint to the visible count: ${JSON.stringify(titleDescription)}`);
  check(!document.querySelector('[aria-invalid="true"]'), "corrected draft has no field errors");
  const article = document.querySelector<HTMLElement>(".decision-editor")!;
  check(article.scrollWidth <= article.clientWidth + 1, "field counts and errors fit the available width");
  await click(".library-primary");
  check(document.querySelector(".archive-status")?.textContent === copy.decisionSaved, "corrected retained draft can be saved");
  check(document.querySelector('.decision-editor[data-editing="false"]'), "successful retry exits editing");
}
(window as any).decisionResult = run().then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
