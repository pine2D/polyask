import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
  buildShellLiveSmokeExpression,
  parseLiveSmokeArgs,
  runLiveSiteSmoke,
  SYNTHETIC_SMOKE_PROMPT
} from './site-live-smoke.mjs';

test('live smoke CLI gate blocks missing confirmation, multi-site fan-out, and unsupported image sites', () => {
  assert.throws(() => parseLiveSmokeArgs(['--site', 'claude']), /live_send_confirmation_required/);
  assert.throws(() => parseLiveSmokeArgs(['--confirm-live-send']), /single_site_required/);
  assert.throws(() => parseLiveSmokeArgs(['--confirm-live-send', '--site', 'claude,kimi']), /single_site_required/);
  assert.throws(() => parseLiveSmokeArgs(['--confirm-live-send', '--site', 'unknown']), /unknown_site/);
  assert.throws(
    () => parseLiveSmokeArgs(['--confirm-live-send', '--site', 'noimg', '--with-image'], [{ key: 'noimg', host: 'x.test', authHosts: [], image: false }]),
    /attachment_unsupported/
  );
  const parsed = parseLiveSmokeArgs(['--confirm-live-send', '--site', 'claude', '--tier', 'fast', '--with-image']);
  assert.equal(parsed.site, 'claude');
  assert.equal(parsed.tier, 'fast');
  assert.equal(parsed.withImage, true);
});

test('live smoke expression ignores stale complete events, passes {sites, runId} to collectAnswers, and handles real CollectedAnswer shape', async () => {
  let activeListeners = 0;
  let capturedCollectReq = null;
  const listeners = new Set();
  const context = vm.createContext({
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    window: {
      polyask: {
        onStatus: (fn) => {
          activeListeners += 1;
          listeners.add(fn);
          return () => { activeListeners -= 1; listeners.delete(fn); };
        },
        broadcast: async (req) => {
          for (const fn of listeners) {
            // beginSubmissionRun 过渡态：残留上一轮 complete（无本轮 runId），不得误判完成！
            fn({ site: req.sites[0], phase: 'complete' });
            fn({ site: req.sites[0], phase: 'complete', generation: { runId: 'stale-prev-run', state: 'complete' } });
            fn({ site: req.sites[0], phase: 'sending', submission: { runId: req.runId, state: 'pending' } });
            fn({ site: req.sites[0], phase: 'submitted', submission: { runId: req.runId, state: 'sent' } });
            setTimeout(() => {
              for (const l of listeners) {
                l({ site: req.sites[0], phase: 'generating', generation: { runId: req.runId, state: 'generating' } });
                l({ site: req.sites[0], phase: 'complete', generation: { runId: req.runId, state: 'complete' } });
              }
            }, 10);
          }
          return [{ site: req.sites[0], ok: true }];
        },
        collectAnswers: async (req) => {
          capturedCollectReq = req;
          // 生产 CollectedAnswer 真实契约无 .ok 布尔字段
          return [{ site: 'claude', host: 'claude.ai', label: 'Claude', text: 'OK — confidential live response text' }];
        }
      }
    }
  });

  const expr = buildShellLiveSmokeExpression(
    { runId: 'smoke-run-42', text: SYNTHETIC_SMOKE_PROMPT, sites: ['claude'], tier: null, images: [] },
    2_000
  );
  const outcome = JSON.parse(JSON.stringify(await vm.runInContext(expr, context)));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.stage, 'complete');
  assert.equal(outcome.code, null);
  assert.deepEqual(JSON.parse(JSON.stringify(capturedCollectReq)), { sites: ['claude'], runId: 'smoke-run-42' });
  assert.deepEqual(outcome.phases, ['complete', 'sending', 'submitted', 'generating', 'complete']);
  assert.equal(outcome.answerChars > 0, true);
  assert.doesNotMatch(JSON.stringify(outcome), /confidential/, '烟雾报告只回报字符数与阶段，不外泄回答原文');
  assert.equal(activeListeners, 0, '结束后必须退订状态监听');
});

test('runLiveSiteSmoke aborts immediately when dev runtime Cookie encryption Fuse check fails', async () => {
  let targetsListed = false;
  await assert.rejects(
    () => runLiveSiteSmoke(
      { port: 9223, site: 'claude', confirmLiveSend: true, withImage: false, tier: null },
      {
        verifyFuse: async () => { throw Object.assign(new Error('dev_cookie_encryption_required'), { code: 'dev_cookie_encryption_required' }); },
        listDebugTargets: async () => { targetsListed = true; return []; }
      }
    ),
    /dev_cookie_encryption_required/
  );
  assert.equal(targetsListed, false, 'Fuse 未通过校验前不得连接任何调试目标');
});
