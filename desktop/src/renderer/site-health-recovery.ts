import type { SiteStatus } from '../shared/protocol';
import { siteReloadAllowed, type SiteHealth } from '../shared/site-health';

export type SiteRecoveryReason = 'busy' | 'unconfirmed' | 'sign-in' | 'page' | 'reach' | 'control'
  | 'probe' | 'tier' | 'capture' | 'unknown' | 'ready';
export interface SiteRecoveryAdvice {
  readonly reason: SiteRecoveryReason;
  readonly action: 'focus' | 'check' | 'reload';
  readonly advisory: boolean;
}

/** 只使用机器字段；检查项显示名已本地化，不能据名称猜测原因。 */
export function siteRecoveryAdvice(health: SiteHealth, status: SiteStatus): SiteRecoveryAdvice {
  const advice = (reason: SiteRecoveryReason, action: SiteRecoveryAdvice['action'] = 'focus', advisory = false) => ({ reason, action, advisory });
  if (!siteReloadAllowed(status.phase) || (health.recent && !siteReloadAllowed(health.recent.phase))) return advice('busy');
  const codes = [status.code, health.recent?.code];
  if (codes.some(code => code === 'submit_unconfirmed' || code === 'generation_unconfirmed')) return advice('unconfirmed');
  if (health.state === 'sign-in') return advice('sign-in');
  if (health.page === 'error' || codes.some(code => code === 'load_failed' || code === 'renderer_crashed')) return advice('page', 'reload');
  const failed = health.checks.filter(check => !check.ok);
  if (failed.some(check => check.kind === 'reach')) return advice('reach');
  if (failed.some(check => !['reach', 'probe', 'tier', 'capture'].includes(check.kind ?? 'control'))) return advice('control');
  if (failed.some(check => check.kind === 'probe') || codes.some(code => code === 'adapter_unavailable' || code === 'invalid_response')) return advice('probe', 'check');
  // A newer failure invalidates a previous green or advisory-only snapshot.
  if (status.phase === 'failed' || status.phase === 'crashed') return advice('unknown', 'check');
  if (failed.some(check => check.kind === 'tier')) return advice('tier', 'focus', true);
  if (failed.some(check => check.kind === 'capture')) return advice('capture', 'focus', true);
  if (health.state !== 'ready' || !health.checks.length) return advice('unknown', 'check');
  return advice('ready');
}

export const SITE_RECOVERY_COPY = {
  busy: 'healthAdviceBusy', unconfirmed: 'healthAdviceUnconfirmed', 'sign-in': 'healthAdviceSignIn',
  page: 'healthAdvicePage', reach: 'healthAdviceReach', control: 'healthAdviceControl', probe: 'healthAdviceProbe',
  tier: 'healthAdviceTier', capture: 'healthAdviceCapture', unknown: 'healthAdviceUnknown', ready: 'healthAdviceReady'
} as const;
