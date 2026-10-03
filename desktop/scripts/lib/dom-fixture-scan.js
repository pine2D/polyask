"use strict";
// desktop/scripts/lib/dom-fixture-scan.js — DOM fixture 入库扫描（门禁 dom-fixture-scan.test.js 与采集脚本共用）。
// 判据只认形状，不认「看起来没问题」：敏感串规则与属性白名单都来自 dom-fixture-sanitize.js 同一份源码，
// 文本节点只许是 FILLER 占位词序列（末词可被长度档截断成前缀）或问题 token，任何真实文本漏过脱敏都会在这里红；
// 属性按实体解码后的值复核（class 逐 token、其余整值再扫敏感串），meta.path 只许 sanitizeRoute 产出的形状。
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { findSensitive, attrValueOk, FILLER, KEEP_ATTRS, EXPECT_ATTR, DROP_TAGS, EMPTY_TAGS, PROMPT_TOKEN } = require("./dom-fixture-sanitize");
const { desktopSites } = require("./desktop-anchors");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures-dom");
const META_KEYS = new Set(["schema", "host", "path", "promptToken", "source", "capturedAt", "note", "expect", "stats"]);
const EXPECT_KEYS = new Set(["userCount", "userText", "answer", "answerRoot", "locate"]);
const STAT_KEYS = new Set(["elements", "texts", "promptHits", "droppedElements", "droppedAttrs", "truncated", "marked"]);

// 「token」或多行问题的「token-L1\ntoken-L2…」；任何别的大写串都不是合法占位。
function isPromptText(value, token) {
  const lines = value.split("\n");
  if (lines.length === 1) return lines[0] === token;
  return lines.every((line, i) => line === `${token}-L${i + 1}`);
}

const FILLER_WORDS = FILLER.split(" ");
// 占位文本：每个词都在 FILLER 词表里；filler() 按长度档截断，末词允许是某个词表词的前缀（"lore"、"a"）。
function isFillerText(value) {
  const words = value.split(" ");
  return words.every((word, i) => FILLER_WORDS.includes(word)
    || (i === words.length - 1 && /^[a-z]+$/.test(word) && FILLER_WORDS.some((filler) => filler.startsWith(word))));
}

// 路径形状与采集脚本 sanitizeRoute 同口径：每段为空、纯字母短横（≤24）或 id-N；查询串只许 chatglm 的 ?cid=id-N。
function isSanitizedRoute(value) {
  if (typeof value !== "string" || value.length > 120) return false;
  const m = /^(\/[^?#]*)(?:\?cid=id-\d{1,5})?$/.exec(value);
  return !!m && m[1].split("/").every((seg) => !seg || /^[A-Za-z_-]{1,24}$/.test(seg) || /^id-\d{1,5}$/.test(seg));
}

function scanHtml(html, promptToken) {
  const problems = findSensitive(html).map((name) => `sensitive:${name}`);
  const { document, Node, NodeFilter } = new JSDOM("<!doctype html><body></body>").window;
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.COMMENT_NODE) { problems.push("comment"); continue; }
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue.trim();
      if (value && !(/^[a-z]+(?: [a-z]+)*$/.test(value) && isFillerText(value)) && !isPromptText(value, promptToken)) problems.push("text:not_placeholder");
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) { problems.push(`node:${node.nodeType}`); continue; }
    const tag = node.localName;
    if (DROP_TAGS.includes(tag)) problems.push(`element:${tag}`);
    if (EMPTY_TAGS.includes(tag) && node.childNodes.length) problems.push(`element:${tag}:children`);
    if (node.closest("svg") && tag !== "svg") problems.push("element:svg_descendant");
    for (const attr of node.attributes) {
      const known = KEEP_ATTRS.includes(attr.name) || attr.name === "aria-label" || attr.name === EXPECT_ATTR || /^data-[a-z0-9_.:-]+$/.test(attr.name);
      if (!known) problems.push(`attr:${attr.name}`);
      else if (!attrValueOk(attr.name, attr.value)) problems.push(`attr_value:${attr.name}`);
      if (findSensitive(attr.value).length) problems.push(`attr_sensitive:${attr.name}`);
    }
  }
  return [...new Set(problems)];
}

function scanMeta(meta) {
  const problems = [];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return ["meta:not_object"];
  for (const key of Object.keys(meta)) if (!META_KEYS.has(key)) problems.push(`meta:key:${key}`);
  if (meta.schema !== 1) problems.push("meta:schema");
  if (!desktopSites().some((site) => site.host === meta.host)) problems.push("meta:host");
  if (!isSanitizedRoute(meta.path)) problems.push("meta:path");
  if (typeof meta.promptToken !== "string" || !PROMPT_TOKEN.test(meta.promptToken)) problems.push("meta:promptToken");
  if (!["synthetic", "captured"].includes(meta.source)) problems.push("meta:source");
  if (meta.capturedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(meta.capturedAt)) problems.push("meta:capturedAt");
  if (meta.note !== undefined && (typeof meta.note !== "string" || meta.note.length > 200 || /[^\x20-\x7e]/.test(meta.note))) problems.push("meta:note");
  const expect = meta.expect;
  if (!expect || typeof expect !== "object") problems.push("meta:expect");
  else {
    for (const key of Object.keys(expect)) if (!EXPECT_KEYS.has(key)) problems.push(`meta:expect:${key}`);
    if (!Number.isSafeInteger(expect.userCount) || expect.userCount < 0) problems.push("meta:expect:userCount");
    if (expect.userText !== null && (typeof expect.userText !== "string" || !isPromptText(expect.userText, meta.promptToken))) problems.push("meta:expect:userText");
    if (typeof expect.answer !== "boolean") problems.push("meta:expect:answer");
    if (expect.answerRoot !== undefined && typeof expect.answerRoot !== "boolean") problems.push("meta:expect:answerRoot");
    if (expect.locate !== undefined && !["selector", "semantic", "anchor"].includes(expect.locate)) problems.push("meta:expect:locate");
  }
  if (meta.stats !== undefined) {
    for (const [key, value] of Object.entries(meta.stats || {})) {
      if (!STAT_KEYS.has(key) || !(typeof value === "boolean" || Number.isSafeInteger(value))) problems.push(`meta:stats:${key}`);
    }
  }
  // host 已按九站白名单精确校验（www.kimi.com 会撞 url 规则），其余字段整体再扫一遍。
  for (const name of findSensitive(JSON.stringify({ ...meta, host: undefined }))) problems.push(`meta:sensitive:${name}`);
  return problems;
}

// 目录约定：每个用例一对 <name>.html + <name>.json，外加 README.md；其余文件一律拒收。
function listFixtureFiles(dir = FIXTURE_DIR) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function scanFixtureDir(dir = FIXTURE_DIR) {
  const problems = [];
  const files = listFixtureFiles(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) { problems.push(`${file}: 不允许子目录`); continue; }
    if (file === "README.md") continue;
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(html|json)$/.exec(file);
    if (!match) { problems.push(`${file}: 文件名须为 <小写短横名>.html/.json`); continue; }
    const pair = `${match[1]}.${match[2] === "html" ? "json" : "html"}`;
    if (!files.includes(pair)) problems.push(`${file}: 缺少配对文件 ${pair}`);
    if (match[2] === "json") {
      let meta;
      try { meta = JSON.parse(fs.readFileSync(full, "utf8")); } catch { problems.push(`${file}: JSON 无法解析`); continue; }
      for (const p of scanMeta(meta)) problems.push(`${file}: ${p}`);
    } else {
      let token = "POLYASK_PROMPT";
      try { token = JSON.parse(fs.readFileSync(path.join(dir, pair), "utf8")).promptToken || token; } catch {}
      for (const p of scanHtml(fs.readFileSync(full, "utf8"), token)) problems.push(`${file}: ${p}`);
    }
  }
  return problems;
}

module.exports = { FIXTURE_DIR, scanHtml, scanMeta, scanFixtureDir, listFixtureFiles, isPromptText, isFillerText, isSanitizedRoute };
