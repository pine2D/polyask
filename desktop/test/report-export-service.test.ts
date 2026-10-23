import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchiveRecord } from '../src/shared/archive';
import type { DecisionRecord } from '../src/shared/decision';
import { ReportExportService } from '../src/main/report-export-service';
import { writeReportFile } from '../src/main/report-file';
import { archiveFixture } from './fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function harness() {
  let archive: ArchiveRecord | null = archiveFixture(), decision: DecisionRecord | null = null;
  let epoch = 0, current = true, dialogs = 0, prints = 0, writes = 0;
  let dialog = async () => '/chosen/report.html' as string | null;
  let print: () => Promise<Uint8Array> = async () => Buffer.from('%PDF-1.7 test');
  let write = async (_path: string, _data: Uint8Array | string, guard: () => void) => { guard(); writes++; };
  const service = new ReportExportService({
    archives: { get: () => archive }, decisions: { get: () => decision }, epoch: () => epoch, isCurrent: () => current,
    choosePath: async () => { dialogs++; return dialog(); }, printPdf: async () => { prints++; return print(); },
    writeFile: (...args) => write(...args)
  });
  return { service, setArchive: (value: ArchiveRecord | null) => { archive = value; },
    setDecision: (value: DecisionRecord) => { decision = value; }, reset: () => { epoch++; }, close: () => { current = false; },
    setDialog: (value: typeof dialog) => { dialog = value; }, setPrint: (value: typeof print) => { print = value; },
    setWrite: (value: typeof write) => { write = value; }, stats: () => ({ dialogs, prints, writes }) };
}
const request = { kind: 'archive', id: 'archive-a', format: 'html', locale: 'en' } as const;

test('dialog cancellation makes no renderer or file, and successful HTML uses only main-read saved data', async () => {
  const h = harness(); h.setDialog(async () => null);
  assert.equal((await h.service.export(request)).status, 'cancelled');
  assert.deepEqual(h.stats(), { dialogs: 1, prints: 0, writes: 0 });
  h.setDialog(async () => '/chosen/report.html');
  let content = '';
  h.setWrite(async (_path, data, guard) => { guard(); content = String(data); });
  assert.equal((await h.service.export(request)).status, 'saved');
  assert.match(content, /Why is the sky blue/); assert.match(content, /Rayleigh scattering/);
});

test('unavailable initial record fails before the native dialog', async () => {
  const h = harness(); h.setArchive(null);
  assert.deepEqual(await h.service.export(request), { status: 'failed', code: 'report_not_found' });
  assert.deepEqual(h.stats(), { dialogs: 0, prints: 0, writes: 0 });
});

for (const mutation of ['delete', 'change', 'reset', 'close'] as const) test(`late native dialog cannot write after ${mutation}`, async () => {
  const h = harness(), gate = deferred<string | null>(); h.setDialog(() => gate.promise);
  const pending = h.service.export(request);
  assert.equal(h.stats().dialogs, 1);
  if (mutation === 'delete') h.setArchive(null);
  if (mutation === 'change') h.setArchive({ ...archiveFixture(), updatedAt: 3000 });
  if (mutation === 'reset') h.reset();
  if (mutation === 'close') h.close();
  gate.resolve('/chosen/report.html');
  assert.deepEqual(await pending, { status: 'failed', code: 'report_source_changed' });
  assert.equal(h.stats().writes, 0); assert.equal(h.stats().prints, 0);
});

test('PDF completion, busy guard, reset and dispose cannot produce a stale file', async () => {
  const h = harness(), gate = deferred<Buffer>(), started = deferred<void>();
  h.setPrint(() => { started.resolve(); return gate.promise; });
  const pending = h.service.export({ ...request, format: 'pdf' });
  await started.promise;
  assert.equal(h.stats().prints, 1);
  assert.deepEqual(await h.service.export(request), { status: 'failed', code: 'report_busy' });
  h.reset(); gate.resolve(Buffer.from('%PDF-1.7'));
  assert.deepEqual(await pending, { status: 'failed', code: 'report_source_changed' });
  assert.equal(h.stats().writes, 0);
  h.service.dispose();
  assert.equal((await h.service.export(request)).status, 'cancelled');
});

test('file writer receives a guard that catches deletion after its own asynchronous preparation', async () => {
  const h = harness();
  h.setWrite(async (_path, _data, guard) => { h.setArchive(null); await Promise.resolve(); guard(); assert.fail('stale write committed'); });
  assert.deepEqual(await h.service.export(request), { status: 'failed', code: 'report_source_changed' });
});

test('arbitrary errors stay finite and PDF failures never reach the writer', async () => {
  const h = harness(); h.setPrint(async () => { throw new Error('/private/path and untrusted error'); });
  assert.deepEqual(await h.service.export({ ...request, format: 'pdf' }), { status: 'failed', code: 'report_pdf_failed' });
  assert.equal(h.stats().writes, 0);
  h.setDialog(async () => { throw new Error('/private/path'); });
  assert.deepEqual(await h.service.export(request), { status: 'failed', code: 'report_failed' });
});

test('decision export retains its saved evidence when the source is unavailable, but rejects a late source deletion', async () => {
  const h = harness(), archive = archiveFixture();
  h.setDecision({ id: 'decision', archiveId: archive.id, sourceTitle: archive.task, title: 'Saved choice',
    conclusion: 'Manual conclusion', rationale: 'My rationale', uncertainties: '', nextStep: '', status: 'final',
    evidence: [{ resultIndex: 0, excerpt: 'Rayleigh scattering.', host: 'claude.ai', label: 'Claude', capturedAt: 1000 }],
    createdAt: 1000, updatedAt: 1000, deviceId: 'device', schema: 2 });
  h.setArchive(null);
  let html = '';
  h.setWrite(async (_path, data, guard) => { guard(); html = String(data); });
  const input = { ...request, kind: 'decision', id: 'decision' } as const;
  assert.equal((await h.service.export(input)).status, 'saved');
  assert.match(html, /Manual conclusion/); assert.match(html, /Rayleigh scattering/); assert.match(html, /title snapshot/);
  h.setArchive(archive);
  const gate = deferred<string | null>(); h.setDialog(() => gate.promise);
  const pending = h.service.export(input);
  h.setArchive(null); gate.resolve('/chosen/report.html');
  assert.deepEqual(await pending, { status: 'failed', code: 'report_source_changed' });
});

test('out-of-bounds source is rejected explicitly without silently omitting answers', async () => {
  const h = harness(), source = archiveFixture();
  h.setArchive({ ...source, results: Array.from({ length: 10 }, () => source.results[0]) });
  assert.deepEqual(await h.service.export(request), { status: 'failed', code: 'report_too_large' });
  assert.equal(h.stats().dialogs, 0);
});

test('atomic output preserves an existing file on stale completion and removes only its temporary file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polyask-report-test-')), destination = join(dir, 'report.html');
  try {
    await writeFile(destination, 'existing');
    let checks = 0;
    await assert.rejects(writeReportFile(destination, 'replacement', () => { if (++checks >= 2) throw new Error('report_source_changed'); }), /report_source_changed/);
    assert.equal(await readFile(destination, 'utf8'), 'existing');
    assert.deepEqual(await readdir(dir), ['report.html']);
    await writeReportFile(destination, 'replacement', () => {});
    assert.equal(await readFile(destination, 'utf8'), 'replacement');
    assert.deepEqual(await readdir(dir), ['report.html']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
