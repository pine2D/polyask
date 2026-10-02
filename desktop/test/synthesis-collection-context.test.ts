import assert from "node:assert/strict";
import test from "node:test";
import { ArchiveService } from "../src/main/archive-service";
import { DesktopDatabase } from "../src/main/database";
import { SITES } from "../src/main/sites";
import { SynthesisService } from "../src/main/synthesis-service";
import type { CollectedAnswer } from "../src/shared/protocol";

for (const invalidation of ["new-send", "reset"] as const) {
  test(`late synthesis collection cannot survive ${invalidation}`, async () => {
    const database = DesktopDatabase.open(":memory:");
    let id = 0;
    const archives = new ArchiveService(database.archives, { deviceId: () => "fixture", createId: () => `archive-${++id}` });
    const a = archives.add({ text: "Task A", task: "Task A", results: [{ host: "claude.ai", label: "Claude", text: "A1" }, { host: "chatgpt.com", label: "ChatGPT", text: "A2" }] });
    const b = archives.add({ text: "Task B", task: "Task B", results: [{ host: "claude.ai", label: "Claude", text: "B1" }, { host: "chatgpt.com", label: "ChatGPT", text: "B2" }] });
    let finish!: (answers: CollectedAnswer[]) => void;
    const service = new SynthesisService({ sites: SITES, archives, navigate: async () => {},
      send: async () => [{ site: "claude", ok: true }], collect: () => new Promise(resolve => { finish = resolve; }),
      showTarget: () => {}, recordHistory: () => {} });
    const request = { targetSite: "claude" as const, tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "Compare" };
    try {
      await service.send({ ...request, archiveId: a.id });
      const collection = service.collect();
      if (invalidation === "new-send") await service.send({ ...request, archiveId: b.id });
      else service.reset();
      finish([{ site: "claude", host: "claude.ai", label: "Claude", text: "ANSWER FOR A" }]);
      await assert.rejects(collection, /synthesis_not_pending/);
      await assert.rejects(service.save(false), /synthesis_not_collected/);
      assert.equal(archives.get(a.id)?.synthesis, null);
      assert.equal(archives.get(b.id)?.synthesis, null);
      if (invalidation === "new-send") {
        const current = service.collect();
        finish([{ site: "claude", host: "claude.ai", label: "Claude", text: "ANSWER FOR B" }]);
        await current;
        assert.equal((await service.save(false)).synthesis?.text, "ANSWER FOR B");
      }
    } finally { database.close(); }
  });
}
