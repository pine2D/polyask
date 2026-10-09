import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { DraftRevision } from "../src/renderer/prompt-draft";
import type { StoredDraft } from "../src/shared/drafts";
import type { SiteRunResult } from "../src/shared/protocol";
import { readSource } from "./fixtures";

const outcomes: { name: string; results: SiteRunResult[] | null; sent: boolean }[] = [
  { name: "success", results: [{ site: "claude", ok: true }], sent: true },
  { name: "partial success", results: [{ site: "claude", ok: true }, { site: "chatgpt", ok: false, code: "not_ready" }], sent: true },
  { name: "tier warning after submission", results: [{ site: "claude", ok: true, code: "tier_unconfirmed" }], sent: true },
  { name: "all failed", results: [{ site: "claude", ok: false, code: "inject_failed" }], sent: false },
  { name: "cancelled", results: [{ site: "claude", ok: false, code: "cancelled" }], sent: false },
  { name: "submission unconfirmed", results: [{ site: "claude", ok: false, code: "submit_unconfirmed" }], sent: false },
  { name: "missing response", results: [], sent: false },
  { name: "no completed run", results: null, sent: false }
];

for (const outcome of outcomes) for (const nextDraft of [null, "B", "A"]) test(`${outcome.name} ${nextDraft === null ? "only clears and collapses a sent draft" : `preserves revised draft ${nextDraft} and editing`}`, async () => {
  const source = readSource("src/renderer/index.tsx");
  const body = source.slice(source.indexOf("  const submit ="), source.indexOf("  const setMode ="));
  const revision = new DraftRevision();
  let draft = "A";
  let expanded = true;
  const sites = outcome.name === "partial success" ? ["claude", "chatgpt"] : ["claude"];
  let finish!: (value: unknown) => void;
  const response = new Promise((resolve) => { finish = resolve; });
  const receipt = new Promise<StoredDraft | null>(() => {});
  let flushes = 0, broadcasts = 0, clears = 0;
  const task = vm.runInNewContext(ts.transpileModule(`${body}\nsubmit();`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, {
    text: "A", draftRevision: revision, runState:"idle",
    participation:{currentSites:()=>sites,pending:false},
    actionLock:{current:{run:(action:()=>Promise<void>)=>action()}}, imageWarning:null,
    imageSelection:{invalidateAndClose(){}}, workspace:{tier:null}, images:[],
    flushDraft:()=>{flushes++;return receipt;},
    broadcast:{send:(input:{sites:string[]})=>{broadcasts++;assert.deepEqual([...input.sites],sites);return response;}},
    clearSent:(sent:number,saved:Promise<StoredDraft|null>)=>{clears++;assert.equal(saved,receipt);if(revision.isCurrent(sent))draft="";},
    composer:{reset:()=>{expanded=false;}}
  });
  assert.equal(flushes, 1);
  assert.equal(broadcasts, 1, "a pending draft receipt cannot block broadcast dispatch");
  assert.equal(expanded, true, "pending sends keep editing open");
  if (nextDraft !== null) { draft = nextDraft; revision.edit(); }
  finish(outcome.results === null ? null : {results:new Map(outcome.results.map(result=>[result.site,result]))}); await task;
  assert.equal(draft, nextDraft ?? (outcome.sent ? "" : "A"));
  assert.equal(expanded, nextDraft !== null || !outcome.sent);
  assert.equal(clears, outcome.sent ? 1 : 0, "only a successful submission starts cleanup of its captured receipt");
});
