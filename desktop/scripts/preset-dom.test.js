'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page } = require('./lib/site-preset-harness');
test('Closed popup triggers remain usable, while closed menus and disabled items are rejected', () => {
  const f = page('example.com', `<button id="trigger" data-state="closed" data-disabled="false"></button>
    <div role="menu" data-state="closed"><button id="closed"></button></div>
    <button id="disabled" data-disabled></button><button id="true" data-disabled="true"></button>`);
  try {
    const P = f.S.presetDom, el = id => f.d.getElementById(id);
    assert.equal(P.visible(el('trigger')), true); assert.equal(P.enabled(el('trigger')), true);
    assert.equal(P.visible(el('closed')), false); assert.equal(P.enabled(el('disabled')), false);
    assert.equal(P.enabled(el('true')), false);
  } finally { f.close(); }
});

test('An explicitly collapsed trigger cannot own a lingering menu', () => {
  const f = page('example.com', '<button id="trigger" aria-expanded="false" aria-controls="menu"></button><div id="menu" role="menu" aria-labelledby="trigger"></div>');
  try { assert.equal(f.S.presetDom.owned(f.d.getElementById('trigger')) === null, true); } finally { f.close(); }
});
