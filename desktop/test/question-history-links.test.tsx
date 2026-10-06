import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistoryReader } from '../src/renderer/question-history-reader';
import { getCopy } from '../src/shared/copy';
import { setShellApi } from '../src/renderer/shell-api';
import { readingDetail } from './ui/reading-data';

test('conversation icons use selected attempt; copying and browser opening remain available while busy', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const copied: string[] = [], opened: string[] = [], announced: string[] = [], restored: string[] = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: { clipboard: { writeText: async (url: string) => { copied.push(url); } } }, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  setShellApi({ openExternal: async (url: string) => { opened.push(url); } } as any);
  const root = createRoot(dom.window.document.getElementById('root'));
  // 本例只测会话动作，图形在隔离 Electron 回归里测，避免伪造浏览器布局。
  const detail = { ...readingDetail, answers: readingDetail.answers.map(a => ({ ...a, answerMarkdown: 'Saved answer' })) };
  const render = async (busy: boolean) => act(async () => root.render(<QuestionHistoryReader detail={detail} copy={getCopy('en')} sites={[]} busy={busy}
    onRestore={id => restored.push(id!)} onReask={() => {}} onDelete={() => {}} onAnnounce={text => announced.push(text)} />));
  const button = (label: string) => dom.window.document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  try {
    await render(true);
    assert.ok(button('Copy conversation link'), 'copy icon is present');
    assert.ok(button('Open conversation in browser'));
    assert.equal(button('Copy conversation link').textContent, '');
    assert.equal(button('Copy conversation link').disabled, false);
    await act(async () => button('Copy conversation link').click());
    await act(async () => button('Open conversation in browser').click());
    assert.deepEqual(copied, ['https://www.kimi.com/chat/second']);
    assert.deepEqual(opened, copied);
    assert.deepEqual(restored, [], 'read-only actions do not restore site views');
    const select = dom.window.document.querySelector('select');
    await act(async () => { select.value = 'a1'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => button('Copy conversation link').click());
    assert.equal(copied.at(-1), 'https://www.kimi.com/chat/first');
    await act(async () => dom.window.document.querySelector('.question-site-tabs button:last-child').click());
    assert.equal(button('Copy conversation link').disabled, true);
    assert.equal(button('Open conversation in browser').disabled, true);
    assert.ok(announced.includes('Conversation link copied.'));
  } finally {
    await act(async () => root.unmount()); dom.window.close(); setShellApi(null);
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
