import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
import { ArchiveDetail } from '../src/renderer/archive-detail';
import { ArchiveCompare } from '../src/renderer/archive-compare';
import { getCopy } from '../src/shared/copy';
import { SITES } from '../src/main/sites';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const table = '| Option | Cost |\n| --- | --- |\n| Keep | Low |';
const body = `${table}\n\nSame explanation.\n\n${table}`;
const noop = () => {};
const labels = (doc: Document) => [...doc.querySelectorAll('.markdown-table')].map(node => node.getAttribute('aria-label'));

test('identical tables across nine answers keep distinct source names and local table numbers', async () => {
  const record = { ...archiveFixture(), results: SITES.map(site => ({ host: site.host, label: site.label, text: body })) };
  const h = await mountDom(<ArchiveDetail record={record} copy={getCopy('en')} locale="en" busy={false}
    onPatch={noop} onOpenSource={noop} pendingSynthesis={null} synthesisCandidate={null}
    onSynthesize={noop} onCollectSynthesis={noop} onSaveSynthesis={noop} />);
  try {
    const names = labels(h.document);
    assert.equal(names.length, 18); assert.equal(new Set(names).size, 18);
    assert.equal(names[0], '[S1] Claude, table 1'); assert.equal(names[1], '[S1] Claude, table 2');
    assert.equal(names[16]?.includes('[S9]'), true);
    assert.equal(h.document.querySelectorAll('.markdown-table[tabindex="0"][role="region"]').length, 18);
    assert.equal(h.document.querySelectorAll('th[scope="col"]').length, 36);
  } finally { await h.close(); }
});

test('comparison keeps repeated table regions distinct within each source and between columns', async () => {
  const record = { ...archiveFixture(), results: SITES.slice(0, 2).map(site => ({ host: site.host, label: site.label, text: body })) };
  const h = await mountDom(<ArchiveCompare copy={getCopy('en')} record={record} results={record.results} />);
  try {
    const names = labels(h.document);
    assert.equal(names.length, 4); assert.equal(new Set(names).size, 4);
    assert.equal(names.every(name => name?.includes('Claude') || name?.includes('ChatGPT')), true);
    assert.equal(names.every(name => name?.includes('[S1]') || name?.includes('[S2]')), true);
  } finally { await h.close(); }
});

for (const [locale, name] of [['en', '[S1] Claude, table 1'], ['zh-CN', '[S1] Claude，表格 1'], ['zh-TW', '[S1] Claude，表格 1']] as const) {
  test(`${locale}: a table name follows its reading context without changing its content`, async () => {
    const h = await mountDom(<MarkdownPreview value={table} contextLabel="[S1] Claude" />, win => { win.document.documentElement.lang = locale; });
    try {
      assert.equal(labels(h.document)[0], name);
      await h.render(<MarkdownPreview value={table} contextLabel="[S2] ChatGPT" />);
      assert.equal(labels(h.document)[0]?.includes('[S2] ChatGPT'), true);
      assert.equal(h.document.querySelector('table')?.textContent, 'OptionCostKeepLow');
    } finally { await h.close(); }
  });
}
