import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import type { SiteKey } from '../src/shared/contracts';
import { useSiteParticipation } from '../src/renderer/use-site-participation';
import { mountDom } from './ui/dom-harness';

async function fixture(initial: readonly SiteKey[] = ['kimi']) {
  let controller!: ReturnType<typeof useSiteParticipation>;
  let publish!: (sites: readonly SiteKey[]) => void;
  const calls: { sites: readonly SiteKey[]; finish(): void; fail(): void }[] = [];
  function Fixture() {
    const [saved, setSaved] = useState(initial); publish = setSaved;
    controller = useSiteParticipation({ opened: ['claude', 'kimi'], ready: true, onError: () => {},
      openPages: async sites => sites,
      ...{ saved, save: (sites: readonly SiteKey[]) => new Promise<readonly SiteKey[]>((resolve, reject) => {
        calls.push({ sites, finish: () => { setSaved(sites); resolve(sites); }, fail: () => reject(new Error('failed')) });
      }) } });
    return <span>{controller.participating.join(',')}</span>;
  }
  return { ...await mountDom(<Fixture />), controller: () => controller, publish, calls };
}

test('bootstrap restores saved exclusions and remote sync updates subsequent send membership', async () => {
  const h = await fixture();
  try {
    assert.deepEqual(h.controller().currentSites(), ['kimi']);
    await act(async () => h.publish([]));
    assert.deepEqual(h.controller().currentSites(), []);
    await act(async () => h.publish(['claude']));
    assert.deepEqual(h.controller().currentSites(), ['claude']);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test('toggling an open page saves without closing it and remains pending until the save acknowledgement', async () => {
  const h = await fixture(['claude', 'kimi']);
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.controller().change(['kimi']); });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].sites, ['kimi']);
    assert.equal(h.controller().pending, true);
    assert.deepEqual(h.controller().opened, ['claude', 'kimi']);
    await act(async () => { h.calls[0].finish(); assert.equal(await operation, true); });
    assert.equal(h.controller().pending, false);
    assert.deepEqual(h.controller().currentSites(), ['kimi']);
  } finally { await h.close(); }
});

test('save failure restores accepted membership instead of claiming it was saved', async () => {
  const h = await fixture(['claude', 'kimi']);
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.controller().change([]); });
    assert.equal(h.calls.length, 1);
    await act(async () => { h.calls[0].fail(); assert.equal(await operation, false); });
    assert.deepEqual(h.controller().currentSites(), ['claude', 'kimi']);
    assert.equal(h.controller().pending, false);
  } finally { await h.close(); }
});
