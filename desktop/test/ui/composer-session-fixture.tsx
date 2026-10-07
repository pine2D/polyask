import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { CommandBar } from '../../src/renderer/command-bar';
import { getCopy } from '../../src/shared/copy';
import type { Tier } from '../../src/shared/protocol';
import '../../src/renderer/styles.css';
const query = new URLSearchParams(location.search);
const copy = getCopy(query.get('locale') || 'en');
document.documentElement.dataset.density = query.get('density') || 'compact';
function Fixture() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false), [text, setText] = useState('');
  const [tier, setTier] = useState<Tier>(null);
  const transitions = useRef<boolean[]>([]), trusted = useRef(0);
  return <main className={`app-shell${expanded ? ' is-composer-expanded' : ''}`}>
    <CommandBar copy={copy} promptRef={ref} text={text} tier={tier} runState="idle"
      auxiliaryBusy={false} layoutMode="overview" selectedCount={2} failureCount={0}
      cancelledCount={0} scopeLabel={copy.allSites} healthAttention={0} panelTab={null}
      imageControl={<button name="attachment-control" onClick={() => undefined}>{copy.addImages}</button>}
      sendBlockedReason={null} synthesisPending={false} syncStatus={{ state: 'idle', connected: false,
        pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
      isMac={false} expanded={expanded} onTextChange={value => { setText(value); trusted.current++; }}
      onSubmit={() => undefined} onCancel={() => undefined} onTierChange={setTier}
      onLayoutChange={() => undefined} onExpandedChange={value => { transitions.current.push(value); setExpanded(value); }}
      onPanelChange={() => undefined} onShowGroupMenu={() => undefined} onOpenMore={() => undefined}
      onOpenArchive={() => undefined} onRetry={() => undefined} onPasteImages={() => undefined} />
    <output id="composer-transitions">{JSON.stringify(transitions.current)}</output>
    <output id="composer-inputs">{trusted.current}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
