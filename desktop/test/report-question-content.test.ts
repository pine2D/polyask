import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReportHtml } from '../src/main/report-template';
import { archiveFixture } from './fixtures';
const { JSDOM } = require('jsdom');

test('static reports preserve the full saved prompt when a separate task label exists', () => {
  const text = 'Full saved question with additional context.\nLiteral <img src="https://example.test/pixel">.';
  const archive = { ...archiveFixture(), task: 'Short task label', text };
  const dom = new JSDOM(renderReportHtml({ kind: 'archive', archive }, 'zhCN'));
  try {
    assert.deepEqual([...dom.window.document.querySelectorAll('.question')].map(node => node.textContent), ['Short task label', text]);
    assert.equal(dom.window.document.querySelectorAll('img').length, 0);
  } finally { dom.window.close(); }
  const duplicate = new JSDOM(renderReportHtml({ kind: 'archive', archive: { ...archive, task: text } }));
  try { assert.equal(duplicate.window.document.querySelectorAll('.question').length, 1); }
  finally { duplicate.window.close(); }
});
