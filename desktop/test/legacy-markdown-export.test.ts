import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { DesktopDatabase } from '../src/main/database';
import { ArchiveService } from '../src/main/archive-service';
import { DecisionService } from '../src/main/decision-service';
import { getCopy } from '../src/shared/copy';
const { JSDOM } = require('jsdom');

const markup = '<img src="https://example.test/pixel"><script>example()</script>';
const body = `${markup}\n\n![remote caption](https://example.test/image)\n\n[Safe reference](https://example.test/source)\n\n## Answer heading`;

test('copy-result Markdown retains webpage observations and neutralizes active resource markup', () => {
  const db = DesktopDatabase.open(':memory:');
  const archives = new ArchiveService(db.archives, { deviceId: () => 'local', now: () => 100, createId: () => 'source' });
  const source = archives.add({ text: 'Complete saved prompt', task: 'Task summary',
    source: { kind: 'page', title: 'Source', url: 'https://name:password@example.test', capturedAt: 100, truncated: false },
    results: [{ host: 'claude.ai', label: markup, text: body, observation: { questionId: 'question', site: 'claude', attempt: 1, observedAt: 100,
      selection: { requested: 'think', observed: 'think', outcome: 'preferred', model: 'Synthetic model' } } }] });
  try {
    const copy = getCopy('en');
    const dom = new JSDOM(new MarkdownIt({ html: true }).render(archives.exportMarkdown(source.id, 'en')));
    try {
      const document = dom.window.document, text = document.body.textContent ?? '';
      assert.match(text, /Synthetic model/); assert.equal(text.includes(copy.observationNote), true);
      assert.match(text, /Complete saved prompt/); assert.match(text, /Task summary/);
      assert.equal(document.querySelectorAll('img,script,iframe,object').length, 0);
      assert.equal(document.querySelectorAll('[src],[onerror]').length, 0);
      assert.equal(document.querySelector('a[href="https://example.test/source"]')?.textContent, 'Safe reference');
      assert.equal([...document.querySelectorAll('a')].some(a => !!new URL(a.href).username), false);
      assert.equal(text.includes(markup), true, 'literal source markup remains available for review');
    } finally { dom.window.close(); }
  } finally { db.close(); }
});

test('direct decision Markdown export preserves evidence without creating executable markup', () => {
  const db = DesktopDatabase.open(':memory:');
  const archives = new ArchiveService(db.archives, { deviceId: () => 'local', now: () => 100, createId: () => 'source' });
  const decisions = new DecisionService(db.decisions, archives, { deviceId: () => 'local', now: () => 200, createId: () => 'card' });
  try {
    const source = archives.add({ text: markup, task: markup, results: [{ host: 'claude.ai', label: markup, text: body }] });
    const card = decisions.create({ archiveId: source.id, sourceUpdatedAt: source.updatedAt, title: markup,
      conclusion: body, rationale: '', uncertainties: '', nextStep: '', status: 'draft',
      evidence: [{ id: 'quote', topic: markup, resultIndex: 0, excerpt: markup }] });
    const dom = new JSDOM(new MarkdownIt({ html: true }).render(decisions.exportMarkdown(card.id, 'en')));
    try {
      assert.equal(dom.window.document.querySelectorAll('img,script,iframe,object').length, 0);
      assert.equal(dom.window.document.querySelector('h1')?.textContent, markup);
      assert.equal(dom.window.document.body.textContent?.includes('remote caption'), true);
      assert.equal(dom.window.document.querySelector('a[href="https://example.test/source"]')?.textContent, 'Safe reference');
      assert.equal(dom.window.document.body.textContent?.includes(markup), true);
    } finally { dom.window.close(); }
  } finally { db.close(); }
});
