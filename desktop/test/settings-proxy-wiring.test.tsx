import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PolyAskDesktopApi } from '../src/preload/shell';
import { FeedbackProvider } from '../src/renderer/feedback-provider';
import { PreferenceSyncSettings } from '../src/renderer/preference-sync-settings';
import { setShellApi } from '../src/renderer/shell-api';
import { useProxyPendingNotice, useProxyState } from '../src/renderer/use-proxy-state';
import type { PreferenceSyncSettingsState } from '../src/renderer/use-synced-preferences';
import type { ProxyStateView } from '../src/renderer/proxy-form';
import { formatCopy, getCopy } from '../src/shared/copy';
import { readSource } from './fixtures';
import { mountDom } from './ui/dom-harness';
import { customProxy, proxyShellStubs, proxyStateFixture } from './ui/proxy-state-fixture';
import { mountSettings, settingsButton, settingsElement, settingsShell } from './ui/settings-dom';

const copy = getCopy('en');
const configured = proxyStateFixture({ applied: customProxy, formValue: customProxy, secret: 'saved' });
const pending = { scheme: 'socks5' as const, host: 'new.example', port: 1080, version: { updatedAt: 7, deviceId: 'remote' } };
const settle = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 20)));

function SyncHost() {
  const proxy = useProxyState();
  return <PreferenceSyncSettings copy={copy} snapshot={null} busy={false} proxy={proxy}
    onFollowingChange={async () => {}} onLayoutModeChange={async () => {}} onDraftSyncChange={async () => {}} />;
}

async function mountRow(state: ProxyStateView, followProxy: (enabled: boolean) => Promise<unknown>) {
  setShellApi({ ...proxyShellStubs(state), followProxy } as any);
  const h = await mountDom(<SyncHost />);
  await settle();
  const row = () => h.document.querySelector<HTMLFieldSetElement>('[data-preference-group="proxy"]');
  return { ...h, row, close: async () => { await h.close(); setShellApi(null); } };
}

test('the sync settings proxy row follows through proxy-follow and shows only the mode name', async () => {
  const calls: boolean[] = [];
  const replies: unknown[] = [{ ok: true }, { ok: false, result: 'proxy_invalid' }];
  const h = await mountRow(configured, async enabled => { calls.push(enabled); return replies.shift(); });
  try {
    assert.equal(h.row() === null, false, 'the proxy group must be listed with the other follow groups');
    assert.equal(h.row()!.querySelector('[data-preference-current]')!.textContent, copy.proxyModeCustom);
    assert.equal(h.row()!.querySelector('[data-preference-source]')!.textContent, copy.preferenceSyncSourceLocal);
    assert.equal(h.document.body.textContent!.includes('proxy.example'), false, 'the host is never shown in sync settings');
    assert.equal(h.row()!.querySelector('legend')!.textContent, copy.proxySyncTitle);
    await h.click(h.row()!.querySelector<HTMLInputElement>('input[value="shared"]')!);
    await settle();
    assert.deepEqual(calls, [true]);
    assert.equal(h.row()!.querySelector('[role="alert"]') === null, true);
    await h.click(h.row()!.querySelector<HTMLInputElement>('input[value="shared"]')!);
    await settle();
    assert.deepEqual(calls, [true, true]);
    assert.equal(h.row()!.querySelector('[role="alert"]')!.textContent, copy.proxySyncFixFirst);
  } finally { await h.close(); }
});

test('a blocked or damaged proxy disables following in both directions', async () => {
  const calls: boolean[] = [];
  const h = await mountRow(proxyStateFixture({ blocked: true, stored: 'invalid', applied: null, appliedResult: 'proxy_apply_failed' }),
    async enabled => { calls.push(enabled); return { ok: true }; });
  try {
    assert.equal(h.row()!.disabled, true);
    assert.equal(h.document.getElementById('settings-follow-proxy-hint')!.textContent, copy.proxySyncFixFirst);
    await h.click(h.row()!.querySelector<HTMLInputElement>('input[value="shared"]')!);
    assert.deepEqual(calls, []);
  } finally { await h.close(); }
});

test('a corrupt synced value that this device does not follow leaves the row usable', async () => {
  // runtime 只在跟随时把损坏的 S 报成 stored=invalid；不跟随时报 ok，行必须可用，才能改为跟随后用本机设置修复。
  const calls: boolean[] = [];
  const h = await mountRow(proxyStateFixture({ ...configured, following: false, stored: 'ok' }), async enabled => { calls.push(enabled); return { ok: true }; });
  try {
    assert.equal(h.row()!.disabled, false);
    assert.equal(h.document.getElementById('settings-follow-proxy-hint')!.textContent, copy.proxySyncHint);
    await h.click(h.row()!.querySelector<HTMLInputElement>('input[value="shared"]')!);
    await settle();
    assert.deepEqual(calls, [true]);
  } finally { await h.close(); }
});

test('settings navigation lists the proxy card between confirmations and updates and focuses its heading', async () => {
  const h = await mountSettings({ confirmations: { sitePageCloseConfirm: true, newSessionConfirm: true }, onConfirmationChange: () => {} });
  try {
    await settle();
    const sections = [...h.document.querySelectorAll('[data-settings-section]')].map(node => node.getAttribute('data-settings-section'));
    assert.deepEqual(sections.slice(sections.indexOf('confirmations'), sections.indexOf('updates') + 1), ['confirmations', 'proxy', 'updates']);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-settings-section="proxy"]')!);
    assert.equal(h.document.activeElement === h.document.getElementById('settings-proxy-title'), true);
  } finally { await h.close(); }
  const requested = await mountSettings({ initialSection: 'proxy', sectionRequest: 1 });
  try {
    await settle();
    assert.equal(requested.document.activeElement === requested.document.getElementById('settings-proxy-title'), true);
  } finally { await requested.close(); }
});

test('proxy results reach the settings status line and the shell live announcement', async () => {
  const announced: string[] = [];
  const h = await mountSettings({ onAnnounce: message => { announced.push(message); } });
  settingsShell({ saveProxy: async () => ({ ok: true }) });
  try {
    await settle();
    await h.click(settingsButton(h.document, copy.proxySave));
    await settle();
    assert.equal(h.document.querySelector('footer[role="status"][aria-live="polite"]')!.textContent, copy.proxySaved);
    assert.equal(announced.at(-1), copy.proxySaved);
  } finally { await h.close(); }
});

test('a send or synthesis in progress disables proxy writes inside settings and says why', async () => {
  const h = await mountSettings({ operationBusy: true });
  try {
    await settle();
    assert.equal(settingsButton(h.document, copy.proxySave).disabled, true);
    assert.equal(settingsButton(h.document, copy.proxySave).getAttribute('aria-describedby'), 'settings-proxy-busy');
    assert.equal(h.document.getElementById('settings-proxy-busy')!.textContent, copy.proxyResultBusy);
    assert.equal(settingsButton(h.document, copy.proxyTest).disabled, false, 'testing is not gated (spec §6.3)');
  } finally { await h.close(); }
});

test('a new sync confirmation raises one shell notice with a settings entry', async () => {
  const opened: string[] = [];
  let push: (value: unknown) => void = () => {};
  setShellApi({ getProxyState: async () => proxyStateFixture({ ...configured, following: true, pendingConfirm: pending }),
    onProxyState: (listener: (value: unknown) => void) => { push = listener; return () => {}; } } as any);
  function Probe() { useProxyPendingNotice(copy, () => { opened.push('proxy'); }); return null; }
  const h = await mountDom(<FeedbackProvider copy={copy}><Probe /></FeedbackProvider>);
  const notice = () => h.document.querySelector('.feedback-notice')!.textContent;
  const action = () => [...h.document.querySelectorAll<HTMLButtonElement>('.feedback-bar button')].find(node => node.textContent === copy.proxyNoticeOpen) ?? null;
  try {
    await settle();
    assert.equal(notice(), formatCopy(copy.proxyNoticePending, { endpoint: 'new.example:1080' }));
    await h.click(action()!);
    assert.deepEqual(opened, ['proxy']);
    assert.equal(action() === null, true, 'the entry is single-use');
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.feedback-bar button')].find(node => node.textContent === copy.dismissFeedback)!);
    await act(async () => push(proxyStateFixture({ ...configured, following: true, pendingConfirm: { ...pending } })));
    assert.equal(notice(), copy.feedbackReady, 'the same pending version is not announced again');
    await act(async () => push(proxyStateFixture({ ...configured, following: true, pendingConfirm: { ...pending, version: { updatedAt: 8, deviceId: 'remote' } } })));
    assert.equal(notice(), formatCopy(copy.proxyNoticePending, { endpoint: 'new.example:1080' }));
  } finally { await h.close(); setShellApi(null); }
});

test('only the settings workspace asks proxy-state to read the saved password', async () => {
  const settingsCalls: unknown[] = [];
  settingsShell(proxyShellStubs(configured, settingsCalls));
  const settings = await mountDom(settingsElement());
  try {
    await settle();
    assert.deepEqual(settingsCalls, [{ secret: true }], 'the settings workspace subscribes once, with the secret flag');
  } finally { await settings.close(); setShellApi(null); }
  const shellCalls: unknown[] = [];
  setShellApi({ ...proxyShellStubs(configured, shellCalls), followProxy: async () => ({ ok: true }) } as any);
  function Probe() { useProxyPendingNotice(copy, () => {}); return null; }
  const h = await mountDom(<FeedbackProvider copy={copy}><Probe /><SyncHost /></FeedbackProvider>);
  try {
    await settle();
    assert.deepEqual(shellCalls, [undefined, undefined], 'the shell notice and a flagless useProxyState never trigger the password read');
  } finally { await h.close(); setShellApi(null); }
});

test('the app routes the pending notice to the proxy settings section', () => {
  const app = readSource('src/renderer/index.tsx');
  // 只比较布尔值：失败时不把整份 index.tsx 打进断言消息。
  assert.equal(/useProxyPendingNotice\(copy, \(\) => openSettings\("proxy"\)\);/.test(app), true, 'App must route the notice to the proxy section');
  assert.equal(/section: "overview" \| "drive-diagnostics" \| "data" \| "display" \| "proxy"/.test(app), true, 'settings sections must accept "proxy"');
  assert.equal(/<SettingsWorkspace [^\n]*operationBusy=\{runState !== "idle" \|\| auxiliaryBusy \|\| participation\.pending\}/.test(app), true,
    'settings must receive the shell busy state so proxy writes are disabled during a send');
});

// C2：通用跟随通道的类型收窄到通用分组，代理行无法误走 preferences-follow；类型放宽时 tsc 会报「未使用的 @ts-expect-error」。
// @ts-expect-error the preload generic follow channel never carries the proxy group
const genericFollowGroup: Parameters<PolyAskDesktopApi['followPreferences']>[0] = 'proxy';
// @ts-expect-error the settings follow callback never carries the proxy group
const settingsFollowGroup: Parameters<PreferenceSyncSettingsState['onFollowingChange']>[0] = 'proxy';
void genericFollowGroup; void settingsFollowGroup;
