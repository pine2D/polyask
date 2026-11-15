import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectBroadcastSite } from '../src/renderer/broadcast-site-inspection';
import { viewManagerHarness } from './view-manager-harness';

test('inspection checks current selection without silently selecting or focusing another site', async () => {
  const selected = new Set(['chatgpt']);
  const focused: string[] = [], unavailable: string[] = [];
  const options = {isSelected: (site: string) => selected.has(site),
    focus: async (site: string) => { focused.push(site); return true; }, unavailable: (site: string) => { unavailable.push(site); }};
  await inspectBroadcastSite('claude', options);
  assert.deepEqual(focused, []);
  assert.deepEqual(unavailable, ['claude']);
  assert.deepEqual([...selected], ['chatgpt']);
  selected.add('claude');
  await inspectBroadcastSite('claude', options);
  assert.deepEqual(focused, ['claude']);
});

test('a main-process rejection is visible even when renderer selection is stale', async () => {
  const unavailable: string[] = [];
  await inspectBroadcastSite('claude', {isSelected: () => true, focus: async () => false,
    unavailable: site => { unavailable.push(site); }});
  assert.deepEqual(unavailable, ['claude']);
});

test('a malformed inspection acknowledgement fails closed', async () => {
  let unavailable = 0;
  await inspectBroadcastSite('claude', {isSelected: () => true, focus: async () => [] as unknown as boolean,
    unavailable: () => { unavailable++; }});
  assert.equal(unavailable, 1);
});

test('a departed inspection reply cannot change the newer surface', async () => {
  let release: (accepted: boolean) => void = () => {};
  const response = new Promise<boolean>(resolve => { release = resolve; });
  let active = true, unavailable = 0;
  const pending = inspectBroadcastSite('claude', {isSelected: () => true, focus: () => response,
    unavailable: () => { unavailable++; }, active: () => active});
  active = false; release(false); await pending;
  assert.equal(unavailable, 0);
});

test('ViewManager refuses a stale focus request for a site outside current selection', () => {
  const h = viewManagerHarness({ sites: ['chatgpt'] });
  let focuses = 0;
  h.views[0].focus = () => { focuses++; };
  try {
    const accepted = h.manager.setLayout('focus', 'claude');
    assert.equal(accepted, false);
    assert.equal(focuses, 0);
    assert.equal(h.manager.getLayout().mode, 'overview');
    assert.equal(h.manager.getLayout().focused, 'chatgpt');
  } finally {
    h.window.emit('closed');
  }
});

test('ViewManager acknowledges only a successfully selected focus target', () => {
  const h = viewManagerHarness({ sites: ['claude'] });
  let focuses = 0;
  h.views[0].focus = () => { focuses++; };
  try {
    const accepted = h.manager.setLayout('focus', 'claude');
    assert.equal(accepted, true);
    assert.equal(focuses, 1);
    assert.equal(h.manager.getLayout().focused, 'claude');
  } finally {
    h.window.emit('closed');
  }
});
