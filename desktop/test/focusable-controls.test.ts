import test from 'node:test';
import assert from 'node:assert/strict';
import { focusableControls } from '../src/renderer/focusable-controls';

function controls(markup: string) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<!doctype html><main>${markup}</main>`);
  const root = dom.window.document.querySelector('main') as HTMLElement;
  try { return focusableControls(root).map(node => node.id); }
  finally { dom.window.close(); }
}

test('focus circle includes source links, forms, first summaries and editable roots in native order without layout guesses', () => {
  assert.deepEqual(controls(`
    <button id="button">Action</button><a id="source" href="https://example.com">Source</a><a id="no-href">Text</a>
    <input id="input"><textarea id="textarea"></textarea><select id="select"><option>Value</option></select>
    <details><summary id="summary">More</summary><summary id="extra-summary">Not a toggle</summary></details>
    <div id="tab-zero" tabindex="0"></div><div id="editable" contenteditable><span contenteditable="true" id="nested-editable"></span></div>
    <div id="plaintext" contenteditable="plaintext-only"></div><div contenteditable="false" id="non-editable"></div>
  `), ['button', 'source', 'input', 'textarea', 'select', 'summary', 'tab-zero', 'editable', 'plaintext']);
});

test('focus circle skips native-disabled, hidden, inert and negative-tabindex candidates including ancestor styles', () => {
  assert.deepEqual(controls(`
    <button id="visible">Visible</button><button disabled id="disabled">Disabled</button><input type="hidden" id="hidden-input">
    <button tabindex="-1" id="negative">Negative</button><input disabled id="disabled-input"><select disabled id="disabled-select"></select>
    <textarea disabled id="disabled-textarea"></textarea><div tabindex="bad" id="invalid-tab"></div>
    <div hidden><a href="https://example.com" id="hidden-link">Hidden</a></div><button hidden id="hidden-button">Hidden</button>
    <div inert><button id="inert">Inert</button></div><div style="display:none"><input id="display-none"></div>
    <div style="visibility:hidden"><button id="invisible">Invisible</button></div><div style="opacity:0"><button id="transparent">Transparent</button></div>
    <fieldset disabled><legend><button id="legend">Allowed legend</button></legend><button id="fieldset-disabled">Disabled</button></fieldset>
  `), ['visible', 'legend']);
});

test('closed details keep only their first summary and open details expose their controls', () => {
  assert.deepEqual(controls(`
    <details><summary id="closed-summary"><a id="summary-link" href="https://example.com">Source</a></summary><button id="closed-body">Closed</button></details>
    <details open><summary id="open-summary">Open</summary><a id="open-link" href="https://example.com">Source</a>
      <details><summary id="nested-summary">Nested</summary><textarea id="nested-closed"></textarea></details>
    </details>
  `), ['closed-summary', 'summary-link', 'open-summary', 'open-link', 'nested-summary']);
});

test('an explicitly focusable details element stays reachable while only its body is collapsed', () => {
  assert.deepEqual(controls('<details id="details" tabindex="0"><summary id="summary">More</summary><input id="closed-input"></details>'), ['details', 'summary']);
});

test('positive tabindex controls precede ordinary controls and retain document order for equal ranks', () => {
  assert.deepEqual(controls('<button id="normal">Action</button><div id="second" tabindex="2"></div><a id="first" href="https://example.com" tabindex="1">First</a><button id="also-first" tabindex="1">Same rank</button>'),
    ['first', 'also-first', 'second', 'normal']);
});
