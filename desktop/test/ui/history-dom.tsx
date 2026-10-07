import { act, StrictMode } from 'react';
import { mountDom } from './dom-harness';
import { getCopy } from '../../src/shared/copy';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { SITES } from '../../src/main/sites';
import { questionFixture, questionAnswerFixture } from '../question-fixtures';
import { questionAnswerId } from '../../src/main/question-repository';
import type { QuestionDetail } from '../../src/shared/question-history';
import type { ReactNode } from 'react';

export const copy = getCopy('en');
export const q = { ...questionFixture(), sites: ['claude', 'kimi'] as const };
export const a1 = { ...questionAnswerFixture(q.id, 1), answerMarkdown: 'OLD CLAUDE BODY' };
export const a2 = { ...questionAnswerFixture(q.id, 2), answerMarkdown: 'LATEST CLAUDE BODY' };
export const b = { ...a1, id: questionAnswerId(q.id, 'kimi', 1), site: 'kimi' as const, answerMarkdown: 'KIMI BODY' };
export const detail = (id = a2.id): QuestionDetail => ({ question: q, loadedAnswerId: id,
  answers: [a1, a2, b].map(a => ({ ...a, answerMarkdown: a.id === id ? a.answerMarkdown : null })) });
export function deferred<T>() { let resolve!: (v: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export async function waitFor(predicate: () => unknown) {
  const end = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > end) throw new Error('condition did not become ready'); await act(async () => new Promise(r => setTimeout(r, 10))); }
}
export async function historyMount(overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}, options: { strictMode?: boolean } = {}) {
  const css = require.extensions['.css']; require.extensions['.css'] = () => {};
  const { QuestionHistory } = await import('../../src/renderer/question-history');
  const resize = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  setShellApi({ setSurface: () => {}, setQuestionPanel: async () => {}, onQuestionSaveFailed: () => () => {},
    listLegacyQuestions: async () => ({ items: [], cursor: null }),
    listQuestions: async () => ({ items: [{ ...q, savedSites: 2, answers: [a1, a2, b] }], cursor: null }),
    getQuestion: async (_q: string, id?: string) => detail(id), ...overrides } as any);
  let currentProps = props;
  const element = () => {
    const content = <FeedbackProvider copy={copy}><QuestionHistory open copy={copy} sites={SITES} draft="" busy={false}
      onBlockingChange={() => {}} onOpen={() => {}} onClose={() => {}} onDraft={() => {}} {...currentProps} /></FeedbackProvider>;
    return options.strictMode ? <StrictMode>{content}</StrictMode> : content;
  };
  const h = await mountDom(element() as ReactNode);
  const button = (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent === label || n.getAttribute('aria-label') === label)!;
  return { ...h, button, async rerender(next: Record<string, unknown>) { currentProps = { ...currentProps, ...next }; await h.render(element()); },
    async select(node: HTMLSelectElement, value: string) { await act(async () => { node.value = value; node.dispatchEvent(new h.window.Event('change', { bubbles: true })); }); },
    async close() { await h.close(); setShellApi(null); if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
      if (resize) Object.defineProperty(globalThis, 'ResizeObserver', resize); else Reflect.deleteProperty(globalThis, 'ResizeObserver'); } };
}
