// Synthetic UI data; no Electron bridge, user profile, or external requests.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandBar } from '../../src/renderer/command-bar';
import { ImagePicker } from '../../src/renderer/image-picker';
import { PromptDraftRecovery } from '../../src/renderer/prompt-draft-recovery';
import { DraftRecovery } from '../../src/renderer/draft-recovery';
import { PageTabs } from '../../src/renderer/page-tabs';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { WorkspaceDrawer } from '../../src/renderer/workspace-drawer';
import { SiteFrames } from '../../src/renderer/site-frames';
import { ConfirmDialog } from '../../src/renderer/confirm-dialog';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { currentPlatform, type DesktopPlatform } from '../../src/renderer/platform';
import { usePresence } from '../../src/renderer/presence';
import { useComposerSession } from '../../src/renderer/use-composer-session';
import { useSiteParticipation } from '../../src/renderer/use-site-participation';
import { useSitePageClose } from '../../src/renderer/use-site-page-close';
import { setShellApi } from '../../src/renderer/shell-api';
import { formatCopy, getCopy } from '../../src/shared/copy';
import { createSyncDiagnosticSnapshot } from '../../src/shared/sync-diagnostics';
import type { SyncStatus } from '../../src/shared/sync';
import type { Tier, SiteStatus } from '../../src/shared/protocol';
import type { SiteKey } from '../../src/shared/contracts';
import type { OpenWorkspacePanelState } from '../../src/renderer/workspace-panel-state';
import type { LocalDataStats } from '../../src/shared/local-data';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../../src/shared/preferences';
import { SITES } from '../../src/main/sites';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

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
  readOnly: false, oauthConfigured: true, secureTokenStorage: true, lastSuccessAt: 1_790_208_000_000,
  ...(query.get('connection') === 'off' ? { connected: false } : {}),
  ...(query.get('connection') === 'auth' ? { state: 'auth' as const } : {}),
  ...(query.has('diagnosticError') ? { state: 'error' as const, reason: 'oauth_callback_timeout' as const } : {}) };
const noop = () => {};
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
setShellApi({
  getLocalDataStats: async () => dataStats,
  syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime),
  syncNow: async () => { await finishOperation(); return status; },
  clearHistory: async () => { await finishOperation(); const count = dataStats.history;
    dataStats = { ...dataStats, history: 0, answers: 0, reset: { ...dataStats.reset, answers: 0 } }; return count; },
  clearRemoteSync: async () => { await finishOperation(); return status; }
} as any);

function Fixture(): React.JSX.Element {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('比较不同方案的依据、风险与适用条件。 / Compare evidence, risks, and trade-offs.');
  const [tier, setTier] = useState<Tier>('think');
  const { expanded, reservedExpanded, setExpanded } = useComposerSession('sites');
  const [layout, setLayout] = useState<'overview' | 'focus'>('overview');
  const [page, setPage] = useState(0);
  const [inputMethod, setInputMethod] = useState<'keyboard' | 'pointer'>('keyboard');
  const [images, setImages] = useState(query.has('details') ? previewImages : []);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [selected, setSelected] = useState<readonly SiteKey[]>(SITES.slice(0, query.has('singlePage') ? 2 : 9).map(s => s.key));
  const [panel, setPanel] = useState<OpenWorkspacePanelState | null>({ tab: 'sites', detail: null, inputMethod: 'keyboard' });
  const [notifications, setNotifications] = useState(true);
  const [sent, setSent] = useState(false);
  const [preferences, setPreferences] = useState<PreferenceSnapshot>({ deviceId: 'fixture-local',
    values: DEFAULT_PREFERENCE_VALUES, following: { display: false, layout: false, siteZoom: false },
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
    status={status} runtime={runtime} onStatus={noop} onAnnounce={noop} onClose={() => { document.body.dataset.settingsClosed = 'true'; }}
    onCheckUpdates={noop} completionNotifications={notifications} onCompletionNotificationsChange={setNotifications}
    preferenceSync={{ snapshot: preferences,
      onFollowingChange: async (group, enabled) => setPreferences(p => ({ ...p, following: { ...p.following, [group]: enabled } })),
      onLayoutModeChange: async layoutMode => setPreferences(p => ({ ...p, values: { ...p.values, layoutMode } })),
      onDraftSyncChange: async draftSync => setPreferences(p => ({ ...p, draftSync })) }} />;
  return <div className={`app-shell${reservedExpanded ? ' is-composer-expanded' : ''}`} data-sent={sent} data-opened={selected.join(',')} data-participating={participation.participating.join(',')}>
    <CommandBar copy={copy} promptRef={promptRef} text={text} tier={tier} runState={query.get('sending') ? 'sending' : 'idle'} auxiliaryBusy={false}
      layoutMode={layout} selectedCount={participation.participating.length} failureCount={stress ? 6 : 0} cancelledCount={0}
      scopeLabel={copy.allSites} healthAttention={0} panelTab={panel?.tab ?? null}
      pageControl={!query.has('singlePage') && <PageTabs copy={copy} sites={SITES} selectedSites={selected} statuses={stress ? statuses : {}} page={page} inputMethod={inputMethod} onPageChange={(next, method) => { setPage(next); setInputMethod(method); }} />}
      draftRecovery={<PromptDraftRecovery copy={copy} busy={!!query.get('sending')} onClearImages={() => setImages([])}
        onBlockingChange={noop} recovery={{ deviceId: 'fixture-local', status: draftStatus, dirty: true, drafts,
          onRestore: async draft => { setText((draft.content as { text: string }).text); return true; }, onRemove: async () => true, onRetry: noop }} />}
      imageControl={<ImagePicker copy={copy} images={query.has('details') ? images : stress ? previewImages.slice(0, 1) : []} open={imagesOpen} disabled={false} warning={null} warningCount={0}
        error={null} onOpenChange={open => { setImagesOpen(open); if (open) setPanel(null); }} onFiles={noop} onRemove={index => setImages(current => current.filter((_, i) => i !== index))} onAdjustScope={noop} />}
      sendBlockedReason={null} synthesisPending={false} syncStatus={status} isMac={platform === 'darwin'} expanded={expanded} reservedExpanded={reservedExpanded}
      onTextChange={setText} onSubmit={() => setSent(true)} onCompare={query.has('blocked') ? undefined : noop} onRetry={noop} onCancel={noop}
      onTierChange={setTier} onLayoutChange={setLayout} onExpandedChange={setExpanded}
      onPanelChange={tab => setPanel(tab ? { tab, detail: null, inputMethod: 'keyboard' } : null)}
      onShowGroupMenu={noop} onOpenMore={noop} onOpenArchive={noop} onPasteImages={noop} />
    <SiteFrames copy={copy} sites={SITES} statuses={statuses} selected={new Set(selected)} history={{}}
      layout={{ mode: 'overview', focused: 'claude', page: 0, pageCount: 3,
        placements: SITES.slice(0, 2).map((site, i) => ({ key: site.key,
          bounds: { x: 340, y: 240 + i * 200, width: innerWidth - 360, height: 180 } })) }}
      participating={new Set(participation.participating)} participationBusy={participation.pending || !!query.get('sending')}
      onToggle={site => { void participation.toggle(site); }} onFocus={noop} onReload={noop} onBack={noop} />
    {panel && <WorkspaceDrawer copy={copy} sites={SITES} selected={new Set(selected)} participating={new Set(participation.participating)} groups={[]} statuses={{}}
      participationBusy={participation.pending || !!query.get('sending')} onCloseSitePage={site => { void pageClose.request(site); }}
      health={{}} healthChecking={false} open state={panel} onStateChange={setPanel} onSelectionChange={next => { void participation.reorderOpened(next); }}
      onParticipationChange={next => { void participation.change(next); }}
      onSaveGroup={async () => true} onDeleteGroup={noop} onCheckHealth={noop} onFocusSite={noop}
      onReloadSite={noop} onHardReloadSite={noop} onClearSiteData={noop} onCopyHealthReport={noop} />}
    {pageClose.dialog}
    <p style={{ position: 'absolute', top: 180, left: 360, color: 'var(--muted)' }}>UI fixture · 仅验证外壳，未加载 AI 站点</p>
  </div>;
}
createRoot(document.getElementById('root')!).render(query.get('surface') === 'native' ? <NativeFixture />
  : query.has('details') ? <FeedbackProvider copy={copy}><Fixture /></FeedbackProvider> : <Fixture />);
