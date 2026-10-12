// Synthetic proxy-state payloads for renderer tests and UI fixtures; no Electron bridge involved.
import type { ProxyStateView } from '../../src/renderer/proxy-form';
import { DEFAULT_PROXY_PREFERENCE, type ProxyPreference } from '../../src/shared/proxy-preference';

/** Canonical field order (version, mode, scheme, host, port, bypass, username) so isProxyPreference accepts it. */
export const customProxy: ProxyPreference = { version: 1, mode: 'custom', scheme: 'http', host: 'proxy.example', port: 8080, bypass: [], username: 'alice' };

export function proxyStateFixture(patch: Partial<ProxyStateView> = {}): ProxyStateView {
  return { applied: DEFAULT_PROXY_PREFERENCE, blocked: false, stored: 'ok', appliedResult: 'ok', pending: false, pendingConfirm: null,
    following: false, formValue: DEFAULT_PROXY_PREFERENCE, secret: 'none', encryption: true, linuxDesktopProxy: null, authFailed: false, ...patch };
}

/** Read-only proxy channels for fixtures that only need the settings card to render; `calls` records each getProxyState argument. */
export function proxyShellStubs(state: ProxyStateView = proxyStateFixture(), calls: unknown[] = []) {
  return { getProxyState: async (request?: unknown) => { calls.push(request); return state; }, onProxyState: () => () => {} };
}
