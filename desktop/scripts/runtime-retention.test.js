const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

// The child inherits test-safe's OS boundary; retain its heap and assertion guard.
for (const scenario of ['markdown-success', 'markdown-error', 'history-navigate', 'history-expire', 'history-error', 'history-freeze', 'history-anchor',
  'generation-chatgpt-quiet', 'generation-chatgpt-seen', 'generation-claude-quiet', 'generation-claude-seen']) {
  test(`${scenario}: detached runtime baselines are collectible when their lifetime ends`, () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=1024', '--import',
      pathToFileURL(path.join(__dirname, 'lib/assertion-safety.mjs')).href,
      '--expose-gc', path.join(__dirname, 'lib/runtime-retention-probe.cjs'), scenario],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024 });
    assert.equal(result.error?.code ?? '', '', 'the bounded probe must start and finish');
    assert.equal(result.status, 0, `${scenario}: ${result.stderr.trim()}`);
  });
}
