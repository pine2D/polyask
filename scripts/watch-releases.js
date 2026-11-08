#!/usr/bin/env node
"use strict";
// scripts/watch-releases.js — 模型发布情报哨兵：轮询官方 changelog/RSS/状态快照页，发现新条目自动开 GitHub issue。
// 定位是「闹钟」：提醒去真机核对站点 UI——公告里的模型名与网页 UI 标签经常不同名，严禁直接抄进适配器
// 正则（docs/adapters.md：档位标签必须先真机确认）。元宝/千问/豆包仍无官方 web changelog 或状态页
// （2026-08 复核维持原判：元宝/千问/豆包官网是需登录的 React SPA，纯 GET 拿不到渲染后 DOM；腾讯混元
// 「研究动态」页同样是 SPA，只是内容主题是模型不是元宝产品本身，权衡后未纳入），它们的 UI 变化仍靠
// 巡检 diagnose 与真实群发失败信号兜底，不在本脚本覆盖面内。Kimi 已由 kind:"snapshot" 补上（见下）。
// 运行环境：GitHub Actions（.github/workflows/release-watch.yml 注入 GITHUB_TOKEN/GITHUB_REPOSITORY）；
// --dry-run 或本地无 token 时只打印计划、不写远端（有凭据仍可只读历史）。命名不得改成 test- 前缀——verify.sh 会强制把 test-*.js 登记进无网络的 CI。

const {
  dedupe,
  parseRss,
  parseHeadings,
  parseZhipu,
  datedSections,
  parseSnapshot,
  parseBailian,
  NEVER_HIGH_SIGNAL,
} = require("./lib/release-feed.js");

const { planUpdates } = require("./lib/release-watch-plan.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LABEL = "release-watch";
// filter 只放行真正的 changelog 条目（各页混有导航/页脚标题，2026-08 实测逐源定形）；页面改版导致
// 全部过滤不中时按「解析到 0 条」报错升红，不会静默失明。
// kind: "datedSections" 的三源（claude/gemini/deepseek）标题
// 本身只是日期，filter 就是识别日期标题的 dateRe，作用于 entry.date（见下方主循环），不是拼接摘要后
// 的 entry.title。claude 源额外传 groupHeaderRe（datedSections 第四参）剔除「月份大标题」，见
// release-feed.js 里 datedSections 的注释——不剔除会把下月月份名回收成上月最后一条的摘要。
// kind: "bailian" 的 entry 同样有 date 字段，filter 用法与 datedSections 一致。
// kind: "snapshot"（kimi）没有 date 字段，filter 退化成"非空即放行"的哨兵——真正的失败信号是
// parseSnapshot 正文为空返回空数组，走下面「解析到 0 条」那条报错路径。
// 新分类与按周聚合由 release-watch-plan.js 决定：消费端 /web、模型公告 /model 独立开单，
// API 与低信号按来源 + UTC 周一聚合。highSignal/lowSignalNote 只保留作旧标题/正文兼容，
// 不再决定新 issue 的信号等级；分类依据与每条来源链接写入正文。旧 label 不可移除。
const SOURCES = [
  { key: "openai", name: "OpenAI / ChatGPT", url: "https://openai.com/news/rss.xml", kind: "rss",
    filter: /gpt|chatgpt|model|\bo[0-9]\b|release|introducing/i,
    highSignal: /\b(gpt[-\s]?[0-9][\w.\-]*|o[0-9]+(?:-\w+)?|new model|model release|now available in chatgpt|rolling out.*model)\b/i,
    adapter: "desktop/src/site-runtime/adapters-intl2.js" },
  // claude 源 2026-08 纠偏：原 platform.claude.com 是开发者 Console/API/SDK changelog，窗口内 5 条
  // issue 全是 API 基建噪音、零命中消费端变化；换成 support.claude.com 的消费端 release notes（Intercom
  // 文章页，服务端渲染，实测可直接 GET）。日期是「月份大标题（H2）+ 日期小标题（H3）」两级结构，
  // groupHeaderRe 剔除月份大标题（理由见 datedSections 注释）。key 不变，仍是 "claude"——URL 切换后
  // 首轮会因为新旧页面内容不重叠而登记 1 条新基线 issue，这是预期行为，不是漏检。
  { key: "claude", name: "Anthropic / Claude（消费端）", url: "https://support.claude.com/en/articles/12138966-release-notes", kind: "datedSections", surface: "web",
    filter: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s*20\d\d$/i,
    groupHeaderRe: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d\d$/i,
    adapter: "desktop/src/site-runtime/adapters-intl.js" },
  { key: "gemini", name: "Google / Gemini", url: "https://gemini.google/release-notes/", kind: "datedSections", surface: "web",
    filter: /^20\d\d[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/, adapter: "desktop/src/site-runtime/adapters-intl3.js" },
  // gemini 官方 release notes（上面那条）2026-08 被实证漏记 3.7 Flash 换档这类选择器级变化——真正
  // 发模型公告的是 blog.google 的 Gemini Models 专栏，且该栏目自带 /rss/（各 blog.google 栏目通用
  // 惯例，实测可直接 GET）。key 用 "gemini-blog" 而非复用 "gemini"，两源独立去重、互不影响。
  { key: "gemini-blog", name: "Google / Gemini 官方博客", url: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/rss/", kind: "rss",
    filter: /gemini|flash|pro|model/i, highSignal: /\bintroducing\b/i, adapter: "desktop/src/site-runtime/adapters-intl3.js" },
  { key: "deepseek", name: "DeepSeek", url: "https://api-docs.deepseek.com/updates/", kind: "datedSections", surface: "api",
    filter: /20\d\d-\d{1,2}-\d{1,2}/, adapter: "desktop/src/site-runtime/adapters-cn.js" },
  { key: "zhipu", name: "智谱 / chatglm", url: "https://docs.bigmodel.cn/cn/update/new-releases", kind: "zhipu", surface: "api",
    filter: /^20\d\d-\d{1,2}-\d{1,2}/, adapter: "desktop/src/site-runtime/adapters-cn2.js" },
  // kimi.com 本身没有面向 C 端网页的官方 changelog（2026-08 复核维持原判），但帮助中心这篇「模型与
  // 模式怎么选」是当前 UI 状态的一手快照（服务端渲染，实测可直接 GET）：K2.6/K3/K3 集群三档模型、
  // 各档思考强度选项都直接写在正文表格里。kind:"snapshot"（见 release-feed.js parseSnapshot）把正文
  // 摘要当唯一 entry，摘要变了就等于页面变了，比等 changelog 更贴合 PolyAsk 真正关心的「选择器现在
  // 长什么样」而不是「发布了什么」。anchor 锚定表头关键词，跳过开头重复的面包屑/标题。
  { key: "kimi", name: "Kimi 帮助中心·模型与模式怎么选", url: "https://www.kimi.com/zh-cn/help/others/model-mode-selection", kind: "snapshot",
    filter: /./, anchor: /模型\s*思考强度|三档模型/, adapter: "desktop/src/site-runtime/adapters-cn2.js" },
  // 阿里云百炼「模型上线表」是跨厂商 API 上线信号（Qwen/GLM/Kimi 等经百炼平台上线的型号，不是任何
  // 单一网页产品的 changelog），表格服务端渲染、按日期倒序，实测可直接 GET。用 NEVER_HIGH_SIGNAL 让
  // 旧版整源标 /low；新版 surface:"api" 按周聚合：API 侧上线不代表网页选择器已同步，
  // 不能沿用 openai 那句「多半是营销/案例文」（这源里没有营销文，只是信号层级不同）。adapter 字段在
  // 这里没有单一文件可指——不同型号分属不同厂商适配器，写清楚怎么按行内 Model type 去对应。
  { key: "bailian", name: "阿里云百炼·模型上线表（跨厂商）", url: "https://help.aliyun.com/en/model-studio/newly-released-models", kind: "bailian", surface: "api",
    filter: /^20\d\d-\d{1,2}-\d{1,2}$/, highSignal: NEVER_HIGH_SIGNAL,
    lowSignalNote: "低信号条目：阿里云百炼是跨厂商 API 上线表（Qwen/GLM/Kimi 等厂商模型经百炼平台上线），只代表 API 侧已可调用，不代表对应网页产品（qianwen.com / chatglm.cn / kimi.com 等）的模型选择器已同步这个模型——需要按条目里的厂商真机核对具体站点才能确认 UI 是否变化。",
    adapter: "按行内 Model type 对应厂商站点定，例如 Qwen 系→desktop/src/site-runtime/adapters-cn4.js，GLM/Kimi 系→desktop/src/site-runtime/adapters-cn2.js" },
];

async function fetchText(url, retry = 1) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    if (retry <= 0) throw e;
    await new Promise((res) => setTimeout(res, 3000)); // 瞬时网络抖动重试一次再判死
    return fetchText(url, retry - 1);
  } finally { clearTimeout(timer); }
}

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "";
// allow422 只给 label 创建这类幂等端点：issue POST 的 422 是校验失败（标题超 256 等），吞掉会变成
// 「日志喊 opened、实际没开、下轮还重试」的静默空转，必须抛错让 workflow 变红。
async function gh(method, path, body, allow422) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "polyask-release-watch",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow422 && r.status === 422) return null;
  if (!r.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${r.status}`);
  return r.json();
}
// 拉取所有历史标题和周报条目身份；有界扫描到顶必须红灯，不能假装历史已读完。
async function existingIssues(github) {
  const issues = [];
  for (let page = 1; page <= 20; page++) {
    const rows = await github("GET", `/repos/${REPO}/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error("GitHub issue 列表格式异常");
    issues.push(...rows.filter((row) => !row.pull_request));
    if (rows.length < 100) return issues;
  }
  throw new Error("历史 issue 扫描超过 2000 条上限，未进行写入");
}

async function runWatch(options) {
  const { sources = SOURCES, read = fetchText, github = gh,
    dryRun = process.argv.includes("--dry-run") || !TOKEN || !REPO,
    now = new Date(), log = console.log, warn = console.warn } = options || {};
  const canReadIssues = !!options?.github || !!(TOKEN && REPO);
  const issues = options?.issues ? structuredClone(options.issues) : canReadIssues ? await existingIssues(github) : [];
  if (!dryRun) await github("POST", `/repos/${REPO}/labels`, { name: LABEL, color: "d9b93b", description: "模型发布情报（watch-releases.js 自动创建）" }, true);
  const failures = [];
  for (const src of sources) {
    try {
      const text = await read(src.url);
      let entries = src.kind === "rss" ? parseRss(text)
        : src.kind === "zhipu" ? parseZhipu(text, src.url)
        : src.kind === "datedSections" ? datedSections(text, src.url, src.filter, src.groupHeaderRe)
        : src.kind === "snapshot" ? parseSnapshot(text, src.url, src.anchor)
        : src.kind === "bailian" ? parseBailian(text, src.url)
        : parseHeadings(text, src.url);
      // RSS publishedAt 不作 filter 输入；日期型来源仍用原始 date 校验，保留旧解析契约。
      entries = dedupe(entries.filter((entry) => src.filter.test(entry.date ?? entry.title))).slice(0, 10);
      if (!entries.length) throw new Error(`解析到 0 条（页面结构可能已变，去 ${src.url} 人工看一眼）`);
      const updates = planUpdates(src, entries, issues, now, warn);
      for (const update of updates) {
        const { number, ...body } = update;
        if (dryRun) { log(`[dry-run] would ${number ? "update" : "open"}: ${body.title}`); continue; }
        const saved = await github(number ? "PATCH" : "POST", `/repos/${REPO}/issues${number ? `/${number}` : ""}`, { ...body, ...(!number ? { labels: [LABEL] } : {}) });
        if (!saved?.number) throw new Error(`issue ${number ? "更新" : "创建"}失败 ${body.title}`);
        if (number) Object.assign(issues.find((row) => row.number === number), saved, body);
        else issues.push({ ...saved, ...body });
        log(`${number ? "updated" : "opened"}: #${saved.number} ${body.title}`);
      }
      if (!updates.length) log(`${src.key}: 无新条目`);
    } catch (e) { failures.push(`${src.key}: ${e.message}`); }
  }
  if (failures.length) throw new Error("情报源异常：\n" + failures.join("\n"));
}

module.exports = { SOURCES, runWatch };
if (require.main === module) runWatch().catch((e) => { console.error(e); process.exitCode = 1; });
