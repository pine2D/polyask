import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { DraftRevision } from "../src/renderer/prompt-draft";
import { readSource } from "./fixtures";

for (const edited of [false, true]) test(`successful send ${edited ? "preserves the next" : "clears the unchanged"} draft`, async () => {
  const source = readSource("src/renderer/index.tsx");
  const body = source.slice(source.indexOf("  const submit ="), source.indexOf("  const setMode ="));
  const revision = new DraftRevision();
  let draft = "A";
  let finish!: (value: unknown) => void;
  const response = new Promise((resolve) => { finish = resolve; });
  const task = vm.runInNewContext(ts.transpileModule(`${body}\nsubmit();`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, {
    text: "A", draftRevision: revision, selected:new Set(["claude"]), runState:"idle",
    actionLock:{current:{run:(action:()=>Promise<void>)=>action()}}, imageWarning:null,
    imageSelection:{invalidateAndClose(){}}, workspace:{tier:null}, images:[],
    broadcast:{send:()=>response}, clearSent:(sent:number)=>{if(revision.isCurrent(sent))draft="";}
  });
  if (edited) { draft = "B"; revision.edit(); }
  finish({results:new Map([["claude",{ok:true}]])}); await task;
  assert.equal(draft, edited ? "B" : "");
});
