import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryContentRow } from '../src/renderer/library-content-row';
import { getCopy } from '../src/shared/copy';
import { getLibraryCopy } from '../src/shared/library-scale-copy';
import { createArchiveRecord, isArchiveRecord } from '../src/shared/archive';

test('source summaries expose the total and a short preview while retaining every source for assistive reading', () => {
  const record = createArchiveRecord({ text: 'Question', task: 'Question', results: ['Claude', 'ChatGPT', 'Kimi'].map(label => ({ host: label, label, text: 'Saved answer' })) },
    { id: 'saved', now: 100, deviceId: 'fixture' });
  for (const [locale, count] of [['en', 'Sources: 3'], ['zh-CN', '3 个来源'], ['zh-TW', '3 個來源']]) {
    const html = renderToStaticMarkup(<LibraryContentRow item={{ kind: 'archive', record }} copy={getCopy(locale)} labels={getLibraryCopy(locale)}
      locale={locale} current={false} checked={false} disabled={false} onCheck={() => {}} onOpen={() => {}} />);
    assert.ok(html.includes(`class="library-source-count">${count}</span>`));
    assert.match(html, /class="library-source-preview" aria-hidden="true">Claude, ChatGPT<\/span>/);
    assert.match(html, /class="sr-only">Claude, ChatGPT, Kimi<\/span>/);
    assert.match(html, /title="Claude, ChatGPT, Kimi"/);
  }
});

test('a valid sync clock beyond the Date range cannot break the saved-result list', () => {
  const record = createArchiveRecord({ text: 'Retain this saved answer', task: 'Retain this saved answer', results: [{ host: 'claude.ai', label: 'Claude', text: 'Answer' }] },
    { id: 'future-clock', now: Number.MAX_SAFE_INTEGER, deviceId: 'fixture' });
  assert.equal(isArchiveRecord(record), true, 'sync clocks can exceed the representable calendar range');
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    const html = renderToStaticMarkup(<LibraryContentRow item={{ kind: 'archive', record }} copy={getCopy(locale)} labels={getLibraryCopy(locale)}
      locale={locale} current={false} checked={false} disabled={false} onCheck={() => {}} onOpen={() => {}} />);
    assert.match(html, /Retain this saved answer/);
    assert.match(html, /<time>—<\/time>/);
  }
});
