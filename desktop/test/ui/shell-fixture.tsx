// Synthetic UI data; no Electron bridge, user profile, or external requests.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from '../../src/renderer/command-bar';
import { ImagePicker } from '../../src/renderer/image-picker';
import { PageTabs } from '../../src/renderer/page-tabs';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { WorkspaceDrawer } from '../../src/renderer/workspace-drawer';
import { SiteFrames } from '../../src/renderer/site-frames';
import { ConfirmDialog } from '../../src/renderer/confirm-dialog';
import { currentPlatform, type DesktopPlatform } from '../../src/renderer/platform';
import { usePresence } from '../../src/renderer/presence';
import { setShellApi } from '../../src/renderer/shell-api';
import { formatCopy, getCopy } from '../../src/shared/copy';
import { createSyncDiagnosticSnapshot } from '../../src/shared/sync-diagnostics';
import type { SyncStatus } from '../../src/shared/sync';
import type { Tier, SiteStatus } from '../../src/shared/protocol';
import type { SiteKey } from '../../src/shared/contracts';
import type { OpenWorkspacePanelState } from '../../src/renderer/workspace-panel-state';
import { SITES } from '../../src/main/sites';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') || 'zh-CN';
const stress = query.get('stress') === '1';
const copy = getCopy(locale);
document.documentElement.lang = locale;
document.documentElement.dataset.density = query.get('density') || 'compact';
const platform = (query.get('platform') || currentPlatform) as DesktopPlatform;
document.documentElement.dataset.platform = platform;
const runtime = { version: '1.6.0-fixture', distribution: 'installed' as const };
const status: SyncStatus = { state: 'idle', connected: true, pending: 0, errorCount: 0,
  readOnly: false, oauthConfigured: true, secureTokenStorage: true, lastSuccessAt: 1_790_208_000_000 };
const noop = () => {};
function NativeFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState(true);
  const present = usePresence(pane, 10_000);
  return <main>
    <button id="open-dialog" onClick={() => setOpen(true)}>Open</button>
    <button id="close-pane" onClick={() => setPane(false)}>Close pane</button>
    {present && <p id="presence-pane">Retained until exit</p>}
    <p id="selectable-content">Answer content stays selectable.</p><input aria-label="Edit" defaultValue="Draft" />
    {open && <ConfirmDialog copy={copy} title={copy.newSessionConfirmTitle} message={formatCopy(copy.newSessionConfirmMessage, { count: 9 })}
      platform={platform} confirmLabel={copy.newSessionConfirmAction} cancelLabel={copy.newSessionKeepCurrent}
      onConfirm={() => { document.body.dataset.confirmed = 'true'; setOpen(false); }} onCancel={() => setOpen(false)} />}
  </main>;
}
const statuses: Record<string, SiteStatus> = {
  claude: { site: 'claude', phase: 'warning', code: 'tier_unconfirmed' },
  chatgpt: { site: 'chatgpt', phase: 'failed', code: 'submit_unconfirmed' }
};
if (stress) SITES.forEach((site, i) => {
  statuses[site.key] = { site: site.key, phase: 'failed', code: 'submit_unconfirmed',
    submission: { runId: 'fixture', state: (['failed', 'unconfirmed', 'sent'] as const)[i % 3] } };
});
setShellApi({ syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime) } as any);

function Fixture(): React.JSX.Element {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('比较不同方案的依据、风险与适用条件。 / Compare evidence, risks, and trade-offs.');
  const [tier, setTier] = useState<Tier>('think');
  const [expanded, setExpanded] = useState(false);
  const [layout, setLayout] = useState<'overview' | 'focus'>('overview');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<readonly SiteKey[]>(SITES.map(s => s.key));
  const [panel, setPanel] = useState<OpenWorkspacePanelState | null>({ tab: 'sites', detail: null, inputMethod: 'keyboard' });
  const [notifications, setNotifications] = useState(true);
  const [sent, setSent] = useState(false);
  if (query.get('surface') === 'settings') return <SettingsWorkspace copy={copy} locale={locale}
    status={status} runtime={runtime} onStatus={noop} onAnnounce={noop} onClose={noop}
    onCheckUpdates={noop} completionNotifications={notifications} onCompletionNotificationsChange={setNotifications} />;
  return <div className={`app-shell${expanded ? ' is-composer-expanded' : ''}`} data-sent={sent}>
    <CommandBar copy={copy} promptRef={promptRef} text={text} tier={tier} runState={query.get('sending') ? 'sending' : 'idle'} auxiliaryBusy={false}
      layoutMode={layout} selectedCount={selected.length} failureCount={stress ? 6 : 0} cancelledCount={0}
      scopeLabel={copy.allSites} healthAttention={0} panelTab={panel?.tab ?? null}
      pageControl={<PageTabs copy={copy} sites={SITES} selectedSites={selected} statuses={stress ? statuses : {}} page={page} inputMethod="keyboard" onPageChange={setPage} />}
      imageControl={<ImagePicker copy={copy} images={stress ? [{ name: 'synthetic.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==' }] : []} open={false} disabled={false} warning={null} warningCount={0}
        error={null} onOpenChange={noop} onFiles={noop} onRemove={noop} onAdjustScope={noop} />}
      sendBlockedReason={null} synthesisPending={false} syncStatus={status} isMac={platform === 'darwin'} expanded={expanded}
      onTextChange={setText} onSubmit={() => setSent(true)} onCompare={noop} onRetry={noop} onCancel={noop}
      onTierChange={setTier} onLayoutChange={setLayout} onExpandedChange={setExpanded}
      onOpenPanel={tab => setPanel({ tab, detail: null, inputMethod: 'keyboard' })}
      onShowGroupMenu={noop} onOpenMore={noop} onOpenArchive={noop} onPasteImages={noop} />
    <SiteFrames copy={copy} sites={SITES} statuses={statuses} selected={new Set(selected)} history={{}}
      layout={{ mode: 'overview', focused: 'claude', page: 0, pageCount: 3,
        placements: SITES.slice(0, 2).map((site, i) => ({ key: site.key,
          bounds: { x: 340, y: 240 + i * 200, width: innerWidth - 360, height: 180 } })) }}
      onToggle={noop} onFocus={noop} onReload={noop} onBack={noop} />
    {panel && <WorkspaceDrawer copy={copy} sites={SITES} selected={new Set(selected)} groups={[]} statuses={{}}
      health={{}} healthChecking={false} open state={panel} onStateChange={setPanel} onSelectionChange={setSelected}
      onSaveGroup={async () => true} onDeleteGroup={noop} onCheckHealth={noop} onFocusSite={noop}
      onReloadSite={noop} onHardReloadSite={noop} onClearSiteData={noop} onCopyHealthReport={noop} />}
    <p style={{ position: 'absolute', top: 180, left: 360, color: 'var(--muted)' }}>UI fixture · 仅验证外壳，未加载 AI 站点</p>
  </div>;
}
createRoot(document.getElementById('root')!).render(query.get('surface') === 'native' ? <NativeFixture /> : <Fixture />);
