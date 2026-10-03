// desktop/scripts/capture-dom-fixture.mjs — 从运行中的开发态 Electron 采一份脱敏 DOM fixture（只读，不发问、不点击）。
// 用法见 desktop/scripts/fixtures-dom/README.md。两段求值、同一份 DOM：
//   ① 主帧的 Electron Isolated Context（生产 __AMS 所在）：只读调用 historyTurn()，把本轮 user/answer/answerRoot
//      换算成相对采集根的元素下标路径，只回传计数、布尔与路径——不回传文本、URL 或节点。
//   ② 主帧主世界：注入 dom-fixture-sanitize.js 源码（局部 module 包裹，不挂全局），按路径打期望标记并输出脱敏 HTML。
// 两段之间若 DOM 变化（元素数不一致）直接失败，等页面静止后重采。落盘前再过一遍入库扫描，不合格不写。
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mainFrameProbeContext } from './lib/measure-site-probe.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { desktopSites } = require('./lib/desktop-anchors.js');
const { FIXTURE_DIR, scanHtml, scanMeta } = require('./lib/dom-fixture-scan.js');
const { PROMPT_TOKEN } = require('./lib/dom-fixture-sanitize.js');

function parseArgs(argv) {
  const args = { port: 9223, root: 'main', token: 'POLYASK_PROMPT', force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined) throw new Error(`missing_value:${flag}`); return v; };
    if (flag === '--host') args.host = value();
    else if (flag === '--name') args.name = value();
    else if (flag === '--prompt') args.prompt = value();
    else if (flag === '--prompt-file') args.promptFile = value();
    else if (flag === '--token') args.token = value();
    else if (flag === '--root') args.root = value();
    else if (flag === '--port') args.port = Number(value());
    else if (flag === '--note') args.note = value();
    else if (flag === '--force') args.force = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else throw new Error(`unknown_flag:${flag}`);
  }
  return args;
}

// 路径里看起来像会话 id 的段（含数字、过长或非纯字母）换成 id-N；只保留 chatglm 路由语义需要的 cid 参数。
// history.js 的 route() 只看段的形状（/chat/<id>、/c/WEB:<id> 之类），占位后首页/会话页判定不变。
export function sanitizeRoute(href) {
  const url = new URL(href);
  const ids = new Map();
  const id = (value) => { if (!ids.has(value)) ids.set(value, `id-${ids.size + 1}`); return ids.get(value); };
  let out = url.pathname.split('/').map((seg) => !seg || /^[A-Za-z_-]{1,24}$/.test(seg) ? seg : id(seg)).join('/') || '/';
  const cid = url.searchParams.get('cid');
  if (cid) out += `?cid=${id(cid)}`;
  return out;
}

export function promptTokenText(prompt, token) {
  const lines = String(prompt).split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return lines.length === 1 ? token : lines.map((_, i) => `${token}-L${i + 1}`).join('\n');
}

// ① 隔离上下文：只读 historyTurn()。sanitizerSource 只用来取 elementPath，与主世界同一口径。
export const isolatedExpression = (sanitizerSource, input) => `(() => {
  const module = { exports: {} };
  ${sanitizerSource}
  const { elementPath } = module.exports;
  const input = ${JSON.stringify(input)};
  const root = document.querySelector(input.root) || document.body;
  const adapter = window.__AMS && window.__AMS.pickAdapter && window.__AMS.pickAdapter();
  if (!adapter || typeof adapter.historyTurn !== 'function') return { ok: false, code: 'no_history_adapter' };
  const turn = adapter.historyTurn() || {};
  const norm = (s) => String(s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
  const marks = [], missing = [];
  const add = (node, token) => {
    if (!node) return;
    const path = typeof node === 'string' ? null : elementPath(root, node);
    if (path) marks.push({ path, token }); else missing.push(token);
  };
  add(turn.user, 'user'); add(turn.answer, 'answer'); add(turn.answerRoot, 'answer-root');
  return { ok: true, userCount: Number.isSafeInteger(turn.userCount) ? turn.userCount : null,
    locate: ['selector', 'semantic', 'anchor'].includes(turn.locate) ? turn.locate : null,
    textMatches: !!turn.user && norm(turn.text) === norm(input.prompt), marks, missing,
    elementCount: root.getElementsByTagName('*').length, href: location.href };
})()`;

// ② 主世界：脱敏输出。元素数对不上说明两段之间页面在变（流式未完、懒加载），拒绝出片。
export const mainExpression = (sanitizerSource, input) => `(() => {
  const module = { exports: {} };
  ${sanitizerSource}
  const input = ${JSON.stringify(input)};
  const root = document.querySelector(input.root) || document.body;
  if (root.getElementsByTagName('*').length !== input.elementCount) return { ok: false, code: 'dom_changed' };
  return { ok: true, ...module.exports.sanitizeDomFixture(root, { prompt: input.prompt, promptToken: input.token, marks: input.marks }) };
})()`;

async function connect(port, host) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = targets.filter((target) => {
    try { const url = new URL(target.url); return target.type === 'page' && url.protocol === 'https:' && url.hostname === host; } catch { return false; }
  });
  if (pages.length !== 1) throw new Error(`expected_one_page:${host}:${pages.length}`);
  const endpoint = new URL(pages[0].webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port) {
    throw new Error('nonlocal_debug_endpoint');
  }
  const socket = new WebSocket(endpoint);
  const pending = new Map(), contexts = [];
  let seq = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`debug_command_failed:${message.error.message}`)); else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('debug_timeout')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('debug_connect_timeout')), 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('debug_connect_failed')); }, { once: true });
  });
  await call('Runtime.enable');
  const frameId = (await call('Page.getFrameTree')).frameTree.frame.id;
  const isolated = mainFrameProbeContext(contexts, frameId);
  const main = contexts.find((item) => item.auxData?.isDefault === true && item.auxData?.frameId === frameId);
  const close = () => { for (const request of pending.values()) clearTimeout(request.timer); socket.close(); };
  if (!isolated || !main) { close(); throw new Error('execution_context_missing'); }
  const evaluate = async (contextId, expression) => {
    const result = await call('Runtime.evaluate', { expression, contextId, returnByValue: true });
    if (result.exceptionDetails) throw new Error('evaluation_failed');
    return result.result.value;
  };
  return { evaluate, isolated: isolated.id, main: main.id, close };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const site = desktopSites().find((item) => item.host === args.host || item.key === args.host);
  if (!site) throw new Error('unknown_site');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name || '')) throw new Error('invalid_fixture_name');
  if (!PROMPT_TOKEN.test(args.token)) throw new Error('invalid_prompt_token');
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) throw new Error('invalid_local_debug_port');
  const prompt = args.promptFile ? await readFile(args.promptFile, 'utf8') : args.prompt;
  if (!prompt || !prompt.trim()) throw new Error('prompt_required');
  const sanitizerSource = await readFile(join(here, 'lib', 'dom-fixture-sanitize.js'), 'utf8');
  const session = await connect(args.port, site.host);
  let probe, output;
  try {
    probe = await session.evaluate(session.isolated, isolatedExpression(sanitizerSource, { root: args.root, prompt }));
    if (!probe?.ok) throw new Error(probe?.code || 'probe_failed');
    if (probe.missing.length) throw new Error(`marked_node_outside_root:${probe.missing.join(',')}`);
    if (!probe.textMatches) throw new Error('history_turn_does_not_bind_prompt');
    output = await session.evaluate(session.main, mainExpression(sanitizerSource,
      { root: args.root, prompt, token: args.token, marks: probe.marks, elementCount: probe.elementCount }));
    if (!output?.ok) throw new Error(output?.code || 'sanitize_failed');
  } finally { session.close(); }
  if (!output.stats.promptHits) throw new Error('prompt_text_not_found_in_dom');
  if (output.stats.truncated) throw new Error('fixture_truncated_narrow_root');
  const tokens = new Set(probe.marks.map((mark) => mark.token));
  const meta = { schema: 1, host: site.host, path: sanitizeRoute(probe.href), promptToken: args.token, source: 'captured',
    capturedAt: new Date().toISOString().slice(0, 10), ...(args.note ? { note: args.note } : {}),
    expect: { userCount: probe.userCount, userText: promptTokenText(prompt, args.token), answer: tokens.has('answer'), answerRoot: tokens.has('answer-root'),
      ...(probe.locate ? { locate: probe.locate } : {}) },
    stats: output.stats };
  const html = `${output.html}\n`;
  const problems = [...scanHtml(html, args.token), ...scanMeta(meta)];
  if (problems.length) { console.error(`scan failed, nothing written:\n- ${problems.join('\n- ')}`); process.exitCode = 1; return; }
  console.log(JSON.stringify({ name: args.name, ...meta }, null, 2));
  if (args.dryRun) return;
  const flag = args.force ? 'w' : 'wx';
  await writeFile(join(FIXTURE_DIR, `${args.name}.html`), html, { flag });
  await writeFile(join(FIXTURE_DIR, `${args.name}.json`), `${JSON.stringify(meta, null, 2)}\n`, { flag });
  console.log(`written: ${join(FIXTURE_DIR, args.name)}.{html,json} — review the diff before committing`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
