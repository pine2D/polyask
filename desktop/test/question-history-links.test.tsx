import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistoryReader } from '../src/renderer/question-history-reader';
import { getCopy } from '../src/shared/copy';
import { setShellApi } from '../src/renderer/shell-api';
import { readingDetail } from './ui/reading-data';

test('history toolbar separates current-copy actions from question actions and keeps read-only actions available', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const copied: string[] = [], opened: string[] = [], announced: string[] = [], restored: (string | undefined)[] = [];
  let reasked = 0, deleted = 0;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    ResizeObserver: class { observe() {} disconnect() {} },
    navigator: { clipboard: { writeText: async (url: string) => { copied.push(url); } } }, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  setShellApi({ openExternal: async (url: string) => { opened.push(url); } } as any);
  const root = createRoot(dom.window.document.getElementById('root'));
  // 本例只测会话动作，图形在隔离 Electron 回归里测，避免伪造浏览器布局。
  const detail = { ...readingDetail, answers: readingDetail.answers.map(a => ({ ...a, answerMarkdown: `Saved answer ${a.id}` })) };
  const render = async (busy: boolean) => act(async () => root.render(<QuestionHistoryReader detail={detail} copy={getCopy('en')} sites={[]} busy={busy}
    onRestore={id => restored.push(id)} onReask={() => { reasked++; }} onDelete={() => { deleted++; }} onAnnounce={text => announced.push(text)} />));
  const button = (label: string) => dom.window.document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const byText = (text: string) => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text) as HTMLButtonElement;
  const click = async (node: HTMLButtonElement) => act(async () => node.click());
  try {
    await render(true);
    assert.equal(dom.window.document.querySelectorAll('.question-reader-intro button').length, 0,
      'the heading has no duplicate conversation or question actions');
    assert.equal(button('Copy original question').textContent, '', 'original-copy action uses an accessible icon');
    assert.equal(button('Copy original question').disabled, false);
    assert.equal(dom.window.document.querySelectorAll('.question-reader-actions').length, 1);
    assert.ok(button('Copy conversation link'), 'copy icon is present');
    assert.ok(button('Open conversation in browser'));
    assert.equal(button('Copy conversation link').textContent, '');
    assert.equal(button('Copy conversation link').disabled, false);
    assert.equal(button('Copy answer').textContent, '', 'copy answer is also an icon');
    assert.equal(button('Copy answer').disabled, false);
    assert.equal(byText('Open in app').disabled, true);
    assert.equal(button('Conversation opening options').disabled, true);
    assert.equal(button('More actions').disabled, true);
    await act(async () => button('Copy conversation link').click());
    await act(async () => button('Open conversation in browser').click());
    assert.deepEqual(copied, ['https://www.kimi.com/chat/second']);
    assert.deepEqual(opened, copied);
    assert.deepEqual(restored, [], 'read-only actions do not restore site views');
    await click(button('Copy original question'));
    assert.equal(copied.at(-1), detail.question.text, 'original-copy action preserves the complete question');
    await click(button('Copy answer'));
    assert.equal(copied.at(-1), 'Saved answer a2');
    await render(false);
    await click(byText('Open in app'));
    assert.deepEqual(restored, ['a2'], 'primary opens only the current attempt');
    const select = dom.window.document.querySelector('select');
    await act(async () => { select.value = 'a1'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => button('Copy conversation link').click());
    assert.equal(copied.at(-1), 'https://www.kimi.com/chat/first');
    await click(button('Copy answer'));
    assert.equal(copied.at(-1), 'Saved answer a1');
    await click(byText('Open in app'));
    assert.equal(restored.at(-1), 'a1');
    await click(button('Conversation opening options'));
    assert.equal(dom.window.document.activeElement.textContent, 'Open all site conversations');
    await act(async () => dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal((dom.window.document.querySelector('[role="menu"]')) === (null), true);
    assert.equal((dom.window.document.activeElement) === (button('Conversation opening options')), true);
    await click(button('Conversation opening options'));
    await act(async () => dom.window.document.querySelector('.question-site-tabs button:last-child').click());
    assert.equal((dom.window.document.querySelector('[role="menu"]')) === (null), true, 'changing the selected copy closes the old menu');
    assert.equal(byText('Open in app').disabled, true);
    assert.equal(button('Copy conversation link').disabled, true);
    assert.equal(button('Open conversation in browser').disabled, true);
    assert.equal(button('Copy answer').disabled, false, 'a saved copy remains copyable without a URL');
    assert.equal(button('Conversation opening options').disabled, false, 'other sites remain restorable');
    await click(button('Conversation opening options'));
    await click(byText('Open all site conversations'));
    assert.equal(restored.at(-1), undefined, 'all-site restore uses the question scope');
    assert.equal((dom.window.document.querySelector('[role="menu"]')) === (null), true);
    await click(byText(getCopy('en').questionReask));
    assert.equal(reasked, 1);
    assert.equal(deleted, 0);
    await click(button('More actions'));
    await render(true);
    assert.equal((dom.window.document.querySelector('[role="menu"]')) === (null), true, 'becoming busy closes question actions');
    await render(false);
    await click(button('More actions'));
    await click(byText('Delete this question and copies'));
    assert.equal(deleted, 1);
    assert.ok(announced.includes('Conversation link copied.'));
  } finally {
    await act(async () => root.unmount()); dom.window.close(); setShellApi(null);
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
