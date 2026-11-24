import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { visualExitCode } from './lib/visual-exit-code.mjs';

test('native UI acceptance needs a final report and a timely successful exit', async t => {
  const output = await mkdtemp(join(tmpdir(), 'polyask-visual-exit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  t.mock.method(console, 'error', () => {});
  const report = join(output, 'complete');
  const exitWith = code => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', code));
    return visualExitCode(child, report, 1000);
  };

  assert.equal(await exitWith(0), 1);
  await writeFile(report, '');
  assert.equal(await exitWith(0), 0);
  assert.equal(await exitWith(7), 7);
  assert.equal(await exitWith(null), 1);

  const hung = new EventEmitter();
  hung.kill = signal => {
    assert.equal(signal, 'SIGTERM');
    hung.emit('exit', 0);
  };
  assert.equal(await visualExitCode(hung, report, 10), 1);

  const unresponsive = new EventEmitter();
  const signals = [];
  unresponsive.kill = signal => signals.push(signal);
  unresponsive.unref = () => {};
  assert.equal(await visualExitCode(unresponsive, report, 10, 10), 1);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
