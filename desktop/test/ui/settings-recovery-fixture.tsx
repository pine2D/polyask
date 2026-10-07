import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { SiteHealthPanel } from '../../src/renderer/site-health';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import type { DisplayPreferences } from '../../src/shared/display';
import type { LocalDataStats } from '../../src/shared/local-data';
import type { SiteHealth } from '../../src/shared/site-health';
import { createSyncDiagnosticSnapshot } from '../../src/shared/sync-diagnostics';
import { SITES } from '../../src/main/sites';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/site-health-recovery.css';

const locale = new URLSearchParams(location.search).get('locale') ?? 'en';
document.documentElement.lang = locale;
const copy = getCopy(locale);
const runtime = { version: 'fixture', distribution: 'installed' } as const;
const status = { state: 'idle', connected: true, pending: 0, errorCount: 0, readOnly: false,
  oauthConfigured: true, secureTokenStorage: true } as const;
let history = 2, holdCounts = false, statsFail = false, writeFail = false, displayFail = false;
let countReply: ((value: LocalDataStats) => void) | undefined, cloudReply: (() => void) | undefined;
const calls = { clears: 0, exports: 0, resets: 0, closes: 0, display: [] as DisplayPreferences[], health: [] as string[], blocking: [] as boolean[] };
const stats = (): LocalDataStats => ({ history, archives: 3, decisions: 4, folders: 5, answers: 7, memberships: 9,
  reset: { answers: 8, memberships: 10, templates: 6, groups: 1, workspace: 1 } });
setShellApi({
  syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime),
  getLocalDataStats: async () => {
    if (statsFail) { statsFail = false; throw Error('fixture-stats-failed'); }
    if (holdCounts) { holdCounts = false; return new Promise(resolve => { countReply = resolve; }); }
    return stats();
  },
  clearHistory: async () => { if (writeFail) { writeFail = false; throw Error('fixture-write-failed'); } calls.clears++; return 4; },
  resetLocalData: async () => { calls.resets++; return status; },
  exportBackup: async () => { calls.exports++; return { count: 2 }; },
  clearRemoteSync: () => new Promise(resolve => { cloudReply = () => resolve(status); })
} as any);
function Fixture(): React.JSX.Element {
  const [section, setSection] = useState<'overview' | 'data' | 'display' | 'drive-diagnostics'>('overview');
  const [request, setRequest] = useState(0);
  const [display, setDisplay] = useState<DisplayPreferences>({ density: 'compact', siteScale: 0.9 });
  const [healthCase, setHealthCase] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  (window as any).recoveryFixture = {
    copy, calls,
    navigate: (next: typeof section) => { setHealthCase(null); setSection(next); setRequest(value => value + 1); },
    holdCounts: () => { holdCounts = true; },
    releaseCounts: () => { countReply?.(stats()); countReply = undefined; },
    setHistory: (value: number) => { history = value; },
    failStats: () => { statsFail = true; }, failWrite: () => { writeFail = true; }, failDisplay: () => { displayFail = true; },
    releaseCloud: () => { cloudReply?.(); cloudReply = undefined; },
    health: (value: string) => setHealthCase(value),
    pushDisplay: (value: DisplayPreferences) => setDisplay(value)
  };
  if (healthCase) {
    const current: SiteHealth = { site: 'claude', state: 'ready', page: healthCase === 'page' ? 'error' : 'ready',
      checks: [{ name: 'Synthetic reach', kind: 'reach', ok: true }, { name: 'Synthetic control', kind: healthCase === 'capture' ? 'capture' : 'control', ok: false }] };
    const record = (value: string) => { calls.health.push(value); setFeedback(value); };
    return <div className="fixture-health" style={{ width: 'min(100%, 380px)', margin: '20px auto', padding: 16 }}>
      <SiteHealthPanel copy={copy} sites={[SITES[0]]} statuses={{ claude: { site: 'claude', phase: healthCase === 'busy' ? 'generating' : 'ready',
        code: healthCase === 'unconfirmed' ? 'submit_unconfirmed' : undefined } }} health={{ claude: current }} detail="claude"
        checking={false} feedback={feedback} onDetail={() => {}} onBack={() => {}} onFocus={() => record('focus')}
        onCheck={() => record('check')} onReload={() => record('reload')} onHardReload={() => record('hard')}
        onClearData={() => record('cache')} onCopyReport={() => record('report')} />
    </div>;
  }
  return <SettingsWorkspace copy={copy} locale={locale} runtime={runtime} status={status} display={display}
    initialSection={section} sectionRequest={request} onDisplayChange={async value => {
      calls.display.push(value); if (displayFail) { displayFail = false; throw Error('fixture-display-failed'); } setDisplay(value);
    }} onStatus={() => {}} onAnnounce={() => {}} onClose={() => { calls.closes++; }}
    onBlockingChange={value => { calls.blocking.push(value); }} />;
}
window.addEventListener('keyup', event => { (window as any).recoveryKeyUp = { key: event.key, trusted: event.isTrusted }; });
window.addEventListener('input', event => { (window as any).recoveryInputTrusted = event.isTrusted; });
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
