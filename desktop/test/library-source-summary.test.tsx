import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryContentRow } from '../src/renderer/library-content-row';
import { getCopy } from '../src/shared/copy';
import { getLibraryCopy } from '../src/shared/library-scale-copy';
import { createArchiveRecord, isArchiveRecord } from '../src/shared/archive';

test('result rows prioritize the title and date without repeating type, sources or tags', () => {
  const record = { ...createArchiveRecord({ text: 'Question', task: 'Question', tags: ['Repeated tag'],
    results: ['Claude', 'ChatGPT', 'Kimi'].map(label => ({ host: label, label, text: 'Saved answer' })) },
    { id: 'saved', now: 100, deviceId: 'fixture' }), favorite: true, tags: ['Repeated tag'] };
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    const copy = getCopy(locale);
    const html = renderToStaticMarkup(<LibraryContentRow item={{ kind: 'archive', record }} copy={copy} labels={getLibraryCopy(locale)}
      locale={locale} current={true} checked={false} disabled={false} onCheck={() => {}} onOpen={() => {}} />);
    assert.match(html, /title="Question">Question/);
    assert.match(html, /<time dateTime="1970-01-01T00:00:00.100Z"/);
    assert.ok(html.includes(copy.libraryFavorited));
    assert.doesNotMatch(html, /Claude|ChatGPT|Kimi|Repeated tag|library-item-type|library-source-count/);
    assert.match(html, /aria-current="true"/);
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

test('mixed decision rows keep status, while a decision-only view omits the repeated kind', () => {
  const item = { kind: 'decision' as const, record: { id: 'card', title: 'Verify this decision', status: 'verify' as const, createdAt: 100, updatedAt: 200 } };
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    const props = { item, copy: getCopy(locale), labels: getLibraryCopy(locale), locale, current: false, checked: false, disabled: false, onCheck() {}, onOpen() {} };
    const mixed = renderToStaticMarkup(<LibraryContentRow {...props} />);
    const scoped = renderToStaticMarkup(<LibraryContentRow {...props} showKind={false} />);
    assert.ok(mixed.includes(props.copy.libraryCards));
    assert.ok(!scoped.includes(props.copy.libraryCards));
    assert.match(scoped, /data-status="verify"/);
    assert.match(scoped, /Verify this decision/);
  }
});

test('the list timestamp matches the selected sort field', () => {
  const record = { ...createArchiveRecord({ task: 'Find this', text: 'Find this', results: [] },
    { id: 'clock', now: 100, deviceId: 'fixture' }), updatedAt: 200 };
  const props = { item: {kind:'archive' as const, record}, copy:getCopy('en'), labels:getLibraryCopy('en'), locale:'en', current:false, checked:false, disabled:false, onCheck() {}, onOpen() {} };
  assert.match(renderToStaticMarkup(<LibraryContentRow {...props} />), /1970-01-01T00:00:00.200Z/);
  assert.match(renderToStaticMarkup(<LibraryContentRow {...props} sort="created-desc" />), /1970-01-01T00:00:00.100Z/);
});
