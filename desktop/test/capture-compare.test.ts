import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readSource } from "./fixtures";

test("capture-and-compare opens the newly saved record, or keeps the current view on failure", async () => {
  const source = readSource("src/renderer/index.tsx");
  const body = source.slice(source.indexOf("  const collectAndCompare ="), source.indexOf("  const startNewSession ="));
  for (const succeeds of [true, false]) {
    const events: string[] = [];
    await vm.runInNewContext(ts.transpileModule(`${body}\ncollectAndCompare();`, { compilerOptions: {target:ts.ScriptTarget.ES2022} }).outputText, {
      runAuxiliary: (task: () => Promise<void>) => task(),
      archiveCapture: {capture: async () => { if (!succeeds) throw new Error("no answer"); return {id:"new",results:[{text:"A"},{text:"B"}]}; }},
      setComparisonId: (id: string) => events.push(id), changeSurface: (value: string) => events.push(value),
      copy: {archiveSaved:"saved",archiveCollectFailed:"failed"}, setAnnouncement: (value: string) => events.push(value)
    });
    assert.deepEqual(events, succeeds ? ["new","archive","saved"] : ["failed"]);
  }
});
