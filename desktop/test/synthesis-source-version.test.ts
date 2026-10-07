import assert from 'node:assert/strict';
import test from 'node:test';
import { SynthesisService } from '../src/main/synthesis-service';
import { SITES } from '../src/main/sites';
import type { ArchiveService } from '../src/main/archive-service';
import type { ArchiveRecord } from '../src/shared/archive';
import { archiveFixture } from './fixtures';

function setup() {
  const record: ArchiveRecord = { ...archiveFixture(), updatedAt: 100, results: [
    { host: 'claude.ai', label: 'Claude', text: 'Source one' }, { host: 'chatgpt.com', label: 'ChatGPT', text: 'Source two' }
  ] };
  let current: ArchiveRecord | null = record, shown = 0, navigated = 0, sent = 0, history = 0;
  let duringNavigation = async () => {}, duringSend = () => {};
  const service = new SynthesisService({ sites: SITES,
    archives: { get: () => current } as unknown as ArchiveService,
    showTarget: () => { shown++; }, navigate: async () => { navigated++; await duringNavigation(); },
    send: async () => { sent++; duringSend(); return [{ site: 'claude', ok: true }]; }, collect: async () => [],
    recordHistory: () => { history++; }
  });
  const request = { archiveId: record.id, sourceUpdatedAt: record.updatedAt, targetSite: 'claude', tier: null,
    selectedHosts: ['claude.ai', 'chatgpt.com'], instruction: 'Compare' };
  return { service, record, request, counts: () => [shown, navigated, sent, history].join(','),
    change(value: ArchiveRecord | null) { current = value; },
    onNavigate(callback: () => Promise<void>) { duringNavigation = callback; },
    onSend(callback: () => void) { duringSend = callback; }
  };
}

test('a stale source version fails before revealing a target or starting a new conversation', async () => {
  const h = setup(); h.change({ ...h.record, updatedAt: 101 });
  await assert.rejects(h.service.send(h.request), /source_changed/);
  assert.equal(h.counts(), '0,0,0,0'); assert.equal(h.service.getPending(), null);
});

test('invalid transient source versions cannot bypass the source check', async () => {
  for (const sourceUpdatedAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null]) {
    const h = setup(); await assert.rejects(h.service.send({ ...h.request, sourceUpdatedAt }), /invalid_request/);
    assert.equal(h.counts(), '0,0,0,0');
  }
});

test('source revision during navigation prevents dispatch and history while retaining an explicit retry path', async () => {
  const h = setup(); h.onNavigate(async () => { h.change({ ...h.record, updatedAt: 101 }); });
  await assert.rejects(h.service.send(h.request), /source_changed/);
  assert.equal(h.counts(), '1,1,0,0'); assert.equal(h.service.getPending(), null);
  const response = await h.service.send({ ...h.request, sourceUpdatedAt: 101 });
  assert.equal(response.result.ok, true); assert.equal(h.counts(), '2,2,1,1');
});

test('source deletion during navigation prevents dispatch', async () => {
  const h = setup(); h.onNavigate(async () => { h.change(null); });
  await assert.rejects(h.service.send(h.request), /archive_not_found/); assert.equal(h.counts(), '1,1,0,0');
});

test('legacy internal requests remain compatible and a dispatched request is never repeated after a source change', async () => {
  const h = setup(); h.onSend(() => h.change({ ...h.record, updatedAt: 101 }));
  const { sourceUpdatedAt: ignored, ...request } = h.request;
  const response = await h.service.send(request);
  assert.equal(response.result.ok, true); assert.equal(h.counts(), '1,1,1,1');
  assert.equal(response.pending?.archiveId, h.record.id);
});
