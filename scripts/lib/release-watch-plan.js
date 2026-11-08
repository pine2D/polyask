"use strict";
// 信号分类与周报增量计划；纯函数，不访问网络，不改适配器。
const feed = require("./release-feed.js");
const MAX_WEEKLY_ENTRIES = 100;
const MAX_WEEKLY_BODY = 50000; // 对 GitHub 正文上限留 ≥20% 余量；超量报错，不丢已有条目。
const CUSTOMER = /\b(customer stor(?:y|ies)|case stud(?:y|ies)|how .+ (?:uses?|builds?|serves?|scales?)|cuts? .+ time)\b/i;
const LAUNCH = /\b(?:introducing|announcing|launching|released?)\b.*\b(?:gpt[-\s]?\d[\w.-]*|o\d+|gemini|model)\b|\bour next frontier model\b|\bnew model\b|\bmodel release\b|\bnow available in chatgpt\b|\brolling out.*model\b/i;
function classify(src, entry) {
  if (src.kind === "snapshot" || src.surface === "web") return { kind: "web", reason: "消费端更新或 UI 状态快照；仍须真机确认" };
  if (src.surface === "api" || /\bAPI\b|\bSDK\b|developer (?:platform|console)/i.test(entry.title))
    return { kind: "api", reason: "API/开发者侧变化，不证明网页选择器变化" };
  if (CUSTOMER.test(entry.title)) return { kind: "low", reason: "客户案例或成效叙述，型号出现不构成发布证据" };
  if (LAUNCH.test(entry.title)) return { kind: "model", reason: "命中明确模型发布措辞，网页可用性仍待确认" };
  return { kind: "low", reason: "未命中明确发布措辞，可能是营销、案例或回顾" };
}
function aliases(src, entry) {
  const base = feed.issueTitle({ ...src, highSignal: undefined }, entry);
  const prefix = `[release-watch] ${src.key}`;
  return [...new Set([base, feed.legacyIssueTitle(src, entry),
    ...["low", "api", "web", "model"].map((kind) => base.replace(prefix, `${prefix}/${kind}`))])];
}
function metadata(body) {
  const out = [];
  const markerCount = (body.match(/<!-- release-watch-entry:/g) || []).length;
  for (const m of body.matchAll(/<!-- release-watch-entry: (.*?) -->/g)) {
    const item = JSON.parse(m[1]);
    if (!Array.isArray(item) || !item.length || item.some((title) => typeof title !== "string")) throw new Error("周报去重元数据损坏");
    out.push(item);
  }
  if (out.length !== markerCount) throw new Error("周报去重元数据损坏");
  return out;
}
function seenTitles(issues) {
  const seen = new Set();
  for (const issue of issues) {
    seen.add(issue.title);
    for (const item of metadata(issue.body || "")) for (const title of item) seen.add(title);
  }
  return seen;
}
function entryTime(entry, now) {
  const raw = entry.publishedAt || entry.date || entry.title.match(/^(?:Date:\s*)?(20\d\d-\d{1,2}-\d{1,2})\b/)?.[1];
  const numeric = raw?.match(/^(?:Date:\s*)?(20\d\d)[.\-/](\d{1,2})[.\-/](\d{1,2})$/i);
  const english = raw?.match(/^([a-z]+)\s+(\d{1,2}),\s*(20\d\d)$/i);
  const month = english ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(english[1].slice(0, 3).toLowerCase()) : -1;
  const timestamp = entry.publishedAt ? Date.parse(entry.publishedAt)
    : numeric ? Date.UTC(+numeric[1], +numeric[2] - 1, +numeric[3])
    : english && month >= 0 ? Date.UTC(+english[3], month, +english[2]) : NaN;
  const published = Number.isFinite(timestamp);
  const date = published ? new Date(timestamp) : now;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return { week: monday.toISOString().slice(0, 10), label: `${published ? "发布" : "观察"}：${date.toISOString()}${published ? "" : "（发布日期未知）"}` };
}
function planUpdates(src, entries, issues, now, warn = console.warn) {
  const seen = seenTitles(issues);
  // freshEntries 仍使用位置法与首轮单条基线；把所有历史分级别名映射到它的当前标题。
  for (const entry of entries) if (aliases(src, entry).some((title) => seen.has(title))) seen.add(feed.issueTitle(src, entry));
  const picked = feed.freshEntries(src, entries, seen, warn);
  const updates = [];
  for (const entry of picked) {
    const signal = classify(src, entry);
    const titles = aliases(src, entry);
    const marker = `<!-- release-watch-entry: ${JSON.stringify(titles).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")} -->`;
    const time = entryTime(entry, now);
    if (signal.kind === "web" || signal.kind === "model") {
      const base = titles[0], title = base.replace(`[release-watch] ${src.key}:`, `[release-watch] ${src.key}/${signal.kind}:`);
      updates.push({ title, body: `分级：${signal.kind}（${signal.kind === "model" ? "模型公告" : "网页变化"}）— ${signal.reason}\n${time.label}\n\n${feed.issueBody({ ...src, highSignal: undefined }, entry)}\n\n${marker}` });
      continue;
    }
    const title = `[release-watch] ${src.key}/weekly: ${time.week}`;
    let update = updates.find((item) => item.title === title);
    if (!update) {
      const matches = issues.filter((issue) => issue.title === title);
      if (matches.length > 1) throw new Error(`周报标题重复：${title}`);
      const existing = matches[0];
      update = { ...(existing ? { number: existing.number } : {}), title,
        body: existing?.body || `情报源：${src.name} — ${src.url}\n自然周：${time.week} 起（UTC 周一）。API 与低信号聚合；不证明网页 UI 已变。\n` };
      updates.push(update);
    }
    // 原文和人工补充保持不动，仅追加；身份元数据独立于展示文案与周号。
    update.body += `\n- [${signal.kind}] ${entry.title}\n  来源：${entry.url || src.url}\n  ${time.label}\n  分级依据：${signal.reason}\n${marker}\n`;
    if (metadata(update.body).length > MAX_WEEKLY_ENTRIES || update.body.length > MAX_WEEKLY_BODY)
      throw new Error(`周报超过上限（${MAX_WEEKLY_ENTRIES} 条 / ${MAX_WEEKLY_BODY} 字符），请人工整理，未写入`);
  }
  return updates;
}
module.exports = { classify, planUpdates, seenTitles, MAX_WEEKLY_ENTRIES, MAX_WEEKLY_BODY };
