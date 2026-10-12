import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SettingsProxy } from '../src/renderer/settings-proxy';
import { setShellApi } from '../src/renderer/shell-api';
import { useProxyState } from '../src/renderer/use-proxy-state';
import type { ProxyStateView } from '../src/renderer/proxy-form';
import { formatCopy, getCopy } from '../src/shared/copy';
import { DEFAULT_PROXY_PREFERENCE } from '../src/shared/proxy-preference';
import { mountDom } from './ui/dom-harness';
import { customProxy, proxyStateFixture } from './ui/proxy-state-fixture';

const copy = getCopy('en');
const configured = proxyStateFixture({ applied: customProxy, formValue: customProxy, secret: 'saved' });
const pending = { scheme: 'socks5' as const, host: 'new.example', port: 1080, version: { updatedAt: 7, deviceId: 'remote' } };
type Call = { readonly method: string; readonly request: unknown };

// 外壳传入的 busy（群发、综合等进行中）在测试里可随时切换；同一文件内用例串行执行。
let changeBusy: (busy: boolean) => void = () => {};

function Card(props: { readonly onFeedback: (message: string) => void }) {
  const proxy = useProxyState({ secret: true }); // 与 settings-workspace.tsx 一致：设置卡这一处带密码读取标志
  const [busy, setBusy] = useState(false);
  changeBusy = setBusy;
  return <SettingsProxy copy={copy} proxy={proxy} busy={busy} onFeedback={props.onFeedback} />;
}

async function mountCard(state: ProxyStateView, api: Record<string, unknown> = {}) {
  const calls: Call[] = [], feedback: string[] = [];
  let current: unknown = state, listener: (value: unknown) => void = () => {};
  const reply = (method: string, value: unknown) => async (request?: unknown) => { calls.push({ method, request }); return value; };
  setShellApi({
    getProxyState: async () => current,
    onProxyState: (next: (value: unknown) => void) => { listener = next; return () => { listener = () => {}; }; },
    saveProxy: reply('saveProxy', { ok: true }), testProxy: reply('testProxy', { ok: true, ms: 12, route: 'proxy' }),
    acceptProxy: reply('acceptProxy', { ok: true }), followProxy: reply('followProxy', { ok: true }),
    reloadProxySites: reply('reloadProxySites', { ok: true, skipped: [] }),
    ...api
  } as any);
  const h = await mountDom(<Card onFeedback={message => feedback.push(message)} />);
  await settle();
  return { ...h, calls, feedback,
    push: async (value: unknown) => { current = value; await act(async () => listener(value)); await settle(); },
    busy: async (value: boolean) => { await act(async () => changeBusy(value)); },
    close: async () => { await h.close(); setShellApi(null); } };
}

const settle = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
const byId = <T extends HTMLElement>(doc: Document, id: string) => doc.getElementById(id) as T | null;
const button = (doc: Document, text: string) => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text) ?? null;
const press = async (node: HTMLElement) => { await act(async () => node.click()); await settle(); };
const choose = async (h: { window: any }, node: HTMLSelectElement, value: string) => {
  await act(async () => { node.value = value; node.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
};

test('the password is sent only after editing, and clearing the saved password sends null', async () => {
  const h = await mountCard(configured);
  try {
    const password = () => byId<HTMLInputElement>(h.document, 'settings-proxy-password')!;
    assert.equal(password() === null, false, 'custom mode must expose a password field');
    assert.equal(password().value, '', 'a saved password is never echoed');
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.calls.length, 1);
    assert.equal('password' in (h.calls[0].request as object), false, 'untouched password means no change');
    assert.deepEqual((h.calls[0].request as { value: unknown }).value, customProxy);
    await h.input(password(), 's3cret');
    await press(button(h.document, copy.proxySave)!);
    assert.equal((h.calls[1].request as { password?: unknown }).password, 's3cret');
    assert.equal(password().value, '', 'the field resets after a successful save');
    await h.input(password(), 'typo');
    await h.input(password(), '');
    await press(button(h.document, copy.proxySave)!);
    assert.equal('password' in (h.calls[2].request as object), false, 'an emptied field is never sent as ""');
    await press(button(h.document, copy.proxyClearPassword)!);
    assert.deepEqual(h.calls[3], { method: 'saveProxy', request: { value: customProxy, password: null } });
    assert.equal(h.feedback.at(-1), copy.proxyPasswordCleared);
  } finally { await h.close(); }
});

test('SOCKS disables credentials, clears the username and keeps the saved password untouched', async () => {
  const h = await mountCard(configured);
  try {
    await h.input(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!, 's3cret');
    const scheme = byId<HTMLSelectElement>(h.document, 'settings-proxy-scheme')!;
    await choose(h, scheme, 'socks4');
    assert.equal(h.document.querySelector('[data-proxy-hint="socks4"]') === null, false, 'SOCKS4 warns about local DNS');
    await choose(h, scheme, 'socks5');
    assert.equal(h.document.querySelector('[data-proxy-hint="socks4"]') === null, true);
    assert.equal(h.document.querySelector('[data-proxy-hint="socks"]')!.textContent, copy.proxySocksHint);
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-username')!.disabled, true);
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-username')!.value, '');
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!.disabled, true);
    assert.equal(button(h.document, copy.proxyClearPassword) === null, true, 'SOCKS has no credential controls');
    await press(button(h.document, copy.proxySave)!);
    const request = h.calls[0].request as { value: { scheme: string; username: string } };
    assert.equal(request.value.scheme, 'socks5');
    assert.equal(request.value.username, '');
    assert.equal('password' in request, false, 'switching to SOCKS must not clear the stored password');
  } finally { await h.close(); }
});

test('a pending sync confirmation disables save and offers apply or keep local', async () => {
  const h = await mountCard(proxyStateFixture({ ...configured, following: true, pendingConfirm: pending }));
  try {
    const save = button(h.document, copy.proxySave)!;
    assert.equal(save.disabled, true);
    assert.equal(save.getAttribute('aria-describedby'), 'settings-proxy-save-blocked');
    assert.equal(byId(h.document, 'settings-proxy-save-blocked')!.textContent, copy.proxySaveBlockedPending);
    assert.equal(byId(h.document, 'settings-proxy-pending')!.textContent,
      formatCopy(copy.proxyPendingBanner, { endpoint: 'new.example:1080', scheme: 'SOCKS5' }));
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-host')!.value, 'proxy.example', 'the form never prefills the unconfirmed address');
    assert.equal(h.document.querySelector('[data-proxy-source="sync"]') === null, false);
    assert.equal(button(h.document, copy.proxyClearPassword)!.disabled, true);
    await act(async () => { byId(h.document, 'settings-proxy-host')!.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle();
    assert.equal(h.calls.length, 0, 'Enter cannot bypass the disabled save');
    await press(button(h.document, copy.proxyPendingApply)!);
    assert.deepEqual(h.calls[0], { method: 'acceptProxy', request: pending });
    assert.equal(h.feedback.at(-1), copy.proxyAccepted);
    await press(button(h.document, copy.proxyPendingKeep)!);
    assert.deepEqual(h.calls[1], { method: 'followProxy', request: false });
    assert.equal(h.feedback.at(-1), copy.proxyKeptLocal);
  } finally { await h.close(); }
});

test('the Linux environment hint appears only for the system mode without a desktop proxy source', async () => {
  const cases = [['env', DEFAULT_PROXY_PREFERENCE, true], ['desktop', DEFAULT_PROXY_PREFERENCE, false],
    [null, DEFAULT_PROXY_PREFERENCE, false], ['env', customProxy, false]] as const;
  for (const [linux, value, shown] of cases) {
    const h = await mountCard(proxyStateFixture({ applied: value, formValue: value, linuxDesktopProxy: linux }));
    try {
      assert.equal(h.document.querySelector('[data-proxy-hint="linux-env"]') === null, !shown, `${linux}/${value.mode}`);
      if (value.mode === 'custom' && linux === 'env') {
        await h.click(byId<HTMLInputElement>(h.document, 'settings-proxy-mode-system')!);
        assert.equal(h.document.querySelector('[data-proxy-hint="linux-env"]')!.textContent, copy.proxyLinuxEnvHint);
      }
    } finally { await h.close(); }
  }
});

test('test connection reports direct routes and maps failures without touching saved settings', async () => {
  const replies: unknown[] = [{ ok: true, ms: 41.6, route: 'direct' }, { ok: false, result: 'proxy_auth_failed' }, new Error('proxy_test_busy'), { ok: true, ms: 9, route: 'proxy' }];
  const tests: unknown[] = [];
  const h = await mountCard(configured, { testProxy: async (request: unknown) => {
    tests.push(request); const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  } });
  try {
    await h.input(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!, 'pw');
    await press(button(h.document, copy.proxyTest)!);
    assert.deepEqual(tests[0], { value: customProxy, password: 'pw' });
    assert.equal(h.feedback.at(-1), formatCopy(copy.proxyTestDirect, { ms: 42 }));
    await press(button(h.document, copy.proxyTest)!);
    assert.equal(h.feedback.at(-1), formatCopy(copy.proxyAuthRejected, { endpoint: 'proxy.example:8080' }), 'a password prompt always names host:port');
    await press(button(h.document, copy.proxyTest)!);
    assert.equal(h.feedback.at(-1), copy.proxyResultTestBusy);
    await press(button(h.document, copy.proxyTest)!);
    assert.equal(h.feedback.at(-1), formatCopy(copy.proxyTestOk, { ms: 9 }));
    assert.equal(h.calls.length, 0, 'testing never saves');
  } finally { await h.close(); }
});

test('saving announces the result, reports password storage failure, and offers reloading every site', async () => {
  const saves: unknown[] = [{ ok: true, secret: 'failed' }, { ok: false, result: 'proxy_busy' }, new Error('proxy_busy'), { ok: false, result: 'proxy_apply_failed' }];
  const reloads: unknown[] = [{ ok: true, skipped: ['kimi', 'doubao'] }, { ok: false, result: 'proxy_busy' }, { ok: true, skipped: [] }];
  const h = await mountCard(configured, {
    saveProxy: async () => { const next = saves.shift(); if (next instanceof Error) throw next; return next; },
    reloadProxySites: async () => reloads.shift()
  });
  try {
    assert.equal(button(h.document, copy.proxyReload) === null, true, 'reload is offered only after a save');
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.feedback.at(-1), copy.proxySavedSecretFailed);
    const reload = () => button(h.document, copy.proxyReload)!;
    assert.equal(reload().getAttribute('aria-describedby'), 'settings-proxy-reload-hint');
    assert.equal(byId(h.document, 'settings-proxy-reload-hint')!.textContent, copy.proxyReloadHint);
    await press(reload());
    assert.equal(h.feedback.at(-1), formatCopy(copy.proxyReloadSkipped, { sites: `Kimi, ${copy.backupSiteDoubao}` }));
    await press(reload());
    assert.equal(h.feedback.at(-1), copy.proxyResultBusy, 'a busy reload explains why instead of a generic failure');
    await press(reload());
    assert.equal(h.feedback.at(-1), copy.proxyReloaded);
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.feedback.at(-1), copy.proxyResultBusy, 'proxy_busy reply');
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.feedback.at(-1), copy.proxyResultBusy, 'proxy_busy from a bridge-level throw');
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.feedback.at(-1), copy.proxyResultApplyFailed);
  } finally { await h.close(); }
});

test('an operation in progress disables proxy writes, explains why, and leaves testing available', async () => {
  const h = await mountCard(configured);
  try {
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.calls.length, 1);
    await h.busy(true);
    const save = button(h.document, copy.proxySave)!;
    assert.equal(save.disabled, true);
    assert.equal(save.getAttribute('aria-describedby'), 'settings-proxy-busy');
    assert.equal(byId(h.document, 'settings-proxy-busy')!.textContent, copy.proxyResultBusy);
    const reload = button(h.document, copy.proxyReload)!;
    assert.equal(reload.disabled, true, 'reloading every site is gated too (spec §3.4)');
    assert.equal(reload.getAttribute('aria-describedby'), 'settings-proxy-reload-hint settings-proxy-busy');
    assert.equal(button(h.document, copy.proxyClearPassword)!.disabled, true);
    assert.equal(button(h.document, copy.proxyTest)!.disabled, false, 'testing is not gated (spec §6.3)');
    await act(async () => { byId(h.document, 'settings-proxy-host')!.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle();
    assert.equal(h.calls.length, 1, 'Enter cannot bypass the busy save');
    await h.busy(false);
    assert.equal(button(h.document, copy.proxySave)!.disabled, false);
    assert.equal(byId(h.document, 'settings-proxy-busy') === null, true);
  } finally { await h.close(); }
});

test('a tripped credential breaker stays visible with host:port and is announced once', async () => {
  const h = await mountCard(configured);
  const rejected = formatCopy(copy.proxyAuthRejected, { endpoint: 'proxy.example:8080' });
  try {
    assert.equal(h.document.querySelector('[data-proxy-notice]') === null, true);
    await h.push({ ...configured, authFailed: true });
    assert.equal(h.document.querySelector('[data-proxy-notice="danger"]')!.textContent, rejected);
    assert.equal(h.feedback.at(-1), rejected);
    const count = h.feedback.length;
    await h.push({ ...configured, authFailed: true, secret: 'mismatch' });
    assert.equal(h.feedback.length, count, 'an unchanged breaker is not announced again');
    await h.push(configured);
    assert.equal(h.document.querySelector('[data-proxy-notice]') === null, true, 'the notice clears once the breaker resets');
  } finally { await h.close(); }
  const opened = await mountCard(proxyStateFixture({ ...configured, authFailed: true }));
  try {
    assert.equal(opened.document.querySelector('[data-proxy-notice="danger"]')!.textContent, rejected, 'shown on first render, not only after a push');
  } finally { await opened.close(); }
});

test('state pushes that the card did not cause are announced once', async () => {
  const h = await mountCard(configured);
  try {
    await h.push({ ...configured, pending: true });
    assert.equal(h.document.querySelector('[data-proxy-queued]')!.textContent, copy.proxyQueued);
    await h.push(configured);
    assert.equal(h.feedback.at(-1), copy.proxyQueueFlushed);
    await h.push({ ...configured, following: true, pendingConfirm: pending });
    const banner = formatCopy(copy.proxyPendingBanner, { endpoint: 'new.example:1080', scheme: 'SOCKS5' });
    assert.equal(h.feedback.at(-1), banner);
    const count = h.feedback.length;
    await h.push({ ...configured, following: true, pendingConfirm: { ...pending } });
    assert.equal(h.feedback.length, count, 'the same pending version is not announced twice');
  } finally { await h.close(); }
});

test('IME composition Enter never saves while a plain Enter does', async () => {
  const h = await mountCard(configured);
  try {
    const host = byId<HTMLInputElement>(h.document, 'settings-proxy-host')!;
    await act(async () => { host.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })); });
    await settle();
    assert.equal(h.calls.length, 0);
    await act(async () => { host.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle();
    assert.equal(h.calls.length, 1);
  } finally { await h.close(); }
});

test('invalid input stays local and the error is tied to the field', async () => {
  const h = await mountCard(configured);
  try {
    const host = byId<HTMLInputElement>(h.document, 'settings-proxy-host')!;
    await h.input(host, 'proxy example');
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.calls.length, 0);
    assert.equal(host.getAttribute('aria-invalid'), 'true');
    assert.equal(host.getAttribute('aria-describedby'), 'settings-proxy-error');
    assert.equal(byId(h.document, 'settings-proxy-error')!.textContent, copy.proxyErrorHost);
    assert.equal(h.document.activeElement === host, true, 'focus moves to the invalid field');
    assert.equal(h.feedback.at(-1), copy.proxyErrorHost);
    await h.input(host, 'proxy.example');
    assert.equal(host.hasAttribute('aria-invalid'), false);
    assert.equal(byId(h.document, 'settings-proxy-error') === null, true);
    await h.input(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!, 'a\u0001b');
    await press(button(h.document, copy.proxySave)!);
    assert.equal(h.calls.length, 0);
    assert.equal(byId(h.document, 'settings-proxy-error')!.textContent, copy.proxyErrorPassword);
  } finally { await h.close(); }
});

test('a URL or host:port pasted into the host field gets its own message and is never trimmed', async () => {
  const h = await mountCard(configured);
  try {
    const host = byId<HTMLInputElement>(h.document, 'settings-proxy-host')!;
    for (const pasted of ['http://127.0.0.1:7890', '127.0.0.1:7890', '[::1]:7890', 'user@proxy.example']) {
      await h.input(host, pasted);
      await press(button(h.document, copy.proxySave)!);
      assert.equal(h.calls.length, 0, `${pasted} never reaches IPC`);
      assert.equal(host.value, pasted, 'the input is kept as typed, not silently stripped');
      assert.equal(host.getAttribute('aria-invalid'), 'true');
      assert.equal(host.getAttribute('aria-describedby'), 'settings-proxy-error');
      assert.equal(byId(h.document, 'settings-proxy-error')!.textContent, copy.proxyErrorHostCombined, pasted);
      assert.equal(h.feedback.at(-1), copy.proxyErrorHostCombined);
    }
    await press(button(h.document, copy.proxyTest)!);
    assert.equal(h.calls.length, 0, 'testing runs the same check before any IPC');
    assert.equal(byId(h.document, 'settings-proxy-error')!.textContent, copy.proxyErrorHostCombined);
    assert.notEqual(copy.proxyErrorHostCombined, copy.proxyErrorHost);
  } finally { await h.close(); }
});

const moved = { ...customProxy, host: 'moved.example', port: 3128 };

test('a state push never overwrites unsaved edits; only status and the banner refresh', async () => {
  const h = await mountCard(configured);
  const host = () => byId<HTMLInputElement>(h.document, 'settings-proxy-host')!;
  const banner = formatCopy(copy.proxyPendingBanner, { endpoint: 'new.example:1080', scheme: 'SOCKS5' });
  try {
    await h.input(host(), 'edited.example');
    await h.input(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!, 'pw');
    await h.push({ ...configured, applied: moved, formValue: moved, pending: true });
    assert.equal(host().value, 'edited.example', 'the field being edited is kept');
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-port')!.value, '8080', 'untouched draft fields stay where the edit started');
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!.value, 'pw', 'a typed password survives the push');
    assert.equal(h.document.querySelector('[data-proxy-queued]')!.textContent, copy.proxyQueued, 'the status area still updates');
    assert.equal(byId(h.document, 'settings-proxy-stale')!.textContent, copy.proxyEditsKept);
    assert.equal(button(h.document, copy.proxySave)!.getAttribute('aria-describedby'), 'settings-proxy-stale');
    assert.equal(h.feedback.at(-1), copy.proxyEditsKept, 'the conflict is announced by the push');
    await h.push({ ...configured, applied: moved, formValue: moved, following: true, pendingConfirm: pending });
    assert.equal(byId(h.document, 'settings-proxy-pending')!.textContent, banner, 'the banner still updates');
    assert.equal(h.document.querySelector('[data-proxy-source="sync"]') === null, false);
    assert.equal(host().value, 'edited.example');
    assert.equal(h.feedback.at(-1), banner, 'an unchanged saved value is not announced as a conflict again');
    await h.push({ ...configured, applied: moved, formValue: moved, following: true });
    await press(button(h.document, copy.proxySave)!);
    assert.deepEqual(h.calls[0], { method: 'saveProxy', request: { value: { ...customProxy, host: 'edited.example' }, password: 'pw' } },
      'saving sends exactly what the user typed');
    assert.equal(h.document.querySelector('[data-proxy-stale]') === null, true, 'a successful save clears the draft');
    assert.equal(h.feedback.at(-1), copy.proxySaved);
  } finally { await h.close(); }
});

test('without unsaved edits a push re-prefills the form, and discarding edits shows the new value', async () => {
  const h = await mountCard(configured);
  const host = () => byId<HTMLInputElement>(h.document, 'settings-proxy-host')!;
  try {
    await h.push({ ...configured, applied: moved, formValue: moved });
    assert.equal(host().value, 'moved.example');
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-port')!.value, '3128');
    assert.equal(h.document.querySelector('[data-proxy-stale]') === null, true);
    assert.equal(h.feedback.includes(copy.proxyEditsKept), false, 'a clean form is not a conflict');
    await h.input(host(), 'typo.example');
    await h.input(host(), 'moved.example');
    await h.push(configured);
    assert.equal(host().value, 'proxy.example', 'an edit reverted to where it started is not an unsaved edit');
    assert.equal(h.document.querySelector('[data-proxy-stale]') === null, true);
    await h.input(host(), 'edited.example');
    await h.push({ ...configured, applied: moved, formValue: moved });
    assert.equal(host().value, 'edited.example');
    await press(button(h.document, copy.proxyDiscardEdits)!);
    assert.equal(host().value, 'moved.example', 'discarding shows the value that arrived meanwhile');
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-port')!.value, '3128');
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!.value, '');
    assert.equal(h.document.querySelector('[data-proxy-stale]') === null, true);
    assert.equal(h.document.activeElement === byId(h.document, 'settings-proxy-title'), true, 'focus does not fall to the body');
    assert.equal(h.calls.length, 0, 'discarding never writes');
  } finally { await h.close(); }
});

test('password state, plaintext warning and damaged storage are explained without echoing secrets', async () => {
  const views = [
    [proxyStateFixture({ ...configured, secret: 'mismatch' }), formatCopy(copy.proxySecretReenter, { endpoint: 'proxy.example:8080' })],
    [proxyStateFixture({ ...configured, secret: 'memory', encryption: false }), `${copy.proxySecretMemory} ${copy.proxyNoSecureStorage}`]
  ] as const;
  for (const [state, text] of views) {
    const h = await mountCard(state);
    try {
      assert.equal(h.document.querySelector('[data-proxy-secret]')!.textContent, text);
      assert.equal(h.document.querySelector('[data-proxy-hint="plaintext"]')!.textContent, copy.proxyPlaintextHint);
    } finally { await h.close(); }
  }
  const none = await mountCard(proxyStateFixture({ ...configured, secret: 'none' }));
  try { assert.equal(button(none.document, copy.proxyClearPassword) === null, true); } finally { await none.close(); }
  const damaged = await mountCard(proxyStateFixture({ stored: 'invalid', blocked: true, applied: null, appliedResult: 'proxy_apply_failed' }));
  try { assert.equal(damaged.document.querySelector('[data-proxy-notice="danger"]')!.textContent, copy.proxyStoredInvalid); } finally { await damaged.close(); }
});

test('an unreadable bridge degrades to a notice and recovers on the next push', async () => {
  const h = await mountCard([] as unknown as ProxyStateView);
  try {
    assert.equal(h.document.body.textContent!.includes(copy.proxyUnavailable), true);
    assert.equal(byId(h.document, 'settings-proxy-title') === null, false, 'section navigation keeps a target');
    await h.push(configured);
    assert.equal(byId(h.document, 'settings-proxy-host') === null, false);
  } finally { await h.close(); }
  const missing = await mountCard(configured, { getProxyState: undefined, onProxyState: undefined });
  try { assert.equal(missing.document.body.textContent!.includes(copy.proxyUnavailable), true); } finally { await missing.close(); }
});

test('rejected reload and test calls show generic failure copy and never the error text', async () => {
  const h = await mountCard(configured, {
    saveProxy: async () => ({ ok: true }),
    reloadProxySites: async () => { throw new Error('timed_out'); },
    testProxy: async () => { throw new Error('connect ECONNREFUSED 10.0.0.9:8080 secret-token'); }
  });
  try {
    await press(button(h.document, copy.proxySave)!);
    await press(button(h.document, copy.proxyReload)!);
    assert.equal(h.feedback.at(-1), copy.proxyResultUnknown, 'a reload rejection is a generic failure');
    await press(button(h.document, copy.proxyTest)!);
    assert.equal(h.feedback.at(-1), copy.proxyResultUnknown, 'a test rejection is a generic failure');
    assert.equal(h.document.body.textContent!.includes('ECONNREFUSED'), false, 'the raw error text never reaches the page');
    assert.equal(h.feedback.some(message => message.includes('timed_out') || message.includes('ECONNREFUSED')), false);
  } finally { await h.close(); }
});

test('a password mismatch is not surfaced while the applied proxy is not custom', async () => {
  const h = await mountCard(proxyStateFixture({ secret: 'mismatch' }));
  const reenter = formatCopy(copy.proxySecretReenter, { endpoint: ':0' });
  try {
    await h.click(byId<HTMLInputElement>(h.document, 'settings-proxy-mode-custom')!);
    assert.equal(byId(h.document, 'settings-proxy-password') === null, false, 'custom mode shows the credential fields');
    assert.equal(h.document.body.textContent!.includes(copy.proxySecretReenter.split('{endpoint}')[0]), false, 'no re-enter prompt for a system/direct proxy');
    assert.equal(h.document.body.textContent!.includes(reenter), false);
    assert.equal(byId<HTMLInputElement>(h.document, 'settings-proxy-password')!.hasAttribute('aria-describedby'), false,
      'the password field never points at a missing description');
  } finally { await h.close(); }
});
