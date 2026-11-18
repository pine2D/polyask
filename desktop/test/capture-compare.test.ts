import assert from "node:assert/strict";
import test from "node:test";
import { archiveCollectionActions } from "../src/renderer/archive-collection-actions";
import { getCopy } from "../src/shared/copy";
import { archiveFixture } from "./fixtures";

test("capture-and-compare opens the newly saved record, or keeps the current view on failure", async () => {
  const record = { ...archiveFixture(), id: "new",
    results: [{host: "claude.ai", label: "Claude", text: "A"}, {host: "www.kimi.com", label: "Kimi", text: "B"}] };
  const copy = getCopy("en");
  for (const outcome of ["complete", "missing-text", "failure"]) {
    const events: string[] = [];
    const actions = archiveCollectionActions({ copy,
      runAuxiliary: task => task(),
      capture: {capture: async () => {
        if (outcome === "failure") throw new Error("no answer");
        return outcome === "complete" ? record : { ...record, results: record.results.slice(0, 1) };
      }},
      synthesis: { collect: async () => record.id },
      openArchive: id => { events.push(id ?? "", "archive"); },
      announce: value => { events.push(value); }
    });
    await actions.collectAndCompare();
    if (outcome === "failure") assert.deepEqual(events, [copy.archiveCollectFailed]);
    else assert.deepEqual(events, ["new", "archive", outcome === "complete" ? copy.archiveSaved : copy.captureNeedsTwoAnswers]);
  }
});
