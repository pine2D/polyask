import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistory } from '../../src/renderer/question-history';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import type { QuestionDetail, QuestionSummary } from '../../src/shared/question-history';
import '../../src/renderer/styles.css';
const copy = getCopy('en');
const scenario = new URLSearchParams(location.search).get('scenario');
const ticks = new Map<number, () => void>();
let tickId = 0;
window.setInterval = ((run: () => void) => { ticks.set(++tickId, run); return tickId; }) as typeof window.setInterval;
window.clearInterval = ((id?: number) => { ticks.delete(id!); }) as typeof window.clearInterval;
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const tick = async () => { for (const run of [...ticks.values()]) run(); await pause(); };
let rows: QuestionSummary[] = Array.from({ length: 120 }, (_, i) => ({ schema: 4, id: `q${i}`, updatedAt: 2000, deviceId: 'fixture', sites: ['claude'], requestedTier: null, inputImageCount: 0, text: `Question ${i}`, createdAt: 1000 - i, savedSites: 0, answers: [] }));
let pending: (() => void)[] = [], delay = false;
setShellApi({
  setQuestionPanel: async () => {}, setSurface: async () => {}, onQuestionSaveFailed: () => () => {},
  listLegacyQuestions: async () => ({ items: [], cursor: null }),
  listQuestions: async ({ cursor }: { cursor?: string }) => {
    const start = cursor ? rows.findIndex(q => q.id === cursor) + 1 : 0;
    const items = rows.slice(start, start + 50);
    const value = { items, cursor: start + 50 < rows.length ? items.at(-1)!.id : null };
    if (delay) await new Promise<void>(resolve => pending.push(resolve));
    return value;
  },
  deleteQuestion: async (id: string) => { rows = rows.filter(q => q.id !== id); },
  getQuestion: async (id: string): Promise<QuestionDetail> => {
    const value: QuestionDetail = { question: rows.find(q => q.id === id)!, answers: scenario === 'source-links' ? [{
      schema: 4, id: 'a0', questionId: id, site: 'claude', attempt: 1, createdAt: 1000, updatedAt: 2000, deviceId: 'fixture',
      submission: 'submitted', submissionCode: null, conversationUrl: null, capture: 'complete', captureCode: null,
      answerMarkdown: '[First source](https://example.com/first)\n\n[Second source](https://example.com/second)',
      capturedAt: 2000, truncated: false, sealedAt: 2000
    }] : [] };
    if (delay) await new Promise<void>(resolve => pending.push(resolve));
    return value;
  }
} as any);
const noop = () => {};
function App() {
  const [open, setOpen] = useState(true);
  return <FeedbackProvider copy={copy}><QuestionHistory open={open} copy={copy} sites={[]} draft="" busy={false}
    onBlockingChange={noop} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onDraft={noop} /></FeedbackProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
const click = async (selector: string) => { const node = document.querySelector<HTMLButtonElement>(selector); check(node, `missing ${selector}`); node.click(); await pause(); };
const cards = () => document.querySelectorAll('.question-main');
async function run() {
  while (cards().length !== 50) await pause();
  if (scenario === 'source-links') {
    await click('.question-main');
    check(document.querySelectorAll('.markdown-preview a[href]').length === 2, 'two plain source links rendered without diagram controls');
    document.querySelector<HTMLButtonElement>(`button[aria-label="${copy.questionMenu}"]`)!.focus();
    (window as any).historyNativeReady = true;
    while (!(window as any).historyNativeDone) await pause();
    check(!(window as any).historyNativeError, (window as any).historyNativeError);
  } else if (scenario === 'ime-composing' || scenario === 'ime-229') {
    await click('.question-main');
    let hostEscapes = 0;
    window.addEventListener('keydown', event => { if (event.key === 'Escape') hostEscapes++; });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true,
      ...(scenario === 'ime-composing' ? { isComposing: true } : { keyCode: 229 }) });
    document.activeElement!.dispatchEvent(event); await pause();
    check(!event.defaultPrevented, 'IME Escape must retain native candidate cancellation');
    check(document.querySelector('.question-reader'), 'IME Escape must not leave history detail');
    check(hostEscapes === 0, 'IME Escape must not propagate to host cancellation');
  } else if (scenario === 'pages') {
    await click('.question-load-more'); check(cards().length === 100, 'second page loads');
    const scroller = document.querySelector<HTMLElement>('.question-scroll')!;
    scroller.scrollTop = 900; const scroll = scroller.scrollTop;
    rows = [{ ...rows[0], id: 'new', text: 'New question', createdAt: 2000 }, ...rows.filter(q => q.id !== 'q60').map(q => q.id === 'q75' ? { ...q, savedSites: 1 } : q)];
    await tick(); await pause();
    check(document.querySelector('.question-title')?.textContent === 'New question', 'loaded pages must keep receiving new questions');
    check(!document.querySelector('[data-question-id="q60"]'), 'deleted records disappear from loaded pages');
    check(document.querySelector('[data-question-id="q99"]'), 'refresh must retain the loaded tail');
    check(document.querySelector('[data-question-id="q75"] .question-saved')?.textContent?.includes('1'), 'saved answer progress refreshes past page one');
    check(scroller.scrollTop >= scroll, 'refresh must not reset scroll to top');
  } else if (scenario === 'slow-list') {
    delay = true; await tick(); await tick(); await tick();
    delay = false; pending.shift()!(); await pause();
    check(document.querySelector('.question-scroll')?.getAttribute('aria-busy') === 'false', 'slow refresh must finish despite intervening polls');
  } else {
    await click('.question-main'); delay = true; await tick();
    if (scenario === 'back') await click('.question-header button');
    else if (scenario === 'escape') {
      await click(`button[aria-label="${copy.questionMenu}"]`);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await pause();
      check(!document.querySelector('[role="menu"]') && document.querySelector('.question-reader'), 'first Escape closes only the action menu');
      check(document.activeElement === document.querySelector(`button[aria-label="${copy.questionMenu}"]`), 'menu Escape returns focus to its trigger');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await pause();
    }
    else if (scenario?.startsWith('menu-')) {
      await click(`button[aria-label="${copy.questionMenu}"]`);
      (window as any).historyTabReady = true;
      while (document.querySelector('[role="menu"]')) await pause();
      await pause();
      const expected = scenario === 'menu-shift-tab' ? Array.from(document.querySelectorAll('.question-prompt-actions > button')).find(node => node.textContent === copy.questionReask) : document.querySelector('.question-header button');
      check(document.activeElement === expected, 'Tab closes the menu and stays within history in the expected order');
    }
    else if (scenario === 'close') await click('.panel-close');
    else if (scenario === 'switch') {
      await click('.question-header button'); delay = false;
      await click('[data-question-id="q1"] .question-main');
    } else if (scenario === 'delete') {
      await click(`button[aria-label="${copy.questionMenu}"]`);
      await click('[role="menu"] button');
      delay = false; await click('.confirm-actions .primary');
    }
    else if (scenario === 'slow-detail') { await tick(); await tick(); }
    delay = false; pending.shift()!(); await pause();
    if (scenario === 'close') check(!document.querySelector('.question-history'), 'late detail cannot reopen closed history');
    else if (scenario === 'switch') check(document.querySelector('.question-reader h2')?.textContent === 'Question 1', 'old detail must not replace the new selection');
    else if (scenario === 'delete') check(!document.querySelector('.question-reader') && !document.querySelector('[data-question-id="q0"]'), 'late detail must not restore a deleted question');
    else if (scenario === 'slow-detail') check(pending.length === 0, 'detail polling must not replace an in-flight read');
    else if (scenario?.startsWith('menu-')) check(document.querySelector('.question-reader'), 'Tab keeps the history detail open');
    else check(cards().length === 50, 'late detail cannot reopen after returning to list');
  }
}
(window as any).historyResult = run().then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
