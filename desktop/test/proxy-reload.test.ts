import assert from "node:assert/strict";
import test from "node:test";

import { reloadAllSites } from "../src/main/proxy-reload";
import { SITE_KEYS, type SiteKey } from "../src/shared/contracts";

function manager(log: string[], refuse: (site: SiteKey) => boolean | "throw" = () => false) {
  return {
    reload(site: SiteKey, ignoreCache?: boolean): boolean {
      log.push(`reload:${site}:${ignoreCache === true}`);
      const verdict = refuse(site);
      if (verdict === "throw") throw new Error("view_destroyed");
      return !verdict;
    }
  };
}

test("closes pooled site connections before reloading every site and lists the refusals", async () => {
  const log: string[] = [];
  const siteSession = {
    async closeAllConnections() {
      await new Promise<void>((resolve) => setImmediate(resolve));
      log.push("close");
    }
  };
  const result = await reloadAllSites(manager(log, (site) => site === "claude" || site === "kimi"), siteSession, SITE_KEYS);
  assert.deepEqual(log, ["close", ...SITE_KEYS.map((site) => `reload:${site}:false`)]);
  assert.deepEqual(result.skipped, ["claude", "kimi"]);
});

test("a reload that throws counts as skipped and the remaining sites still reload", async () => {
  const log: string[] = [];
  const result = await reloadAllSites(manager(log, (site) => site === "gemini" ? "throw" : false), { closeAllConnections: async () => undefined }, SITE_KEYS);
  assert.deepEqual(result.skipped, ["gemini"]);
  assert.equal(log.length, SITE_KEYS.length);
});

test("a closeAllConnections failure propagates before any reload", async () => {
  const log: string[] = [];
  await assert.rejects(
    reloadAllSites(manager(log), { closeAllConnections: async () => { throw new Error("close_failed"); } }, SITE_KEYS),
    /close_failed/
  );
  assert.equal(log.length, 0);
});

test("only the selected sites are reloaded; unselected sites have no view and are never listed as skipped", async () => {
  const log: string[] = [];
  const result = await reloadAllSites(manager(log, (site) => site === "kimi"), { closeAllConnections: async () => undefined }, ["claude", "kimi"]);
  assert.deepEqual(log, ["reload:claude:false", "reload:kimi:false"]);
  assert.deepEqual(result.skipped, ["kimi"]);
});

test("a closeAllConnections that never settles is bounded and propagates", async () => {
  const log: string[] = [];
  await assert.rejects(
    reloadAllSites(manager(log), { closeAllConnections: () => new Promise<void>(() => undefined) }, SITE_KEYS, 20),
    /timed_out/
  );
  assert.equal(log.length, 0);
});
