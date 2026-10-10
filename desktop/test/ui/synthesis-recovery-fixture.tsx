import { withFolderPages } from './library-page-api';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { ExclusiveActionLock } from '../../src/renderer/broadcast-flow-state';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { useSynthesisFlow } from '../../src/renderer/use-synthesis-flow';
import { useSynthesisRecovery } from '../../src/renderer/use-synthesis-recovery';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { createArchiveRecord } from '../../src/shared/archive';
import { SITES } from '../../src/main/sites';
import '../../src/renderer/styles.css';
import '../../src/renderer/feedback.css';

const locale = new URLSearchParams(location.search).get('locale') || 'en';
const copy = getCopy(locale);
const record = createArchiveRecord({ text: 'Synthetic question', task: 'Synthetic task', createdAt: 1,
  results: [{ host: 'claude.ai', label: 'Claude', text: 'Exact excerpt. More context.' }, { host: 'chatgpt.com', label: 'ChatGPT', text: 'Other answer.' }] },
{ id: 'A', now: 1, deviceId: 'fixture' });
const noop = () => undefined;
let attempts = 0;
setShellApi(withFolderPages({ listFolders: async () => [], searchFolderContents: async () => [{ kind: 'archive', record }],
  listArchiveTags: async () => [], getArchive: async () => record,
  sendSynthesis: async () => { attempts++; return { result: { site: 'kimi', ok: false, code: 'submit_unconfirmed' }, pending: null }; }
}) as any);
function App() {
  const [surface, setSurface] = useState('archive');
  const [lock] = useState(() => new ExclusiveActionLock());
  const flow = useSynthesisFlow(lock);
  const [prepared] = useState(() => {
    for (const host of [undefined, 'claude.ai']) flow.drafts.save(record, { selectedHosts: host ? ['claude.ai'] : ['claude.ai', 'chatgpt.com'],
      targetSite: 'kimi', tier: 'think', instruction: 'Carefully edited requirements 😀', excerpt: 'Exact excerpt.' }, host);
    return true;
  });
  void prepared;
  const recovery = useSynthesisRecovery(copy, flow, () => setSurface('sites'), () => setSurface('archive'));
  return surface === 'sites' ? <div id="target-site">Synthetic target site</div> : <div className="surface-stage"><ArchiveSurface
    copy={copy} locale={locale} sites={SITES} synthesisSites={SITES} defaultTier={null}
    preferredId={recovery.editorRequest?.archiveId ?? record.id} pendingSynthesis={flow.pending} synthesisCandidate={flow.candidate}
    synthesisDrafts={flow.drafts} synthesisEditorRequest={recovery.editorRequest} onSynthesisEditorOpened={recovery.consumeEditorRequest}
    onClose={noop} onCapture={async () => record} onSendSynthesis={recovery.send}
    onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} /></div>;
}
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<FeedbackProvider copy={copy}><App /></FeedbackProvider>);
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))!;
const until = async (condition: () => unknown) => {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) await pause();
  check(condition(), 'expected UI state appears');
};
const click = async (node: HTMLElement) => { check(node, 'missing control'); node.click(); await pause(); };
const field = () => document.querySelector<HTMLTextAreaElement>('[name="synthesis-instruction"]')!;
async function run() {
  for (const followUp of [false, true]) {
    await until(() => button(followUp ? copy.followUpAction : copy.synthesisAction));
    await click(button(followUp ? copy.followUpAction : copy.synthesisAction));
    await until(() => field());
    const original = `Keep ${followUp ? 'follow-up' : 'comparison'} requirements through failure 😀`;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), original);
    field().dispatchEvent(new Event('input', { bubbles: true })); await pause();
    await click(document.querySelector<HTMLElement>('.synthesis-workspace footer button')!);
    await until(() => button(copy.synthesisReturnToEdit));
    check(document.getElementById('target-site'), 'target site is shown before submission');
    check(attempts === (followUp ? 2 : 1), 'failure does not automatically retry');
    await click(button(copy.synthesisReturnToEdit));
    await until(() => field());
    check(field().value === original, 'failed submission restores all instruction work');
    check(document.querySelector('[name="synthesis-target"]')!.textContent!.includes('Kimi'), 'target selection is retained');
    check(document.querySelector('[name="synthesis-tier"]')!.textContent!.includes(copy.think), 'model tier is retained');
    if (followUp) check(document.querySelector<HTMLTextAreaElement>('[name="follow-up-excerpt"]')!.value === 'Exact excerpt.', 'exact excerpt is retained');
    check(attempts === (followUp ? 2 : 1), 'return to editing never sends');
    const pane = document.querySelector<HTMLElement>('.synthesis-workspace')!;
    check(pane.scrollWidth <= pane.clientWidth + 1, 'restored editor fits available width');
    if (!followUp) await click(document.querySelector<HTMLElement>('.synthesis-workspace .panel-close')!);
  }
}
(window as any).synthesisRecoveryResult = run().then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
