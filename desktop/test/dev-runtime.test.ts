import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { ENABLE_COOKIE_ENCRYPTION, prepareDevelopmentRuntime } from '../dev-runtime';

async function fixture(run: (root: string, executable: string) => Promise<void>, cookie = 48): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'polyask-dev-runtime-unit-'));
  try {
    const module = join(root, 'node_modules/electron');
    await mkdir(join(module, 'dist'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(module, 'package.json'), JSON.stringify({ name: 'electron', version: '99.1.2' }));
    await writeFile(join(module, 'path.txt'), 'electron');
    const executable = join(module, 'dist/electron');
    await writeFile(executable, Buffer.concat([Buffer.from('synthetic-dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
      Buffer.from([1, 8, 49, cookie, 49, 49, 48, 48, 49, 49])]));
    await run(root, executable);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('managed runtime enables release Cookie policy on a copy and preserves all other fuses and the installed binary', async () => {
  await fixture(async (root, source) => {
    const original = await readFile(source);
    const runtime = await prepareDevelopmentRuntime(root);
    const wire = await getCurrentFuseWire(runtime.executable);
    const sourceWire = await getCurrentFuseWire(source);
    assert.equal(ENABLE_COOKIE_ENCRYPTION, true);
    assert.equal(wire[FuseV1Options.EnableCookieEncryption], 49);
    assert.equal(sourceWire[FuseV1Options.EnableCookieEncryption], 48);
    assert.equal((await readFile(source)).equals(original), true);
    assert.equal(runtime.version, '99.1.2');
    for (const key of Object.keys(sourceWire)) if (key !== String(FuseV1Options.EnableCookieEncryption))
      assert.equal((wire as any)[key], (sourceWire as any)[key]);
  });
});

test('verified runtime is reused across restarts without rewriting it', async () => {
  await fixture(async root => {
    const first = await prepareDevelopmentRuntime(root);
    const before = await stat(first.executable);
    const second = await prepareDevelopmentRuntime(root);
    assert.equal(second.executable, first.executable);
    assert.equal((await stat(second.executable)).mtimeMs, before.mtimeMs);
  });
});

test('changed cached binary is refused and preserved for inspection', async () => {
  await fixture(async root => {
    const runtime = await prepareDevelopmentRuntime(root);
    const changed = Buffer.concat([await readFile(runtime.executable), Buffer.from('changed')]);
    await writeFile(runtime.executable, changed);
    await assert.rejects(prepareDevelopmentRuntime(root), /dev_runtime_cache_unverified/);
    assert.equal((await readFile(runtime.executable)).equals(changed), true);
  });
});

test('unmarked existing cache directory is never replaced or cleaned', async () => {
  await fixture(async root => {
    const dist = join(root, 'test-artifacts/dev-runtime', `99.1.2-${process.platform}-${process.arch}`);
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'keep'), 'existing data');
    await assert.rejects(prepareDevelopmentRuntime(root), /dev_runtime_cache_unverified/);
    assert.equal(await readFile(join(dist, 'keep'), 'utf8'), 'existing data');
  });
});

test('cache symlink cannot redirect writes into a user directory', async () => {
  await fixture(async root => {
    const target = join(root, 'existing-data');
    await mkdir(target); await writeFile(join(target, 'keep'), 'keep');
    await symlink(target, join(root, 'test-artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareDevelopmentRuntime(root), /dev_runtime_directory_untrusted/);
    assert.equal(await readFile(join(target, 'keep'), 'utf8'), 'keep');
  });
});

test('unsupported source Cookie state is never silently changed into a trusted runtime', async () => {
  await fixture(async root => {
    await assert.rejects(prepareDevelopmentRuntime(root), /dev_runtime_source_unverified/);
  }, 114);
});

test('an absolute executable symlink cannot make runtime preparation modify a source file', async () => {
  await fixture(async (root, source) => {
    const external = join(root, 'outside-runtime');
    await rename(source, external);
    await symlink(external, source, 'file');
    const before = await readFile(external);
    let blocked = false;
    try { await prepareDevelopmentRuntime(root); } catch { blocked = true; }
    assert.equal((await readFile(external)).equals(before), true, 'source file must not be modified through the copied symlink');
    assert.equal(blocked, true);
  });
});

test('a macOS launcher symlink cannot escape the copy even when its Framework is inside', async () => {
  await fixture(async (root, source) => {
    const module = join(root, 'node_modules/electron');
    const app = join(module, 'dist/Electron.app/Contents');
    const framework = join(app, 'Frameworks/Electron Framework.framework/Electron Framework');
    await mkdir(join(app, 'MacOS'), { recursive: true });
    await mkdir(join(app, 'Frameworks/Electron Framework.framework'), { recursive: true });
    await writeFile(framework, await readFile(source));
    const external = join(root, 'outside-launcher'); await writeFile(external, 'external launcher');
    await symlink(external, join(app, 'MacOS/Electron'), 'file');
    await writeFile(join(module, 'path.txt'), 'Electron.app/Contents/MacOS/Electron');
    await assert.rejects(prepareDevelopmentRuntime(root), /dev_runtime_executable_outside_copy/);
    assert.equal(await readFile(external, 'utf8'), 'external launcher');
  });
});
