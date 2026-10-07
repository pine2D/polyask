import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { SiteHealthPanel } from '../src/renderer/site-health';
import { siteRecoveryAdvice } from '../src/renderer/site-health-recovery';
import { getCopy } from '../src/shared/copy';
import { SETTINGS_RECOVERY_COPY } from '../src/shared/settings-recovery-copy';
import type { SiteHealth, SiteDiagnosticCheck } from '../src/shared/site-health';
import type { SiteStatus } from '../src/shared/protocol';
import { mountDom } from './ui/dom-harness';

const noop = () => {};
const copy = { ...getCopy('en'), ...SETTINGS_RECOVERY_COPY.en };
const site = { key: 'claude', label: 'Claude', host: 'claude.ai', url: 'https://claude.ai/new', authHosts: [], image: true, intl: true } as const;
const check = (kind: string | undefined, name = 'Synthetic check'): SiteDiagnosticCheck => ({ kind, name, ok: false } as SiteDiagnosticCheck);
const health = (patch: Partial<SiteHealth> = {}): SiteHealth => ({ site: 'claude', state: 'ready', page: 'ready', checks: [{ name: 'Reach', kind: 'reach', ok: true }], ...patch });
const status = (patch: Partial<SiteStatus> = {}): SiteStatus => ({ site: 'claude', phase: 'ready', ...patch });
function element(current: SiteHealth, phase: SiteStatus = status(), actions: Record<string, any> = {}, locale = 'en') {
  const local = locale === 'en' ? copy : { ...getCopy(locale), ...SETTINGS_RECOVERY_COPY[locale === 'zh-CN' ? 'zhCN' : 'zhTW'] };
  return <SiteHealthPanel copy={local} sites={[site]} statuses={{ claude: phase }} health={{ claude: current }} detail="claude"
    checking={false} onDetail={noop} onCheck={noop} onFocus={noop} onReload={noop} onHardReload={noop}
    onClearData={noop} onCopyReport={noop} onBack={noop} {...actions} />;
}

test('recovery first step follows machine evidence priority across locale and renamed checks', async () => {
  const cases: [SiteHealth, SiteStatus, string, string][] = [
    [health({ page: 'error' }), status({ phase: 'generating' }), 'busy', 'focus'],
    [health({ recent: { phase: 'sending' }, state: 'sign-in' }), status(), 'busy', 'focus'],
    [health({ state: 'sign-in' }), status({ code: 'submit_unconfirmed' }), 'unconfirmed', 'focus'],
    [health({ recent: { phase: 'warning', code: 'generation_unconfirmed' } }), status(), 'unconfirmed', 'focus'],
    [health({ state: 'sign-in', page: 'error' }), status(), 'sign-in', 'focus'],
    [health({ page: 'error', checks: [check('reach')] }), status(), 'page', 'reload'],
    [health(), status({ phase: 'failed', code: 'load_failed' }), 'page', 'reload'],
    [health(), status({ phase: 'crashed', code: 'renderer_crashed' }), 'page', 'reload'],
    [health({ checks: [check('control'), check('reach'), check('probe')] }), status(), 'reach', 'focus'],
    [health({ checks: [check('control'), check('probe')] }), status(), 'control', 'focus'],
    [health({ checks: [check(undefined)] }), status(), 'control', 'focus'],
    [health({ checks: [check('future-kind')] }), status(), 'control', 'focus'],
    [health({ checks: [check('probe'), check('tier')] }), status(), 'probe', 'check'],
    [health(), status({ code: 'adapter_unavailable' }), 'probe', 'check'],
    [health(), status({ code: 'invalid_response' }), 'probe', 'check'],
    [health({ checks: [check('tier'), check('capture')] }), status(), 'tier', 'focus'],
    [health({ checks: [check('capture')] }), status(), 'capture', 'focus'],
    [health({ state: 'unknown', checks: [] }), status({ code: 'future-code' }), 'unknown', 'check'],
    [health({ checks: [] }), status(), 'unknown', 'check'],
    [health(), status(), 'ready', 'focus']
  ];
  const h = await mountDom(element(cases[0][0], cases[0][1]));
  try {
    for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const [current, phase, reason, action] of cases) {
      await h.render(element({ ...current, checks: current.checks.map(item => ({ ...item, name: `renamed-${locale}` })) }, phase, {}, locale));
      const first = h.document.querySelector<HTMLElement>('.health-first-step');
      assert.equal(first === null, false, 'the detail view must recommend a safe manual first step');
      assert.equal(first!.dataset.reason, reason);
      assert.equal(first!.querySelector('button')!.dataset.recoveryAction, action);
    }
  } finally { await h.close(); }
});

test('first step and folded recovery actions use only existing manual callbacks', async () => {
  const calls: string[] = [];
  const actions = { onFocus: (key: string) => calls.push(`focus:${key}`), onCheck: (keys: string[]) => calls.push(`check:${keys.join()}`),
    onReload: (key: string) => calls.push(`reload:${key}`), onHardReload: (key: string) => calls.push(`hard:${key}`),
    onClearData: (key: string) => calls.push(`cache:${key}`), onCopyReport: () => calls.push('report') };
  const h = await mountDom(element(health({ checks: [check('control')] }), status(), actions));
  try {
    const first = h.document.querySelector<HTMLButtonElement>('.health-first-step button');
    assert.equal(first === null, false, 'recommended first step must be actionable');
    await h.click(first!);
    assert.deepEqual(calls, ['focus:claude']);
    const more = h.document.querySelector<HTMLDetailsElement>('.health-more-recovery');
    assert.equal(more === null, false, 'secondary recovery actions must be behind disclosure');
    assert.equal(more!.open, false);
    await h.click(more!.querySelector('summary')!);
    const buttons = [...more!.querySelectorAll<HTMLButtonElement>('button')];
    assert.equal(buttons.length, 3);
    for (const button of buttons) await h.click(button);
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === copy.healthCopyReport)!);
    assert.deepEqual(calls, ['focus:claude', 'reload:claude', 'hard:claude', 'cache:claude', 'report']);
    await h.render(element(health({ recent: { phase: 'generating' }, page: 'error' }), status(), actions));
    assert.equal(h.document.querySelector<HTMLElement>('.health-first-step')!.dataset.reason, 'busy');
    assert.equal([...h.document.querySelectorAll<HTMLButtonElement>('.health-more-recovery button')].every(button => button.disabled), true);
  } finally { await h.close(); }
});

test('tier and capture advice preserves advisory status and unconfirmed advice has no resend action', async () => {
  const h = await mountDom(element(health({ checks: [check('capture')] })));
  try {
    assert.equal(h.document.querySelector('.health-first-step') === null, false, 'capture requires advice about copies');
    assert.equal(h.document.querySelector('.health-checks li')!.getAttribute('data-ok'), 'advisory');
    assert.equal(h.document.querySelector('.health-state')!.getAttribute('data-health-state'), 'ready');
    await h.render(element(health(), status({ phase: 'warning', code: 'submit_unconfirmed' })));
    assert.match(h.document.querySelector('.health-first-step')!.textContent!, /unconfirmed.*current conversation/s);
    assert.equal(h.document.querySelector('[data-recovery-action="resend"]') === null, true);
  } finally { await h.close(); }
});

for (const code of ['timeout', 'inject_failed', 'future_failure']) {
  test(`selector treats latest ${code} failure conservatively over an older green health snapshot`, () => {
    assert.deepEqual(siteRecoveryAdvice(health(), status({ phase: 'failed', code })), { reason: 'unknown', action: 'check', advisory: false });
  });
  test(`latest ${code} failure renders a manual check over an older green health snapshot`, async () => {
    const older = health(), latest = status({ phase: 'failed', code });
    const calls: string[] = [];
    const h = await mountDom(element(older));
    try {
      for (const locale of ['en', 'zh-CN', 'zh-TW']) {
        await h.render(element({ ...older, checks: older.checks.map(item => ({ ...item, name: `renamed-${locale}` })) }, latest,
          { onCheck: (keys: string[]) => calls.push(keys.join()) }, locale));
        const first = h.document.querySelector<HTMLElement>('.health-first-step')!;
        assert.equal(first.dataset.reason, 'unknown');
        assert.equal(first.querySelector('button')!.dataset.recoveryAction, 'check');
        await h.click(first.querySelector('button')!);
      }
      assert.deepEqual(calls, ['claude', 'claude', 'claude']);
    } finally { await h.close(); }
  });
}
