import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandPalette } from '../../src/renderer/command-palette';
import { FeedbackProvider, useGlobalFeedback } from '../../src/renderer/feedback-provider';
import { ImagePicker } from '../../src/renderer/image-picker';
import { useImageSelection } from '../../src/renderer/use-image-selection';
import { getCopy } from '../../src/shared/copy';
import { COMMANDS } from '../../src/shared/commands';
import '../../src/renderer/styles.css';
import '../../src/renderer/feedback.css';

const locale = new URLSearchParams(location.search).get('locale') || 'en';
const copy = getCopy(locale);
const noop = () => undefined;
let flow: ReturnType<typeof useImageSelection>;
let feedback: ReturnType<typeof useGlobalFeedback>;
let saved = 0;
let inserts = 0;
function Fixture() {
  const [draft, setDraft] = useState('Preserve this carefully written draft 😀');
  feedback = useGlobalFeedback();
  flow = useImageSelection(copy, true, feedback.announce);
  return <>
    <div className="command-bar" style={{ padding: 8 }}>
      <button id="hint-control" data-hint={copy.promptLibrary}>Hint control</button>
      <ImagePicker copy={copy} images={flow.images} open={flow.open} disabled={false} warning={null} warningCount={0}
        error={flow.error} onOpenChange={flow.setOpen} onFiles={files => { void flow.choose(files); }}
        onRemove={flow.remove} onAdjustScope={noop} />
      <output id="current-draft">{draft}</output>
    </div>
    <CommandPalette copy={copy} commands={COMMANDS} menuShortcuts={[]} groups={[]} isMac={false}
      library={{ templates: [{ id: 'plain', name: 'Plain replacement', text: 'Replacement question', updatedAt: 1, deviceId: 'fixture' },
        { id: 'variable', name: 'Variable replacement', text: 'Ask {{Topic}}', updatedAt: 1, deviceId: 'fixture' }],
        history: [{ id: 'recent', text: 'Recent replacement', lastUsedAt: 1 }] }}
      draft={draft} mode="library" onModeChange={noop} onExecute={noop} onApplyGroup={noop}
      onInsertPrompt={text => { inserts++; setDraft(text); }} onSaveTemplate={async () => { saved++; throw new Error('synthetic_save_failure'); }}
      onDeleteTemplate={noop} onClose={noop} />
  </>;
}
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<FeedbackProvider copy={copy}><Fixture /></FeedbackProvider>);
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))!;
const click = async (node: HTMLElement) => { check(node, 'missing control'); node.click(); await pause(); };
const enter = async (selector: string, value: string) => {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  check(node, `missing ${selector}`);
  const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true })); await pause();
};
const image = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
async function run() {
  while (!document.querySelector('.prompt-template-save')) await pause();
  for (const name of ['Plain replacement', 'Recent replacement', 'Variable replacement']) {
    await click(button(name));
    if (name === 'Variable replacement') {
      await enter('[name="template-variable-0"]', 'Precise topic');
      await click(button(copy.templateApply));
    }
    check(document.querySelector('[role="dialog"]'), 'filling a different draft requires a dialog');
    check(inserts === 0, 'choosing content cannot replace work');
    await click(document.querySelector<HTMLElement>('.confirm-actions button:not(.primary)')!);
    check(document.getElementById('current-draft')!.textContent === 'Preserve this carefully written draft 😀', 'cancel preserves the original draft');
    if (name === 'Variable replacement') await click(button(copy.templateBack));
  }
  await enter('[name="prompt-template-name"]', 'Preserve this template name 😀');
  await click(document.querySelector<HTMLElement>('.prompt-template-save button')!);
  check(document.querySelector<HTMLInputElement>('[name="prompt-template-name"]')!.value === 'Preserve this template name 😀', 'failed save preserves the name');
  check(saved === 1 && document.querySelector('[role="status"]')?.textContent === copy.promptLibrarySaveFailed, 'failed save is recoverable');
  await flow.choose([image('first.png')]); await pause();
  await Promise.all([flow.choose([image('second.png')], 'append'), flow.choose([image('third.png')], 'append')]); await pause();
  check(flow.images.map(item => item.name).join(',') === 'first.png,second.png,third.png', 'rapid image additions preserve order');
  await flow.choose([image('fourth.png'), image('fifth.png')], 'append'); await pause();
  check(flow.images.length === 3 && flow.error === copy.imageCountError, 'combined limit preserves previous images');
  feedback.announce(copy.promptLibrarySaveFailed);
  const noticeDeadline = Date.now() + 2000;
  while (document.querySelector('.feedback-notice')?.textContent !== copy.promptLibrarySaveFailed && Date.now() < noticeDeadline) await pause();
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  document.getElementById('hint-control')!.focus();
  const hintDeadline = Date.now() + 2000;
  while (document.querySelector<HTMLElement>('.feedback-hint')!.hidden && Date.now() < hintDeadline) await pause();
  const notice = document.querySelector<HTMLElement>('.feedback-notice')!;
  const hint = document.querySelector<HTMLElement>('.feedback-hint')!;
  check(notice.textContent === copy.promptLibrarySaveFailed && !notice.hidden, 'operation notice remains visible during a focused hint');
  check(hint.textContent === copy.promptLibrary && !hint.hidden, `control hint is visible alongside the notice: ${JSON.stringify({ hint: hint.textContent, hidden: hint.hidden, active: document.activeElement?.id, inert: document.getElementById('hint-control')!.closest('[inert]')?.tagName })}`);
  const bar = document.querySelector<HTMLElement>('.feedback-bar')!;
  check(bar.scrollWidth <= bar.clientWidth + 1, 'feedback fits narrow layouts');
  check(bar.getBoundingClientRect().height === 32, 'feedback height retains the native-view budget');
}
(window as any).inputProtectionResult = run().then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
