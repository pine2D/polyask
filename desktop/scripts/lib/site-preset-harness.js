'use strict';
const { JSDOM } = require('jsdom');
const { source } = require('./intl-harness');
function page(host, html, files = []) {
  const dom = new JSDOM(`<body>${html}<textarea>untouched draft</textarea></body>`,
    { url: `https://${host}/chat`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document; let listener;
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.closest('[hidden],[role="menu"][data-state="closed"],[role="dialog"][data-state="closed"],[data-css-hidden]');
    return { width: hidden ? 0 : 200, height: hidden ? 0 : 30, x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 30 };
  };
  w.HTMLElement.prototype.getClientRects = function () { return this.getBoundingClientRect().height ? [this.getBoundingClientRect()] : []; };
  w.t = key => key; w.chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  const load = file => { try { w.eval(source(`${file}.js`)); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
  ['core', 'tier', 'selection-match', 'preset-common', 'preset-dom', ...files, 'preset-command'].forEach(load);
  const S = w.__AMS; S.generationProbe = () => 'idle';
  return { dom, d, w, S, a: S.pickAdapter(), load,
    command: action => new Promise(resolve => listener({ source: 'AMS', cmd: 'tierPreset', action, deadline: Date.now() + 10000 }, {}, resolve)),
    menus: () => [...d.querySelectorAll('[role="menu"]')].filter(el => el.getClientRects().length).length,
    close: () => w.close() };
}
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { page, plain };
