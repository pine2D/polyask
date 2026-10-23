import assert from 'node:assert/strict';
import test from 'node:test';
import type { DecisionRecord } from '../src/shared/decision';
import { REPORT_EXPORT_COPY } from '../src/shared/report-export-copy';
import { parseReportExportRequest } from '../src/shared/report-export';
import { renderReportHtml } from '../src/main/report-template';
import { archiveFixture } from './fixtures';
const { JSDOM } = require('jsdom');

test('report request accepts only finite export intent and language, never paths or document content', () => {
  assert.deepEqual(parseReportExportRequest({ kind: 'archive', id: 'saved', format: 'html' }),
    { kind: 'archive', id: 'saved', format: 'html', locale: 'en' });
  const base = { kind: 'decision', id: 'saved', format: 'pdf', locale: 'zhTW' };
  for (const input of [null, [], {}, { ...base, kind: 'file' }, { ...base, id: '' }, { ...base, id: 'a'.repeat(129) },
    { ...base, id: 'a\n' }, { ...base, format: 'svg' }, { ...base, locale: 'arbitrary' },
    { ...base, filePath: '/renderer/output.pdf' }, { ...base, html: '<html>injected</html>' }]) {
    assert.throws(() => parseReportExportRequest(input), /invalid_request/);
  }
});

test('HTML report preserves useful text and tables without executable markup, images or unsafe links', () => {
  const archive = { ...archiveFixture(), task: '<img src=x onerror="alert(1)">', results: [{
    host: 'example.test', label: '<script>site</script>', code: 'answer_truncated',
    text: ['# Saved heading', '<script>alert(1)</script>', '<iframe src="https://evil.test"></iframe>',
      '<style>@import "https://evil.test/style";</style>', '![saved image caption](https://evil.test/pixel)',
      '![local](file:///private.txt)', '![inline](data:image/svg+xml;base64,PHN2Zz4=)',
      '[Meaningful reference](https://example.test/source?x=1&y=2)', '[secret](https://name:password@example.test)',
      '[mail label](mailto:person@example.test)', '[bad](javascript:alert(1))',
      '| Key | Value |', '| --- | --- |', '| alpha | 42 |', '```html', '<img src=x>', '```'].join('\n\n')
  }] };
  const dom = new JSDOM(renderReportHtml({ kind: 'archive', archive }));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('script,img,iframe,object,embed,link,base,form').length, 0);
    assert.equal(doc.querySelectorAll('[onclick],[onerror],[src],[srcset]').length, 0);
    for (const link of doc.querySelectorAll('a')) {
      const url = new URL(link.getAttribute('href')!);
      assert.equal(['https:', 'http:'].includes(url.protocol), true);
      assert.equal(url.username + url.password, '');
    }
    const reference = doc.querySelector('a[href^="https://example.test/source"]');
    assert.equal(reference?.getAttribute('href'), 'https://example.test/source?x=1&y=2');
    assert.equal(reference?.textContent, 'Meaningful reference');
    assert.match(doc.body.textContent ?? '', /saved image caption/);
    assert.match(doc.body.textContent ?? '', /mail label/);
    assert.match(doc.body.textContent ?? '', /<script>alert\(1\)<\/script>/);
    assert.match(doc.querySelector('main')?.textContent ?? '', /truncat/i);
    assert.equal(doc.querySelector('main h3')?.textContent, 'Saved heading');
    assert.equal(doc.querySelector('meta[http-equiv]')?.getAttribute('content')?.includes("default-src 'none'"), true);
    assert.match(doc.body.textContent ?? '', /Original question images/);
    assert.doesNotMatch(doc.querySelector('style')?.textContent ?? '', /url\s*\(|@import/i);
  } finally { dom.window.close(); }
});

test('report shows every source number, missing or unverified content, notes and saved synthesis', () => {
  const archive = { ...archiveFixture(), winnerHost: 'claude.ai', note: 'My manual note', tags: ['work'],
    results: [{ host: 'claude.ai', label: 'Claude', text: 'Saved answer\n\n| Name | Value |\n| --- | --- |\n| alpha | 42 |' },
      { host: 'chatgpt.com', label: 'ChatGPT', text: null, code: 'no_answer' }],
    synthesis: { host: 'claude.ai', state: null, instruction: 'Compare carefully', text: 'Saved synthesis', createdAt: 1234 } };
  const dom = new JSDOM(renderReportHtml({ kind: 'archive', archive }, 'zhCN'));
  try {
    const doc = dom.window.document, text = doc.body.textContent ?? '';
    assert.equal(doc.documentElement.lang, 'zh-CN');
    assert.match(text, /\[S1\] Claude/); assert.match(text, /\[S2\] ChatGPT/);
    assert.match(text, /完整性未验证/); assert.match(text, /未保存回答正文/);
    assert.match(text, /由你选为最佳回答/); assert.match(text, /My manual note/);
    assert.match(text, /Saved synthesis/); assert.match(text, /Compare carefully/);
    assert.equal(doc.querySelectorAll('table tbody tr').length, 1);
    assert.match(doc.querySelector('style')?.textContent ?? '', /table-header-group/);
  } finally { dom.window.close(); }
});

test('independent decision report retains exact excerpts and identifies unavailable or changed source', () => {
  const archive = archiveFixture();
  const decision: DecisionRecord = { id: 'd', archiveId: archive.id, sourceTitle: 'Saved question title', title: 'My decision',
    conclusion: 'Choose one', rationale: 'Because', uncertainties: 'To check', nextStep: 'Verify', status: 'final',
    evidence: [{ resultIndex: 0, excerpt: '**Exact** <source>', host: 'claude.ai', label: 'Claude', capturedAt: 1000 }],
    createdAt: 1000, updatedAt: 2000, schema: 2, deviceId: 'device' };
  for (const available of [archive, null]) {
    const dom = new JSDOM(renderReportHtml({ kind: 'decision', decision, archive: available }, 'zhTW'));
    try {
      const doc = dom.window.document, text = doc.body.textContent ?? '';
      assert.equal(doc.querySelector('blockquote.excerpt')?.textContent, '**Exact** <source>');
      assert.match(text, /Choose one/); assert.match(text, /Because/); assert.match(text, /To check/); assert.match(text, /Verify/);
      assert.match(text, /修改狀態不會自動驗證內容/);
      assert.match(text, available ? /與目前可讀取的來源不一致/ : /問題標題快照/);
      assert.equal(text.includes('Rayleigh scattering.'), !!available);
    } finally { dom.window.close(); }
  }
});

test('report translations keep matching keys and safe timestamp fallbacks', () => {
  const keys = Object.keys(REPORT_EXPORT_COPY.en).sort();
  for (const locale of ['en', 'zhCN', 'zhTW'] as const) {
    assert.deepEqual(Object.keys(REPORT_EXPORT_COPY[locale]).sort(), keys);
    assert.equal(Object.values(REPORT_EXPORT_COPY[locale]).every(value => value.trim().length > 0), true);
    const html = renderReportHtml({ kind: 'archive', archive: { ...archiveFixture(), ts: Number.MAX_SAFE_INTEGER } }, locale);
    assert.match(html, /—/); assert.doesNotMatch(html, /Invalid Date/);
  }
});
