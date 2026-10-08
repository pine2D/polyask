import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { CommandBar } from '../../src/renderer/command-bar';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { ImagePicker } from '../../src/renderer/image-picker';
import { QuestionHistory } from '../../src/renderer/question-history';
import { SiteFrames } from '../../src/renderer/site-frames';
import { WorkspaceDrawer } from '../../src/renderer/workspace-drawer';
import { usePresence } from '../../src/renderer/presence';
import { useWorkspaceMotion } from '../../src/renderer/use-workspace-motion';
import { getCopy } from '../../src/shared/copy';
import type { LayoutState, Tier } from '../../src/shared/protocol';
import { SITES } from '../../src/main/sites';
import '../../src/renderer/styles.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const query = new URLSearchParams(location.search), density = query.get('density') === 'comfortable' ? 'comfortable' : 'compact';
document.documentElement.dataset.density = density;
const copy = getCopy(query.get('locale') || 'zh-CN'), selected = new Set(SITES.slice(0, 4).map(site => site.key));
const sites = SITES.filter(site => selected.has(site.key)), noop = () => {};
const image = { name: 'local.png', type: 'image/png' as const, size: 68,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=' };
function Fixture() {
  const [layout, setLayout] = useState<LayoutState>({ mode: 'overview', focused: sites[0].key, page: 0, pageCount: 1, placements: [] });
  const [drawer, setDrawer] = useState(false), [tray, setTray] = useState(false), [history, setHistory] = useState(false);
  const imagePresent = usePresence(tray, 140);
  const { composer, drawerPresent } = useWorkspaceMotion('sites', drawer, 'pointer', imagePresent, { layout, density, covered: false });
  const [text, setText] = useState(''), [tier, setTier] = useState<Tier>(null), ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => window.polyask.onLayout(setLayout), []);
  useEffect(() => (window as any).motionTest.onNative((bounds: unknown) => { (window as any).motionNative = bounds; }), []);
  const openDrawer = (open: boolean) => { setDrawer(open); if (open) { setTray(false); setHistory(false); } };
  return <main className={`app-shell${composer.reservedExpanded ? ' is-composer-expanded' : ''}`}>
    <CommandBar copy={copy} promptRef={ref} text={text} tier={tier} runState="idle" auxiliaryBusy={false}
      layoutMode={layout.mode} selectedCount={4} failureCount={0} cancelledCount={0} scopeLabel={copy.allSites}
      healthAttention={0} panelTab={drawer ? 'sites' : null} expanded={composer.expanded}
      reservedExpanded={composer.reservedExpanded} revealedExpanded={composer.revealedExpanded}
      imageControl={<ImagePicker copy={copy} images={[image]} open={tray} present={imagePresent} disabled={false}
        warning={null} warningCount={0} error={null} onOpenChange={open => { setTray(open); if (open) { setDrawer(false); setHistory(false); } }}
        onFiles={noop} onRemove={noop} onAdjustScope={() => openDrawer(true)} />}
      sendBlockedReason={null} synthesisPending={false} syncStatus={{ state: 'idle', connected: false, pending: 0,
        errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }} isMac={false}
      onTextChange={setText} onSubmit={noop} onCancel={noop} onTierChange={setTier}
      onLayoutChange={mode => window.polyask.setLayout(mode, layout.focused)} onExpandedChange={composer.setExpanded}
      onPanelChange={tab => openDrawer(!!tab)} onShowGroupMenu={noop} onOpenMore={noop} onOpenArchive={noop}
      historyOpen={history} onOpenHistory={() => { setHistory(!history); setDrawer(false); setTray(false); }} onRetry={noop} onPasteImages={noop} />
    {drawerPresent && <WorkspaceDrawer copy={copy} sites={sites} selected={selected} participating={selected}
      groups={[]} statuses={{}} health={{}} healthChecking={false} open={drawer}
      state={{ tab: 'sites', detail: null, inputMethod: 'pointer', sitesMode: 'select' }} onStateChange={state => openDrawer(!!state)}
      onSelectionChange={noop} onParticipationChange={noop} onSaveGroup={async () => false} onDeleteGroup={noop}
      onCheckHealth={noop} onFocusSite={noop} onReloadSite={noop} onHardReloadSite={noop} onClearSiteData={noop} onCopyHealthReport={noop} />}
    <SiteFrames copy={copy} sites={sites} statuses={{}} layout={layout} selected={selected} onToggle={noop}
      onFocus={noop} onReload={noop} history={{}} onBack={noop} />
    <QuestionHistory copy={copy} sites={sites} draft={text} open={history} busy={false} onBlockingChange={noop}
      onClose={() => setHistory(false)} onOpen={() => setHistory(true)} onDraft={setText} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<FeedbackProvider copy={copy}><Fixture /></FeedbackProvider>);
