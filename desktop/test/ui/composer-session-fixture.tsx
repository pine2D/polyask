import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { CommandBar } from '../../src/renderer/command-bar';
import { useComposerSession } from '../../src/renderer/use-composer-session';
import { getCopy } from '../../src/shared/copy';
import type { DesktopSurface, Tier } from '../../src/shared/protocol';
import { ImagePicker } from '../../src/renderer/image-picker';
import { useImageSelection } from '../../src/renderer/use-image-selection';
import { useSiteParticipation } from '../../src/renderer/use-site-participation';
import { confirmAndStartNewSession } from '../../src/renderer/new-session-action';
import { ConfirmDialog } from '../../src/renderer/confirm-dialog';
import { ExclusiveActionLock } from '../../src/renderer/broadcast-flow-state';
import { executeCommand } from '../../src/renderer/command-dispatcher';
import type { PendingSessionConfirmation } from '../../src/renderer/session-confirmation';
import type { SiteKey } from '../../src/shared/contracts';
import { formatCopy } from '../../src/shared/copy';
import '../../src/renderer/styles.css';
const opened: readonly SiteKey[] = ['claude', 'chatgpt', 'deepseek', 'gemini', 'kimi'];
const participants: readonly SiteKey[] = ['claude', 'kimi'];
const query = new URLSearchParams(location.search);
const copy = getCopy(query.get('locale') || 'en');
document.documentElement.dataset.density = query.get('density') || 'compact';
function Fixture() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [surface, setSurface] = useState<DesktopSurface>('sites');
  const { expanded, reservedExpanded, setExpanded } = useComposerSession(surface);
  const [pending, setPending] = useState<PendingSessionConfirmation | null>(null);
  const [busy, setBusy] = useState(false), [announcement, announce] = useState('');
  const [calls, setCalls] = useState<readonly (readonly SiteKey[])[]>([]);
  const lock = useRef(new ExclusiveActionLock()), starting = useRef(false);
  const participation = useSiteParticipation({ opened, saved: participants, ready: true, busy,
    openPages: async () => opened, onError: () => { throw Error('unexpected participation failure'); } });
  const imageSelection = useImageSelection(copy, !busy, announce);
  useEffect(() => imageSelection.replace([{ name: 'synthetic.png', type: 'image/png', size: 68,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=' }]), []);
  const start = async () => {
    if (starting.current || lock.current.busy) return;
    starting.current = true;
    try { await confirmAndStartNewSession({ sites: participation.currentSites(), copy, show: setPending,
      changeSurface: value => { imageSelection.invalidateAndClose(); setSurface(value); },
      run: async action => { await lock.current.run(async () => { setBusy(true); try { await action(); } finally { setBusy(false); } }); },
      send: async sites => { setCalls(previous => [...previous, sites]); await new Promise(resolve => setTimeout(resolve, 350));
        return sites.map((site, index) => ({ site, ok: index === 0 })); },
      invalidate: () => {}, recover: () => { throw Error('unexpected new-session failure'); }, announce });
    } finally { starting.current = false; }
  };
  const [text, setText] = useState('');
  const [tier, setTier] = useState<Tier>(null);
  const transitions = useRef<boolean[]>([]), trusted = useRef(0);
  return <main data-opened={opened.join(",")} data-participating={participation.participating.join(",")} data-focused="gemini" className={`app-shell${reservedExpanded ? ' is-composer-expanded' : ''}`}>
    <CommandBar onNewSession={() => executeCommand("new-session", { "new-session": () => { void start(); } })} newSessionBlockedReason={pending ? copy.newSessionBlocked : null} copy={copy} promptRef={ref} text={text} tier={tier} runState="idle"
      auxiliaryBusy={busy} layoutMode="overview" selectedCount={2} failureCount={0}
      cancelledCount={0} scopeLabel={copy.allSites} healthAttention={0} panelTab={null}
      imageControl={<ImagePicker copy={copy} images={imageSelection.images} open={imageSelection.open} present={imageSelection.present}
        selectionIntent={imageSelection.intent} onPickerOpen={imageSelection.beginPick} disabled={busy} warning={null} warningCount={0}
        error={imageSelection.error} onOpenChange={imageSelection.setOpen} onFiles={files => { void imageSelection.choose(files); }}
        onRemove={imageSelection.remove} onAdjustScope={() => undefined} />}
      sendBlockedReason={null} synthesisPending={false} syncStatus={{ state: 'idle', connected: false,
        pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
      isMac={false} expanded={expanded} reservedExpanded={reservedExpanded} onTextChange={value => { setText(value); trusted.current++; }}
      onSubmit={() => undefined} onCancel={() => undefined} onTierChange={setTier}
      onLayoutChange={() => undefined} onExpandedChange={value => { transitions.current.push(value); setExpanded(value); }}
      onPanelChange={() => undefined} onShowGroupMenu={() => undefined} onOpenMore={() => undefined}
      onOpenArchive={() => undefined} onRetry={() => undefined} onPasteImages={() => undefined} />
    {pending && <ConfirmDialog copy={copy} title={copy.newSessionConfirmTitle}
      message={formatCopy(copy.newSessionConfirmMessage, { count: pending.count })}
      confirmLabel={copy.newSessionConfirmAction} cancelLabel={copy.newSessionKeepCurrent}
      onConfirm={() => pending.decide(true)} onCancel={() => pending.decide(false)} />}
    <output id="session-confirm-count">{pending?.count ?? 0}</output>
    <output id="session-calls">{JSON.stringify(calls)}</output>
    <output id="session-announcement">{announcement}</output>
    <output id="session-images">{JSON.stringify(imageSelection.images)}</output>
    <output id="composer-transitions">{JSON.stringify(transitions.current)}</output>
    <output id="composer-inputs">{trusted.current}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
