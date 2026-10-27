import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative as pathRelative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Only a tiny fake executable is read. No Electron process or login profile is opened.
function preflight(state: number | null, second?: number, redirect = false, relativeOverride = false): { blocked: boolean; code?: string; absolute?: boolean } {
  const directory = mkdtempSync(join(tmpdir(), 'polyask-cookie-preflight-'));
  try {
    const relative = readFileSync(require.resolve('electron/path.txt'), 'utf8').trim();
    const executable = join(directory, relative);
    const wireFile = process.platform === 'darwin'
      ? resolve(executable, '../../Frameworks/Electron Framework.framework/Electron Framework') : executable;
    mkdirSync(resolve(wireFile, '..'), { recursive: true });
    if (wireFile !== executable) { mkdirSync(resolve(executable, '..'), { recursive: true }); writeFileSync(executable, 'synthetic launcher'); }
    const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
    writeFileSync(wireFile, state === null ? 'no fuse wire' : Buffer.concat([sentinel, Buffer.from([1, 2, 49, state]), ...(second === undefined ? [] : [sentinel, Buffer.from([1, 2, 49, second])])]));
    const redirected = join(directory, 'redirected');
    const redirectedExecutable = join(redirected, relative);
    const redirectedWire = process.platform === 'darwin'
      ? resolve(redirectedExecutable, '../../Frameworks/Electron Framework.framework/Electron Framework') : redirectedExecutable;
    if (redirect) {
      mkdirSync(resolve(redirectedWire, '..'), { recursive: true }); copyFileSync(wireFile, redirectedWire);
      if (redirectedWire !== redirectedExecutable) { mkdirSync(resolve(redirectedExecutable, '..'), { recursive: true }); writeFileSync(redirectedExecutable, 'synthetic launcher'); }
    }
    const script = `(async () => { ${redirect ? 'require(\"electron\"); process.env.ELECTRON_OVERRIDE_DIST_PATH = ' + JSON.stringify(redirected) + ';' : ''} const config = require('./forge.config.ts').default;
      try { await config.hooks?.preStart?.(config); console.log(JSON.stringify({blocked:false,absolute:require("node:path").isAbsolute(require("electron"))})); }
      catch (error) { console.log(JSON.stringify({blocked:true,code:error.code ?? error.message})); }
    })().catch(() => { process.exitCode = 1; });`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: relativeOverride ? pathRelative(resolve(__dirname, '..'), directory) : directory, ELECTRON_RUN_AS_NODE: '' }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('Forge rejects disabled Cookie encryption before opening any profile', () => {
  assert.equal(preflight(48).blocked, true, 'bare Electron must not reach application startup');
});
test('Forge rejects an unreadable Cookie fuse instead of assuming compatibility', () => {
  assert.equal(preflight(null).blocked, true);
});
test('Forge allows only the enabled Cookie encryption required by the release', () => {
  assert.equal(preflight(49).blocked, false);
});

test('Forge fails closed for removed and inherited Cookie fuse states', () => {
  assert.equal(preflight(114).blocked, true);
  assert.equal(preflight(144).blocked, true);
});

test('every architecture in a multi-wire runtime must have verified Cookie encryption', () => {
  assert.equal(preflight(49, 48).blocked, true);
  assert.equal(preflight(49, 114).blocked, true);
  assert.equal(preflight(49, 49).blocked, false);
});

test('Forge refuses a cached executable that differs from the requested runtime override', () => {
  assert.equal(preflight(49, undefined, true).blocked, true);
});

test('relative runtime overrides are made absolute before Forge changes the application working directory', () => {
  const result = preflight(49, undefined, false, true);
  assert.equal(result.blocked, false);
  assert.equal(result.absolute, true);
});
