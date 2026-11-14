// desktop/scripts/site-live-smoke.mjs — 单站真实发送最小烟雾验收脚本（强门禁拦截，日常严禁运行！）。
// 铁律：未显式传入 --confirm-live-send 与单个 --site <key> 时一律拒绝启动；禁止多站群发刷屏；不打印回答原文。
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalDebugPort,
  classifySiteTarget,
  findShellSession,
  listDebugTargets,
  openCdpTarget,
  readSiteDefinitions,
  reexecUnderLinuxBoundaryIfNeeded,
  verifyDevRuntimeCookieEncryption
} from './lib/dev-tour-client.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const SYNTHETIC_SMOKE_PROMPT = 'PolyAsk live smoke ping: reply with OK only.';
// 1x1 纯白 PNG（无任何用户文件或 EXIF 元数据）
export const SYNTHETIC_SMOKE_PNG = {
  name: 'smoke-1x1.png',
  type: 'image/png',
  size: 68,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII='
};

function fail(code, detail = '') {
  const err = new Error(detail ? `${code}:${detail}` : code);
  err.code = code;
  return err;
}

export function parseLiveSmokeArgs(argv, sites = readSiteDefinitions()) {
  const out = {
    port: 9223,
    site: null,
    confirmLiveSend: false,
    withImage: false,
    tier: null,
    json: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const val = argv[++i];
      if (val === undefined) throw fail('missing_value', arg);
      return val;
    };
    if (arg === '--confirm-live-send') out.confirmLiveSend = true;
    else if (arg === '--site') out.site = next().trim();
    else if (arg === '--port') out.port = Number(next());
    else if (arg === '--with-image') out.withImage = true;
    else if (arg === '--tier') {
      const tier = next().trim();
      if (!['think', 'fast'].includes(tier)) throw fail('invalid_tier', tier);
      out.tier = tier;
    } else if (arg === '--json') out.json = true;
    else throw fail('unknown_flag', arg);
  }
  if (!out.confirmLiveSend) {
    throw fail('live_send_confirmation_required', 'Refusing to send to live site without --confirm-live-send');
  }
  if (!out.site || out.site.includes(',')) {
    throw fail('single_site_required', 'Pass exactly one --site <key> for minimal live smoke');
  }
  assertLocalDebugPort(out.port);
  const siteDef = sites.find((item) => item.key === out.site);
  if (!siteDef) throw fail('unknown_site', out.site);
  if (out.withImage && !siteDef.image) throw fail('attachment_unsupported', out.site);
  return out;
}

export function buildShellLiveSmokeExpression(request, timeoutMs) {
  return `(async () => {
    const req = ${JSON.stringify(request)};
    const timeoutMs = ${Number(timeoutMs)};
    const site = req.sites[0];
    const phases = [];
    let settled = false;
    let resolveDone;
    const donePromise = new Promise((resolve) => { resolveDone = resolve; });
    const off = window.polyask.onStatus((status) => {
      if (!status || status.site !== site) return;
      if (phases[phases.length - 1] !== status.phase) phases.push(status.phase);
      if (!settled && ['complete', 'failed', 'cancelled', 'crashed'].includes(status.phase) && status.phase !== 'sending') {
        if (status.submission?.runId === req.runId || status.generation?.runId === req.runId) {
          settled = true;
          resolveDone({ terminalPhase: status.phase, code: status.code || null });
        }
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolveDone({ terminalPhase: 'timeout', code: 'timeout' });
      }
    }, timeoutMs);
    const startedAt = Date.now();
    try {
      const runResults = await window.polyask.broadcast(req);
      const first = Array.isArray(runResults) ? runResults[0] : null;
      if (!first?.ok) {
        return {
          ok: false,
          stage: 'submit',
          code: first?.code || 'submit_failed',
          phases,
          elapsedMs: Date.now() - startedAt
        };
      }
      const terminal = await donePromise;
      if (terminal.terminalPhase !== 'complete') {
        return {
          ok: false,
          stage: 'generation',
          code: terminal.code || terminal.terminalPhase,
          phases,
          elapsedMs: Date.now() - startedAt
        };
      }
      const collected = await window.polyask.collectAnswers({ sites: [site], runId: req.runId });
      const answer = Array.isArray(collected) ? collected[0] : null;
      const answerChars = typeof answer?.text === 'string' ? answer.text.trim().length : 0;
      const hasAnswer = answerChars > 0;
      return {
        ok: hasAnswer,
        stage: hasAnswer ? 'complete' : 'capture',
        code: hasAnswer ? null : (answer?.code || 'empty_answer'),
        phases,
        answerChars,
        elapsedMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timer);
      off?.();
    }
  })()`;
}

export async function runLiveSiteSmoke(rawArgs, deps = {}) {
  const options = typeof rawArgs?.confirmLiveSend === 'boolean' ? rawArgs : parseLiveSmokeArgs(rawArgs);
  const verifyFuse = deps.verifyFuse ?? verifyDevRuntimeCookieEncryption;
  const fetchTargets = deps.listDebugTargets ?? listDebugTargets;
  const openTarget = deps.openCdpTarget ?? openCdpTarget;
  const findShell = deps.findShellSession ?? findShellSession;
  const sites = deps.sites ?? readSiteDefinitions();

  await verifyFuse();
  const siteDef = sites.find((s) => s.key === options.site);
  if (!siteDef) throw fail('unknown_site', options.site);

  const targets = await fetchTargets(options.port);
  const targetState = classifySiteTarget(targets, siteDef);
  if (targetState.state !== 'ready') {
    return { ok: false, site: options.site, stage: 'precheck', code: targetState.state, phases: [], answerChars: 0, elapsedMs: 0 };
  }

  const budgetMs = options.withImage ? 90_000 : 44_000;
  const request = {
    runId: `smoke-${randomUUID()}`,
    text: SYNTHETIC_SMOKE_PROMPT,
    sites: [options.site],
    tier: options.tier,
    images: options.withImage ? [SYNTHETIC_SMOKE_PNG] : []
  };

  const shellSession = await findShell(targets, options.port, openTarget);
  try {
    const outcome = await shellSession.evaluate(
      shellSession.mainId,
      buildShellLiveSmokeExpression(request, budgetMs + 15_000),
      { awaitPromise: true, timeoutMs: budgetMs + 20_000 }
    );
    return { site: options.site, withImage: options.withImage, ...outcome };
  } finally {
    shellSession.close();
  }
}

async function main() {
  const boundaryStatus = reexecUnderLinuxBoundaryIfNeeded(SCRIPT_PATH);
  if (boundaryStatus !== null) {
    process.exitCode = boundaryStatus;
    return;
  }
  const options = parseLiveSmokeArgs(process.argv.slice(2));
  const result = await runLiveSiteSmoke(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `PolyAsk Live Smoke [${result.site}] -> ${result.ok ? 'PASS' : `FAIL (${result.stage}:${result.code})`} · phases=${(result.phases || []).join('->')} · answerChars=${result.answerChars ?? 0} · ${result.elapsedMs}ms`
    );
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((err) => {
    console.error(`site-live-smoke blocked: ${err.code || err.message}`);
    process.exitCode = 1;
  });
}
