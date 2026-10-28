import assert from 'node:assert/strict';
import test from 'node:test';
import { findPositionScript } from '../src/main/site-find-position-script';
const { JSDOM } = require('jsdom');

function fixture(body: string, nativeRoot = false) {
  const dom = new JSDOM(`<style>html,body{overflow-y:hidden}p,main{display:block}</style>${body}`, { runScripts: 'outside-only' });
  const window = dom.window as Window & typeof globalThis;
  const root = window.document.documentElement;
  Object.defineProperty(window.document, 'scrollingElement', { value: root });
  Object.defineProperties(root, { scrollHeight: { value: nativeRoot ? 1200 : 400 }, clientHeight: { value: 400 } });
  if (nativeRoot) { root.style.overflowY = 'auto'; window.document.body.style.overflowY = 'auto'; }
  const computed = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element, pseudo?: string | null) => pseudo
    ? { display: 'block', width: '12px' } as CSSStyleDeclaration : computed(element);
  for (const element of window.document.querySelectorAll<HTMLElement>('[data-scroll]')) {
    Object.defineProperties(element, { scrollHeight: { value: Number(element.dataset.scroll) }, clientHeight: { value: 400 } });
    element.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  }
  window.Range.prototype.getBoundingClientRect = function() {
    const element = this.startContainer.parentElement?.closest<HTMLElement>('[data-y]');
    return { top: Number(element?.dataset.y ?? 0), height: 20, width: 70 } as DOMRect;
  };
  return { dom, window, read: async (query: string, count: number) => {
    const value = await window.eval(findPositionScript(query, count));
    return value === null ? null : Array.from(value as number[]);
  } };
}
const scroll = (text: string) => `<main data-scroll="1200" style="overflow-y:auto">${text}</main>`;

test('read-only positions use the internal scroll extent and match across inline nodes', async () => {
  const h = fixture(scroll('<p data-y="120">need<span style="display:inline">le</span></p><p data-y="960">NEEDLE</p>'));
  try {
    const before = h.window.document.body.innerHTML;
    const positions = await h.read('needle', 2);
    assert.equal(positions?.length, 2);
    assert.equal(Math.abs(positions![0] - 0.1) < 0.002, true);
    assert.equal(Math.abs(positions![1] - 0.8) < 0.002, true);
    assert.equal(h.window.document.body.innerHTML, before);
    assert.equal(h.window.document.querySelector('main')!.scrollTop, 0);
  } finally { h.dom.window.close(); }
});

test('query punctuation and escapes remain literal, including code-like searches', async () => {
  const h = fixture(scroll('<p data-y="120"></p>'));
  try {
    const p = h.window.document.querySelector('p')!;
    for (const query of ['a.b', 'a+b', '[x]', 'foo\\bar', '(x)?', '${x}', 'a|b']) {
      p.textContent = query;
      assert.equal((await h.read(query, 1))?.length, 1, query);
    }
  } finally { h.dom.window.close(); }
});

test('native root ticks, hidden/input text and uncertain counts never produce misleading summaries', async () => {
  const h = fixture(scroll('<p data-y="120">needle</p><p hidden>needle</p><p style="display:none">needle</p><textarea>needle</textarea>'));
  const root = fixture('<p data-y="120">needle</p>', true);
  try {
    assert.equal((await h.read('needle', 1))?.length, 1);
    assert.equal(await h.read('needle', 2), null);
    assert.equal(await root.read('needle', 1), null);
    assert.equal(await h.read('x'.repeat(513), 1), null);
    assert.equal(await h.read('needle', 0), null);
  } finally { h.dom.window.close(); root.dom.window.close(); }
});

test('independent scroll areas and text budgets fail closed', async () => {
  const h = fixture(scroll('<p>needle</p>') + scroll('<p>needle</p>'));
  const large = fixture(scroll(`<p>${'x'.repeat(1000001)}needle</p>`));
  try {
    assert.equal(await h.read('needle', 2), null);
    assert.equal(await large.read('needle', 1), null);
  } finally { h.dom.window.close(); large.dom.window.close(); }
});
