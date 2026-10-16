import assert from 'node:assert/strict';
import test from 'node:test';
import { ArchiveDetail } from '../src/renderer/archive-detail';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const question = `  ${'如何比较不同 AI 的回答并保留来源？'.repeat(8)}\n\n  完整原文 😀  `;
for (const locale of ['zh-CN', 'zh-TW', 'en']) test(`${locale}: wrapped archive question offers explicit disclosure and preserves exact original`, async () => {
  const copy = getCopy(locale), record = { ...archiveFixture(), task: question, text: question };
  const detail = (text = question) => <main className="archive-detail-pane"><style>{'h1 { line-height: 30px; }'}</style><ArchiveDetail
    copy={copy} locale={locale} record={{ ...record, task: text, text }} busy={false}
    onPatch={() => {}} onOpenSource={() => {}} pendingSynthesis={null} synthesisCandidate={null}
    onSynthesize={() => {}} onCollectSynthesis={() => {}} onSaveSynthesis={() => {}} /></main>;
  const h = await mountDom(detail(), window => {
    // jsdom supplies no layout; these are the browser's measured three-line and full heights.
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true,
      get() { return this.tagName === 'H1' ? (this.textContent!.length > 100 ? 180 : 30) : 0; } });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true,
      get() { return this.tagName === 'H1' ? (this.classList.contains('is-summary') ? Math.min(this.scrollHeight, 90) : this.scrollHeight) : 0; } });
  });
  const control = () => [...h.document.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.textContent === copy.questionExpand || node.textContent === copy.questionCollapse);
  try {
    assert.equal(control() !== undefined, true, 'question wrapping beyond three lines needs disclosure');
    assert.equal(control()!.getAttribute('aria-expanded'), 'false');
    assert.equal(h.document.querySelector('h1')!.textContent, question);
    assert.equal(control()!.getAttribute('aria-controls'), h.document.querySelector('h1')!.id);
    await h.click(control()!);
    assert.equal(control()!.textContent, copy.questionCollapse);
    assert.equal(control()!.getAttribute('aria-expanded'), 'true');
    assert.equal(h.document.querySelector('h1')!.textContent, question);
    await h.render(detail());
    assert.equal(control()!.getAttribute('aria-expanded'), 'true', 'metadata refresh retains disclosure');
    await h.click(control()!);
    assert.equal(control()!.getAttribute('aria-expanded'), 'false');
    await h.render(detail('  Short original 😀  '));
    assert.equal(control() === undefined, true, 'short questions remain complete without an extra control');
    assert.equal(h.document.querySelector('h1')!.textContent, '  Short original 😀  ');
  } finally { await h.close(); }
});
