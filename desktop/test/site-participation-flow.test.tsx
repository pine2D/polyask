import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import type { SiteKey } from '../src/shared/contracts';
import { useSiteParticipation } from '../src/renderer/use-site-participation';
import { mountDom } from './ui/dom-harness';

async function fixture() {
  let controller!: ReturnType<typeof useSiteParticipation>;
  let publish!: (sites: readonly SiteKey[]) => void, busy!: (value: boolean) => void;
  let actual: readonly SiteKey[] = ['claude', 'kimi'], errors = 0;
  const calls: Array<{ sites: readonly SiteKey[]; finish(sites: readonly SiteKey[]): void; fail(): void }> = [];
  function Fixture() {
    const [opened, setOpened] = useState(actual), [blocked, setBlocked] = useState(false);
    actual = opened; publish = setOpened; busy = setBlocked;
    controller = useSiteParticipation({ opened, ready: true, busy: blocked, onError: () => { errors++; },
      openPages: sites => new Promise((resolve, reject) => {
        const index = calls.length;
        calls.push({ sites,
          finish: next => { if (index === calls.length - 1) { setOpened(next); resolve(next); } else resolve(actual); },
          fail: () => reject(new Error('failed')) });
      }) });
    return <span>{controller.participating.join(',')}</span>;
  }
  const h = await mountDom(<Fixture />);
  return { ...h, controller: () => controller, publish, busy, calls, errors: () => errors };
}

test('exclusion survives rebootstrap and external additions; external removal trims membership', async () => {
  const h = await fixture();
  try {
    assert.deepEqual(h.controller().currentSites(), ['claude', 'kimi']);
    await act(async () => { await h.controller().change(['claude']); });
    assert.equal(h.calls.length, 0);
    await act(async () => h.publish(['claude', 'kimi']));
    assert.deepEqual(h.controller().participating, ['claude']);
    await act(async () => h.publish(['claude', 'kimi', 'gemini']));
    assert.deepEqual(h.controller().excluded, ['kimi', 'gemini']);
    await act(async () => h.publish(['kimi', 'gemini']));
    assert.deepEqual(h.controller().currentSites(), []);
  } finally { await h.close(); }
});

test('an own workspace push before ACK does not reset exclusion or prematurely include a missing page', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.controller().change(['gemini', 'kimi']); });
    assert.deepEqual(h.calls[0].sites, ['claude', 'kimi', 'gemini']);
    assert.deepEqual(h.controller().currentSites(), ['kimi']);
    assert.equal(h.controller().pending, true);
    await act(async () => h.publish(['claude', 'kimi', 'gemini']));
    assert.deepEqual(h.controller().participating, ['kimi']);
    await act(async () => { h.calls[0].finish(['claude', 'kimi', 'gemini']); assert.equal(await operation, true); });
    assert.deepEqual(h.controller().participating, ['gemini', 'kimi']);
    assert.deepEqual(h.controller().excluded, ['claude']);
    assert.equal(h.controller().pending, false);
  } finally { await h.close(); }
});

test('reversed open acknowledgements cannot restore an older desired group', async () => {
  const h = await fixture();
  try {
    let first!: Promise<boolean>, second!: Promise<boolean>;
    await act(async () => { first = h.controller().change(['gemini']); });
    await act(async () => { second = h.controller().change(['deepseek']); });
    assert.deepEqual(h.calls[1].sites, ['claude', 'kimi', 'gemini', 'deepseek']);
    await act(async () => { h.calls[1].finish(h.calls[1].sites); await second; });
    await act(async () => { h.calls[0].finish(h.calls[0].sites); assert.equal(await first, false); });
    assert.deepEqual(h.controller().participating, ['deepseek']);
    assert.deepEqual(h.controller().opened, ['claude', 'kimi', 'gemini', 'deepseek']);
    assert.equal(h.controller().pending, false);
  } finally { await h.close(); }
});

test('failed opening leaves missing pages excluded and never retries automatically', async () => {
  const h = await fixture();
  try {
    let operation!: Promise<boolean>;
    await act(async () => { operation = h.controller().change(['gemini', 'kimi']); });
    await act(async () => { h.calls[0].fail(); assert.equal(await operation, false); });
    assert.deepEqual(h.controller().participating, ['kimi']);
    assert.deepEqual(h.controller().opened, ['claude', 'kimi']);
    assert.equal(h.errors(), 1);
    assert.equal(h.calls.length, 1);
  } finally { await h.close(); }
});

test('clearing while a page opens retains the page but cannot add it to a later send', async () => {
  const h = await fixture();
  try {
    let old!: Promise<boolean>;
    await act(async () => { old = h.controller().change(['gemini']); });
    await act(async () => { await h.controller().change([]); });
    await act(async () => { h.calls[0].finish(h.calls[0].sites); await old; });
    assert.deepEqual(h.controller().currentSites(), []);
    assert.deepEqual(h.controller().opened, ['claude', 'kimi', 'gemini']);
    assert.equal(h.calls.length, 1);
  } finally { await h.close(); }
});

test('page ordering changes participant order without adding excluded pages; busy actions do nothing', async () => {
  const h = await fixture();
  try {
    await act(async () => { await h.controller().change(['claude']); });
    let order!: Promise<boolean>;
    await act(async () => { order = h.controller().reorderOpened(['kimi', 'claude']); });
    await act(async () => { h.calls[0].finish(['kimi', 'claude']); await order; });
    assert.deepEqual(h.controller().currentSites(), ['claude']);
    await act(async () => h.busy(true));
    await act(async () => { assert.equal(await h.controller().change(['kimi']), false); });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.controller().opened, ['kimi', 'claude']);
  } finally { await h.close(); }
});

test('reset invalidates a pending desired update instead of accepting its late acknowledgement', async () => {
  const h = await fixture();
  try {
    let old!: Promise<boolean>;
    await act(async () => { old = h.controller().change(['gemini']); });
    await act(async () => h.controller().reset());
    await act(async () => { h.calls[0].finish(h.calls[0].sites); assert.equal(await old, false); });
    assert.deepEqual(h.controller().participating, ['claude', 'kimi']);
    assert.equal(h.controller().participating.includes('gemini'), false);
  } finally { await h.close(); }
});
