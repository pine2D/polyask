"use strict";
// 离线：只替换 HTTP 边界，分类、日期、去重与周报计划均走生产实现。
const assert = require("assert");
const { test } = require("node:test");
const feed = require("./lib/release-feed.js");
test("RSS 保留真实发布日期：不把 pubDate 交给标题 filter", () => {
  const [entry] = feed.parseRss("<rss><item><title>Introducing GPT-6</title><pubDate>Sun, 01 Nov 2026 20:00:00 GMT</pubDate></item></rss>");
  assert.strictEqual(entry.publishedAt, "2026-11-01T20:00:00.000Z");
  assert.strictEqual(entry.date, undefined);
});

const fs = require("fs");
const vm = require("vm");
function loadWatcher(argv = [], env = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync("scripts/watch-releases.js", "utf8"), {
    require, module: mod, process: { env, argv }, console,
    fetch: async () => { throw new Error("offline: network disabled before loading"); },
    AbortController, setTimeout, clearTimeout, Date, structuredClone,
  });
  return mod.exports;
}
const watcher = loadWatcher();
const source = (key) => watcher.SOURCES.find((src) => src.key === key);
const rss = (entries) => `<rss>${entries.map(([title, date]) => `<item><title>${title}</title><link>https://news.test/${encodeURIComponent(title)}</link>${date ? `<pubDate>${date}</pubDate>` : ""}</item>`).join("")}</rss>`;
function harness(src, initial = []) {
  const rows = structuredClone(initial), writes = [], logs = [];
  const github = async (method, path, body) => {
    if (method === "GET") return structuredClone(rows);
    if (path.endsWith("/labels")) return {};
    writes.push({ method, path, body });
    if (method === "POST") { const row = { number: rows.length + 1, ...body }; rows.push(row); return row; }
    const row = rows.find((row) => path.endsWith(`/issues/${row.number}`));
    Object.assign(row, body); return row;
  };
  const run = (entries, options = {}) => watcher.runWatch({ sources: [src], read: async () => rss(entries),
    github, dryRun: false, now: new Date("2026-11-08T12:00:00Z"), log: (line) => logs.push(line), ...options });
  return { rows, writes, logs, run };
}

test("Gemini frontier 模型公告独立开单，OpenAI GPT 客户案例按周聚合", async () => {
  const high = harness(source("gemini-blog"));
  await high.run([["Gemini: our next frontier model"]]);
  assert.strictEqual(high.rows[0].title, "[release-watch] gemini-blog/model: Gemini: our next frontier model");
  assert.match(high.rows[0].body, /模型公告/);
  const low = harness(source("openai"));
  await low.run([["How Acme uses GPT-6 to serve customers"]]);
  assert.strictEqual(low.rows[0].title, "[release-watch] openai/weekly: 2026-11-02");
  assert.match(low.rows[0].body, /low[\s\S]*客户/);
});

test("API 来源与 API 标题进周报，网页 changelog 独立开单", async () => {
  const api = harness({ ...source("openai"), surface: "api" });
  await api.run([["Introducing GPT-6"]]);
  assert.match(api.rows[0].body, /api[\s\S]*API/);
  assert.match(api.rows[0].body, /https:\/\/news.test\//);
  const titled = harness(source("openai"));
  await titled.run([["Introducing GPT-6 in the API"]]);
  assert.match(titled.rows[0].title, /\/weekly:/);
  const web = harness({ key: "web", name: "Web", kind: "rss", filter: /./, surface: "web", url: "https://web.test", adapter: "x" });
  await web.run([["Changed model picker"]]);
  assert.strictEqual(web.rows[0].title, "[release-watch] web/web: Changed model picker");
});

test("同周增量保留已移出feed的旧条目；重复与跨周观察不重复写", async () => {
  const h = harness(source("openai"));
  await h.run([["How Acme uses GPT-6"]]);
  await h.run([["How Bravo uses GPT-6"], ["How Acme uses GPT-6"]]);
  await h.run([["How Charlie uses GPT-6"], ["How Bravo uses GPT-6"]]);
  assert.strictEqual(h.rows.length, 1);
  assert.match(h.rows[0].body, /How Acme/);
  assert.match(h.rows[0].body, /How Bravo/);
  assert.match(h.rows[0].body, /How Charlie/);
  assert.strictEqual(h.writes[1].method, "PATCH");
  const count = h.writes.length;
  await h.run([["How Charlie uses GPT-6"], ["How Bravo uses GPT-6"]], { now: new Date("2026-11-09T12:00:00Z") });
  assert.strictEqual(h.writes.length, count);
  await h.run([["How Delta uses GPT-6"], ["How Charlie uses GPT-6"]], { now: new Date("2026-11-09T12:00:00Z") });
  assert.strictEqual(h.rows[1].title, "[release-watch] openai/weekly: 2026-11-09");
});

test("发布日期归周优先于观察日，缺日期明确标观察，周日与周一分开", async () => {
  const h = harness(source("openai"), [{ number: 10, title: "[release-watch] openai: Introducing GPT-5", body: "" }]);
  await h.run([["How A uses GPT-6", "Mon, 02 Nov 2026 00:00:00 GMT"], ["How B uses GPT-6", "Sun, 01 Nov 2026 23:59:59 GMT"], ["Introducing GPT-5"]]);
  assert.deepStrictEqual(h.rows.slice(1).map((row) => row.title).sort(), ["[release-watch] openai/weekly: 2026-10-26", "[release-watch] openai/weekly: 2026-11-02"]);
  assert.match(h.rows[1].body, /发布.*2026-11-02/);
  const noDate = harness(source("openai"));
  await noDate.run([["How A uses GPT-6"]]);
  assert.match(noDate.rows[0].body, /观察.*2026-11-08/);
  assert.match(noDate.rows[0].body, /发布日期未知/);
});

test("旧标题、旧low和新分类标题全部兼容去重", async () => {
  for (const prefix of ["openai", "openai/low", "openai/model"]) {
    const h = harness(source("openai"), [{ number: 3, title: `[release-watch] ${prefix}: How Acme uses GPT-6`, body: "" }]);
    await h.run([["How Acme uses GPT-6"]]);
    assert.strictEqual(h.writes.length, 0, prefix);
  }
  const h = harness({ ...source("deepseek"), kind: "rss", filter: /./ }, [{ number: 4, title: "[release-watch] deepseek: Date: 2026-11-01", body: "" }]);
  // 纯日期旧标题兼容仍由既有 freshEntries 测试覆盖；此处验 API 分级不会重开原有摘要标题。
  h.rows[0].title = "[release-watch] deepseek: Date: 2026-11-01 — Model update";
  await h.run([["Date: 2026-11-01 — Model update"]]);
  assert.strictEqual(h.writes.length, 0);
});

test("dry-run 对创建与已有周报增量均不写远端", async () => {
  const h = harness(source("openai"));
  await h.run([["How Acme uses GPT-6"]]);
  const before = JSON.stringify(h.rows), count = h.writes.length;
  await h.run([["How Bravo uses GPT-6"], ["How Acme uses GPT-6"]], { dryRun: true, issues: h.rows });
  assert.strictEqual(h.writes.length, count);
  assert.strictEqual(JSON.stringify(h.rows), before);
  assert.ok(h.logs.some((line) => line.includes("would update")));
  const empty = harness(source("openai"));
  await empty.run([["How Acme uses GPT-6"]], { dryRun: true });
  assert.strictEqual(empty.writes.length, 0);
  assert.ok(empty.logs.some((line) => line.includes("would open")));
});

test("空解析、HTTP失败与周报容量异常保持红灯", async () => {
  const h = harness(source("openai"));
  await assert.rejects(h.run([], { read: async () => "<html>changed</html>" }), /解析到 0 条/);
  await assert.rejects(h.run([], { read: async () => { throw new Error("HTTP 503"); } }), /HTTP 503/);
  await h.run([["How Acme uses GPT-6"]]);
  h.rows[0].body += "x".repeat(60000);
  const count = h.writes.length;
  await assert.rejects(h.run([["How Bravo uses GPT-6"], ["How Acme uses GPT-6"]]), /周报.*上限/);
  assert.strictEqual(h.writes.length, count);
});

test("新模型公告正文不会沿用旧 highSignal 的低信号提示", async () => {
  const h = harness(source("gemini-blog"));
  await h.run([["Gemini: our next frontier model"]]);
  assert.doesNotMatch(h.rows[0].body, /低信号条目/);
});

test("API 三源按真实页面解析归周，旧纯日期标题继续拦重复", async () => {
  const fixtures = [
    ["deepseek", "<h2>Date: 2026-11-01</h2><h3>New release</h3>"],
    ["zhipu", '<div data-component-part="update-label">2026-11-01</div><div data-component-part="update-description">New release</div>'],
    ["bailian", "<table><tr><td>Text</td><td>2026-11-01</td><td>Qwen-4</td></tr></table>"],
  ];
  for (const [key, html] of fixtures) {
    const h = harness(source(key));
    await h.run([], { read: async () => html });
    assert.strictEqual(h.rows[0].title, `[release-watch] ${key}/weekly: 2026-10-26`);
    assert.match(h.rows[0].body, /\[api\]/);
  }
  const old = harness(source("deepseek"), [{ number: 1, title: "[release-watch] deepseek: Date: 2026-11-01", body: "" }]);
  await old.run([], { read: async () => fixtures[0][1] });
  assert.strictEqual(old.writes.length, 0);
});

test("损坏周报元数据与重复周标题显式失败，不覆盖原文", async () => {
  const bad = harness(source("openai"), [{ number: 1, title: "[release-watch] openai/weekly: 2026-11-02", body: "<!-- release-watch-entry: broken -->" }]);
  await assert.rejects(bad.run([["How A uses GPT-6"]]), /情报源异常/);
  assert.strictEqual(bad.writes.length, 0);
  const duplicate = harness(source("openai"), [1, 2].map((number) => ({ number, title: "[release-watch] openai/weekly: 2026-11-02", body: "" })));
  await assert.rejects(duplicate.run([["How A uses GPT-6"]]), /周报标题重复/);
});

test("dry-run 可只读既有 issue，正文中注释终止符不损坏下一轮去重", async () => {
  const h = harness(source("openai"));
  await h.run([["How A uses GPT-6 --> odd"]]);
  await h.run([["How B uses GPT-6"], ["How A uses GPT-6 --> odd"]], { dryRun: true });
  assert.strictEqual(h.writes.length, 1);
  assert.ok(h.logs.some((line) => line.includes("would update")));
});

test("历史扫描到上限或 GitHub写入失败时红灯；其余源照常检查", async () => {
  await assert.rejects(watcher.runWatch({ sources: [], dryRun: false, github: async () => Array.from({ length: 100 }, (_, i) => ({ number: i, title: "old", body: "" })) }), /2000 条上限/);
  const h = harness(source("openai"));
  await assert.rejects(h.run([["Introducing GPT-6"]], { github: async (method) => {
    if (method === "GET") return [];
    throw new Error("GitHub HTTP 422");
  } }), /GitHub HTTP 422/);
  const visited = [];
  await assert.rejects(watcher.runWatch({ sources: [source("openai"), source("gemini-blog")], dryRun: true,
    read: async (url) => { visited.push(url); throw new Error("HTTP 503"); } }), /openai:[\s\S]*gemini-blog:/);
  assert.strictEqual(visited.length, 2);
});

test("HTML 日历日期按 UTC 解析，不随运行机器时区跨周", async () => {
  const h = harness(source("zhipu"));
  await h.run([], { read: async () => '<div data-component-part="update-label">2026-11-2</div><div data-component-part="update-description">API update</div>' });
  assert.strictEqual(h.rows[0].title, "[release-watch] zhipu/weekly: 2026-11-02");
  const claude = harness(source("claude"));
  await claude.run([], { read: async () => "<h3>November 2, 2026</h3><p>Changed model picker</p>" });
  assert.match(claude.rows[0].body, /发布：2026-11-02T00:00:00.000Z/);
});


test("命令行 --dry-run 在有模拟凭据时仍禁止写入", async () => {
  const local = loadWatcher(["node", "watch-releases.js", "--dry-run"], { GITHUB_TOKEN: "offline-fixture", GITHUB_REPOSITORY: "fixture/repo" });
  let writes = 0;
  await local.runWatch({ sources: [local.SOURCES[0]], read: async () => rss([["Introducing GPT-6"]]),
    github: async (method) => { if (method !== "GET") writes++; return []; }, log() {} });
  assert.strictEqual(writes, 0);
});
