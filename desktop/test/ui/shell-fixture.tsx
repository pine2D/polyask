// Synthetic UI data; no Electron bridge, user profile, or external requests.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from '../../src/renderer/command-bar';
import { CommandPalette, type CommandPaletteMode } from '../../src/renderer/command-palette';
import { COMMANDS } from '../../src/shared/commands';
import { ImagePicker } from '../../src/renderer/image-picker';
import { PromptDraftRecovery } from '../../src/renderer/prompt-draft-recovery';
import { DraftRecovery } from '../../src/renderer/draft-recovery';
import { PageTabs } from '../../src/renderer/page-tabs';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { applyUiTheme } from '../../src/renderer/ui-theme';
import { WorkspaceDrawer } from '../../src/renderer/workspace-drawer';
import { SiteFrames } from '../../src/renderer/site-frames';
import { ConfirmDialog } from '../../src/renderer/confirm-dialog';
import { FeedbackProvider, useGlobalFeedback } from '../../src/renderer/feedback-provider';
import { broadcastFeedback } from '../../src/renderer/broadcast-feedback';
import { completeRun } from '../../src/renderer/broadcast-run';
import { WorkspaceProgress } from '../../src/renderer/workspace-progress';
import { moreMenuCommandIds } from '../../src/renderer/toolbar-fit';
import { currentPlatform, type DesktopPlatform } from '../../src/renderer/platform';
import { usePresence } from '../../src/renderer/presence';
import { useComposerSession } from '../../src/renderer/use-composer-session';
import { useSiteParticipation } from '../../src/renderer/use-site-participation';
import { useSitePageClose } from '../../src/renderer/use-site-page-close';
import { setShellApi, shell } from '../../src/renderer/shell-api';
import { formatCopy, getCopy } from '../../src/shared/copy';
import { createSyncDiagnosticSnapshot } from '../../src/shared/sync-diagnostics';
import type { SyncStatus } from '../../src/shared/sync';
import type { Tier, SiteStatus } from '../../src/shared/protocol';
import type { SiteKey } from '../../src/shared/contracts';
import type { OpenWorkspacePanelState } from '../../src/renderer/workspace-panel-state';
import type { LocalDataStats } from '../../src/shared/local-data';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../../src/shared/preferences';
import { SITES } from '../../src/main/sites';
import { customProxy, proxyShellStubs, proxyStateFixture } from './proxy-state-fixture';
import { desktopToolsShellStubs } from './desktop-tools-fixture';
import { requestSurfaceChange } from '../../src/renderer/surface-transition';
import { describeSiteSnapshotError } from '../../src/shared/status-copy';
import type { SiteHealth } from '../../src/shared/site-health';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') || 'zh-CN';
const stress = query.get('stress') === '1';
const preview = query.get('preview') === '1';
const copy = getCopy(locale);
document.documentElement.lang = locale;
document.documentElement.dataset.density = query.get('density') || 'compact';
const platform = (query.get('platform') || currentPlatform) as DesktopPlatform;
document.documentElement.dataset.platform = platform;
const runtime = preview
  ? { version: '1.6.0-fixture', distribution: 'portable' as const, preview: true }
  : { version: '1.6.0-fixture', distribution: 'installed' as const };
const status: SyncStatus = { state: 'idle', connected: true, pending: 0, errorCount: 0,
  readOnly: false, oauthConfigured: true, secureTokenStorage: true, lastSuccessAt: 1_790_208_000_000,
  ...(query.get('connection') === 'off' ? { connected: false } : {}),
  ...(query.get('connection') === 'auth' ? { state: 'auth' as const } : {}),
  ...(query.has('diagnosticError') ? { state: 'error' as const, reason: 'oauth_callback_timeout' as const } : {}) };
const noop = () => {};
function SubmittedSummary() {
  const { announce } = useGlobalFeedback();
  useEffect(() => announce(broadcastFeedback(copy, completeRun({ runId: 'fixture', text: 'Question', sites: ['claude', 'kimi'], tier: null, images: [] },
    [{ site: 'claude', ok: true }, { site: 'kimi', ok: true }]))), [announce]);
  return null;
}
const previewImages = ['white', 'black'].map(color => {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
  const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 64, 48);
  return { name: `${color}.png`, type: 'image/png' as const, size: 128, dataUrl: canvas.toDataURL() };
});
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
const finishOperation = () => new Promise<void>(resolve => document.addEventListener('fixture:finish-operation', () => resolve(), { once: true }));
let dataStats: LocalDataStats = { history: 3, archives: 0, decisions: 0, folders: 0, answers: 9, memberships: 0,
  drafts: 0, reset: { preferences: 0, answers: 9, memberships: 0, templates: 0, groups: 1, workspace: 1 } };
const autoBackupFixtures = query.get('autoBackups') === '1' ? [
  { id: 'auto-20261114-093000-a1b2c3d4', filename: 'polyask-auto-v1.33.1-to-v1.34.0-2026-11-14.polyask',
    fromVersion: '1.33.1', toVersion: '1.34.0', fromDbSchema: 4, toDbSchema: 4, fromSyncSchema: 7, toSyncSchema: 7,
    createdAt: 1_790_208_000_000, sizeBytes: 184_320, textOnly: false },
  { id: 'auto-20261102-211500-e5f6a7b8', filename: 'polyask-auto-before-v1.33.1-2026-11-02.polyask',
    fromVersion: null, toVersion: '1.33.1', fromDbSchema: 4, toDbSchema: 4, fromSyncSchema: null, toSyncSchema: 7,
    createdAt: 1_789_200_000_000, sizeBytes: 42_500, textOnly: true }
] : [];
setShellApi({
  cancelBackup: async () => {},
  listAutoBackups: async () => autoBackupFixtures,
  previewAutoBackup: async (id: string) => ({ token: `fixture-${id}`, filename: 'auto.polyask', exportedAt: 1_790_208_000_000, items: [] }),
  exportAutoBackup: async (id: string) => autoBackupFixtures.find(item => item.id === id)?.textOnly ? 'text-only' : true,
  previewBackupSelection: async (_token: string, keys: string[]) => ({ imported: keys.length, skipped: 0, keys }),
  applyBackup: async (_token: string, keys: string[]) => ({ imported: keys.length, skipped: 0 }),
  ...(query.has('backupError') ? { exportBackup: async () => { throw Error('backup_failed'); }, previewBackup: async () => { throw Error('backup_failed'); } } : {}),
  commandPaletteShortcutState: async () => ({ mode: 'standard', revision: 1, error: null }), onCommandPaletteShortcut: () => () => {},
  ...desktopToolsShellStubs(),
  ...proxyShellStubs(query.get('surface') === 'proxy-edit' ? proxyStateFixture({ formValue: customProxy, applied: customProxy }) : undefined),
  getLocalDataStats: async () => dataStats,
  syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime),
  syncNow: async () => { await finishOperation(); return status; },
  clearHistory: async () => { await finishOperation(); const count = dataStats.history;
    dataStats = { ...dataStats, history: 0, answers: 0, reset: { ...dataStats.reset, answers: 0 } }; return count; },
  clearRemoteSync: async () => { await finishOperation(); return status; },
  exportSiteSnapshot: async (site: SiteKey) => {
    if (query.has('deferSnapshot')) await finishOperation();
    const errorCode = query.get('snapshotError');
    if (errorCode) return { status: 'failed' as const, code: errorCode as any };
    return { status: 'exported' as const, filePath: `polyask-${site}-snapshot-2026-11-14.json` };
  }
} as any);

function Fixture(): React.JSX.Element {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('比较不同方案的依据、风险与适用条件。 / Compare evidence, risks, and trade-offs.');
  const [tier, setTier] = useState<Tier>('think');
  const { expanded, reservedExpanded, setExpanded } = useComposerSession('sites');
  const [layout, setLayout] = useState<'overview' | 'duel' | 'focus'>('overview');
  const [page, setPage] = useState(0);
  const [inputMethod, setInputMethod] = useState<'keyboard' | 'pointer'>('keyboard');
  const [images, setImages] = useState(query.has('details') ? previewImages : []);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [selected, setSelected] = useState<readonly SiteKey[]>(SITES.slice(0, query.has('singlePage') ? 2 : 9).map(s => s.key));
  const initialHealthDetail = query.get('healthDetail') as SiteKey | null;
  const [panel, setPanel] = useState<OpenWorkspacePanelState | null>(
    initialHealthDetail ? { tab: 'health', detail: initialHealthDetail, inputMethod: 'pointer' } : { tab: 'sites', detail: null, inputMethod: 'keyboard' }
  );
  const [healthFeedback, setHealthFeedback] = useState('');
  const fixtureHealth: Partial<Record<SiteKey, SiteHealth>> = initialHealthDetail ? {
    [initialHealthDetail]: {
      site: initialHealthDetail,
      state: query.get('healthState') === 'error' ? 'error' : 'ready',
      page: 'ready',
      checkedAt: 1_790_208_000_000,
      checks: [
        { name: 'Composer', kind: 'control', ok: query.get('healthState') !== 'error' },
        { name: 'Send control', kind: 'control', ok: true },
        { name: 'Tier selector', kind: 'tier', ok: false },
        { name: 'History capture', kind: 'capture', ok: true }
      ]
    }
  } : {};
  const [notifications, setNotifications] = useState(true);
  const [sent, setSent] = useState(false);
  const [preferences, setPreferences] = useState<PreferenceSnapshot>({ deviceId: 'fixture-local',
    values: DEFAULT_PREFERENCE_VALUES, following: { display: false, layout: false, siteZoom: false, proxy: false },
    draftSync: false, initialized: [], versions: {} });
  const draftStatus = query.get('draftStatus') === 'error' ? 'error' : 'saved';
  const drafts = Array.from({ length: query.has('manyDrafts') ? 20 : 1 }, (_, i) => ({
    format: 1 as const, id: `fixture-draft-${i}`, kind: 'prompt' as const, context: 'composer', deviceId: 'fixture-remote',
    title: '远端独立草稿 · Remote draft', content: { text: '完整保存的问题。 A saved question.' }, updatedAt: 1_790_208_000_000 + i }));
  if (query.get('surface') === 'drafts') return <main className="archive-detail" style={{ padding: 24, height: '100%', overflow: 'auto' }}>
    <DraftRecovery copy={copy} drafts={drafts} deviceId="fixture-local" status={draftStatus} dirty
      busy={!!query.get('sending')} onRestore={async () => true} onRemove={async () => true} onRetry={noop} />
  </main>;
  const participation = useSiteParticipation({ opened: selected, ready: true, busy: !!query.get('sending'),
    openPages: async next => { setSelected(next); if (query.has('deferPageSelection')) await finishOperation(); return next; }, onError: noop });
  const pageClose = useSitePageClose({ copy, sites: SITES, busy: !!query.get('sending') || participation.pending,
    api: {
      previewSitePageClose: async site => ({ site, contentsId: selected.includes(site) ? SITES.findIndex(item => item.key === site) + 1 : null, reason: null }),
      closeSitePage: async request => ({ state: 'closed', workspace: { selectedSites: selected.filter(site => site !== request.site), groups: [], tier } })
    }, onOpen: () => setPanel(null), onClose: () => queueMicrotask(() => promptRef.current?.focus()), onWorkspace: state => setSelected(state.selectedSites), onAnnounce: noop });
  if (query.get('surface') === 'settings') return <SettingsWorkspace copy={copy} locale={locale}
    initialSection={(query.get('section') as any) || undefined}
    status={status} runtime={runtime} onStatus={noop} onAnnounce={noop} onClose={() => { document.body.dataset.settingsClosed = 'true'; }}
    display={{ ...preferences.values.display, density: document.documentElement.dataset.density as 'compact' | 'comfortable' }}
    onDisplayChange={async display => { document.documentElement.dataset.density = display.density;
      setPreferences(p => ({ ...p, values: { ...p.values, display } })); }}
    onOpenShortcuts={noop} onOpenGuide={noop} confirmations={{ sitePageCloseConfirm: true, newSessionConfirm: true }} onConfirmationChange={noop}
    onCheckUpdates={noop} completionNotifications={notifications} onCompletionNotificationsChange={setNotifications}
    preferenceSync={{ snapshot: preferences,
      onThemeChange: async uiTheme => { applyUiTheme(document, uiTheme);
        setPreferences(p => ({ ...p, values: { ...p.values, uiTheme } })); },
      onFollowingChange: async (group, enabled) => setPreferences(p => ({ ...p, following: { ...p.following, [group]: enabled } })),
      onLayoutModeChange: async layoutMode => setPreferences(p => ({ ...p, values: { ...p.values, layoutMode } })),
      onDraftSyncChange: async draftSync => setPreferences(p => ({ ...p, draftSync })) }} />;
  return <div className={`app-shell${reservedExpanded ? ' is-composer-expanded' : ''}`} data-sent={sent} data-opened={selected.join(',')} data-participating={participation.participating.join(',')}>
    {query.has('progress') ? <SubmittedSummary /> : null}
    <CommandBar onNewSession={() => undefined} newSessionBlockedReason={null} copy={copy} promptRef={promptRef} text={text} tier={tier} runState={query.get('cancelling') ? 'cancelling' : query.get('sending') ? 'sending' : 'idle'} auxiliaryBusy={false}
      layoutMode={layout} automaticFocus={query.has('automaticFocus')} selectedCount={participation.participating.length} failureCount={stress ? 6 : 0} cancelledCount={0} uncertainCount={stress ? 3 : 0} onReviewUncertain={noop}
      scopeLabel={copy.allSites} healthAttention={stress ? 2 : 0} panelTab={panel?.tab ?? null}
      pageControl={!query.has('singlePage') && <PageTabs copy={copy} sites={SITES} selectedSites={selected} statuses={stress ? statuses : {}} page={page} inputMethod={inputMethod} onPageChange={(next, method) => { setPage(next); setInputMethod(method); }} />}
      draftRecovery={<PromptDraftRecovery copy={copy} busy={!!query.get('sending')} onClearImages={() => setImages([])}
        onBlockingChange={noop} recovery={{ deviceId: 'fixture-local', status: draftStatus, dirty: true, drafts,
          onRestore: async draft => { setText((draft.content as { text: string }).text); return true; }, onRemove: async () => true, onRetry: noop }} />}
      imageControl={<ImagePicker copy={copy} images={query.has('details') ? images : stress ? previewImages.slice(0, 1) : []} open={imagesOpen} disabled={false} warning={null} warningCount={0}
        error={null} onOpenChange={open => { setImagesOpen(open); if (open) setPanel(null); }} onFiles={() => { document.body.dataset.fileChanges = String(Number(document.body.dataset.fileChanges ?? 0) + 1); }} onRemove={index => setImages(current => current.filter((_, i) => i !== index))} onAdjustScope={noop} />}
      sendBlockedReason={null} synthesisPending={false} syncStatus={status} isMac={platform === 'darwin'} expanded={expanded} reservedExpanded={reservedExpanded}
      onTextChange={setText} onSubmit={() => setSent(true)} onCompare={query.has('blocked') ? undefined : () => { document.body.dataset.compared = 'true'; }} onRetry={noop} onCancel={noop}
      onTierChange={setTier} onLayoutChange={setLayout} onExpandedChange={setExpanded}
      onPanelChange={tab => setPanel(tab ? { tab, detail: null, inputMethod: 'keyboard' } : null)}
      onShowGroupMenu={noop} onOpenMore={() => { document.body.dataset.menuCommands = moreMenuCommandIds().join(','); }}
      onOpenArchive={() => { document.body.dataset.archiveOpened = 'true'; }} onPasteImages={noop} />
    {query.has('progress') ? <WorkspaceProgress copy={copy} runId="fixture" activeSites={['claude', 'kimi']}
      statuses={{ claude: { site: 'claude', phase: 'complete', submission: { runId: 'fixture', state: 'sent' }, generation: { runId: 'fixture', state: 'complete' } },
        kimi: { site: 'kimi', phase: 'complete', submission: { runId: 'fixture', state: 'sent' }, generation: { runId: 'fixture', state: 'complete' } } }}
      progress={{ runId: 'fixture', questionId: 'question', revision: 1, state: 'available', answers: (['claude', 'kimi'] as const).map(site => ({
        id: `answer-${site}`, site, attempt: 1, submission: 'submitted', capture: 'complete', hasText: true, truncated: false, sealedAt: 100
      })) }} onRead={noop} /> : null}
    <SiteFrames copy={copy} sites={SITES} statuses={statuses} selected={new Set(selected)} history={{}}
      layout={{ mode: 'overview', focused: 'claude', page: 0, pageCount: 3,
        placements: SITES.slice(0, 2).map((site, i) => ({ key: site.key,
          bounds: { x: 340, y: 240 + i * 200, width: innerWidth - 360, height: 180 } })) }}
      participating={new Set(participation.participating)} participationBusy={participation.pending || !!query.get('sending')}
      onToggle={site => { void participation.toggle(site); }} onFocus={noop} onReload={noop} onBack={noop} />
    {panel && <WorkspaceDrawer copy={copy} sites={SITES} selected={new Set(selected)} participating={new Set(participation.participating)} groups={[]} statuses={{}}
      participationBusy={participation.pending || !!query.get('sending')} onCloseSitePage={site => { void pageClose.request(site); }}
      health={fixtureHealth} healthChecking={false} open state={panel} onStateChange={setPanel} onSelectionChange={next => { void participation.reorderOpened(next); }}
      onParticipationChange={next => { void participation.change(next); }}
      onSaveGroup={async () => true} onDeleteGroup={noop} onCheckHealth={noop} onFocusSite={noop}
      onReloadSite={noop} onHardReloadSite={noop} onClearSiteData={noop} onCopyHealthReport={noop}
      healthFeedback={healthFeedback}
      onExportSiteSnapshot={async site => {
        const res = await shell.exportSiteSnapshot(site);
        const label = SITES.find(item => item.key === site)?.label ?? site;
        if (res.status === 'exported') setHealthFeedback(formatCopy(copy.healthSnapshotExported, { site: label }));
        else if (res.status === 'failed') setHealthFeedback(describeSiteSnapshotError(copy, res.code));
      }} />}
    {pageClose.dialog}
    <p style={{ position: 'absolute', top: 180, left: 360, color: 'var(--muted)' }}>UI fixture · 仅验证外壳，未加载 AI 站点</p>
  </div>;
}
function ShortcutFixture() {
  const [mode, setMode] = useState<CommandPaletteMode>('shortcuts');
  return <CommandPalette copy={copy} commands={COMMANDS} menuShortcuts={[]} groups={[]}
    library={{ templates: [], history: [] }} draft="" isMac={platform === 'darwin'} mode={mode} onModeChange={setMode}
    onExecute={id => { document.body.dataset.executed = id; }} onApplyGroup={noop} onInsertPrompt={noop}
    onSaveTemplate={noop} onDeleteTemplate={noop} onClose={noop} />;
}
function ProxyEditFixture() {
  const [open, setOpen] = useState(true);
  const close = () => requestSurfaceChange('settings', 'sites', {
    surfaceChanged: noop, closeHistory: noop, closeImages: noop, resetComposer: noop, closeDrawer: noop,
    commit: () => setOpen(false)
  });
  return open ? <SettingsWorkspace copy={copy} locale={locale} status={status} runtime={runtime}
    initialSection="proxy" onStatus={noop} onAnnounce={noop} onClose={close} />
    : <button data-proxy-reopen onClick={() => setOpen(true)}>Reopen settings</button>;
}
createRoot(document.getElementById('root')!).render(query.get('surface') === 'proxy-edit' ? <ProxyEditFixture /> : query.get('surface') === 'shortcuts' ? <ShortcutFixture /> : query.get('surface') === 'native' ? <NativeFixture />
  : <FeedbackProvider copy={copy} preview={preview}><Fixture /></FeedbackProvider>);
