// Synthetic retry choices only; no shell bridge, user data, or remote sites.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BroadcastRetryReview } from '../../src/renderer/broadcast-retry-review';
import { SITES } from '../../src/main/sites';
import { getCopy } from '../../src/shared/copy';
import type { SiteKey } from '../../src/shared/contracts';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const query = new URLSearchParams(location.search);
document.documentElement.lang = query.get('locale') ?? 'en';
document.documentElement.dataset.density = query.get('density') ?? 'compact';
document.documentElement.dataset.theme = query.get('theme') ?? 'light';
const copy = getCopy(document.documentElement.lang);
const sites = SITES.slice(0, Number(query.get('count') ?? 9));
const state = { confirmed: 0, inspected: '', cancelled: 0 };
function App() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SiteKey[]>([]);
  (window as any).retryViewport = { state, setBusy, ready: true };
  return <main><button id="open-review" onClick={() => { setSelected([]); setOpen(true); }}>Open review</button>
    {open && <BroadcastRetryReview copy={copy} sites={sites} selected={selected} busy={busy}
      onToggle={key => setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])}
      onConfirm={() => { state.confirmed++; setOpen(false); }}
      onInspect={key => { state.inspected = key; setOpen(false); }}
      onCancel={() => { state.cancelled++; setOpen(false); }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
