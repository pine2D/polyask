'use strict';
const { JSDOM } = require('jsdom');
const { source } = require('./intl-harness');
function presetPage(options = {}) {
  const dom = new JSDOM('<body><button id="model-trigger" data-testid="model-selector-dropdown"></button><textarea>untouched draft</textarea></body>',
    { url: 'https://claude.ai/new', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30 };
  };
  w.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]; };
  const choices = options.choices || { 'Fable 5.2': ['Low', 'Medium', 'High', 'Extra', 'Max'],
    'Opus 5.5': ['Medium', 'High', 'Max'], 'Future 8.3': ['Balanced', 'Deep'], 'Haiku 5.5': [] };
  const state = { model: 'Fable 5.2', effort: 'Medium' }, clicks = [];
  let listener, closes = 0;
  const button = d.querySelector('button');
  function label() {
    button.innerHTML = `<span aria-hidden="true">icon</span><span><span>${state.model}</span>${state.effort ? `<span> ${state.effort}</span>` : ''}</span>`;
    button.setAttribute('aria-label', `Model: ${state.model}${state.effort ? ` ${state.effort}` : ''}`);
  }
  function close() {
    d.querySelectorAll('[role="menu"]').forEach(el => options.keepClosed ? el.setAttribute('data-closed', '') : el.remove());
    button.setAttribute('aria-expanded', 'false'); closes++;
  }
  function radio(name, kind, parent, disabled = false) {
    const el = d.createElement('div'); el.setAttribute('role', 'menuitemradio');
    el.innerHTML = `<span><span><span>${name}</span></span><span>${kind === 'model' ? 'For your work' : 'Recommended'}</span></span><span aria-hidden="true">icon</span>`;
    el.setAttribute('aria-checked', String(state[kind] === name));
    if (disabled) el.setAttribute('aria-disabled', 'true');
    el.addEventListener('click', () => {
      clicks.push(`${kind}:${name}`);
      if (disabled || options.ignore === `${kind}:${name}`) return;
      if (kind === 'model') {
        state.model = name;
        if (!choices[name].includes(state.effort)) state.effort = choices[name][0] || null;
      } else state.effort = name;
      label(); close();
      options.afterClick?.(kind, name, state);
    });
    parent.append(el); return el;
  }
  function open() {
    close(); button.setAttribute('aria-expanded', 'true');
    const menu = d.createElement('div'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-labelledby', button.id);
    const group = d.createElement('div'); group.setAttribute('role', 'group'); menu.append(group);
    const names = Object.keys(choices), top = options.submenu ? names.slice(0, 2) : names;
    top.forEach(name => radio(name, 'model', group, options.disabled === name));
    if (options.submenu) {
      const more = d.createElement('div'); more.id = 'more-models'; more.setAttribute('role', 'menuitem');
      more.setAttribute('aria-haspopup', 'menu'); more.textContent = 'More models';
      more.addEventListener('click', () => {
        const sub = d.createElement('div'); sub.setAttribute('role', 'menu'); sub.setAttribute('aria-labelledby', more.id);
        names.slice(2).forEach(name => radio(name, 'model', sub)); d.body.append(sub);
      }); menu.append(more);
    }
    if (options.duplicate) radio(options.duplicate, 'model', group);
    if (options.hidden) { const h = radio(options.hidden, 'model', group); h.hidden = true; }
    if (choices[state.model].length && !options.missingEffort) {
      if (options.nestedEffort) {
        const trigger = d.createElement('div'); trigger.id = 'effort-trigger'; trigger.setAttribute('role', 'menuitem');
        trigger.setAttribute('aria-haspopup', 'menu'); trigger.textContent = `Effort ${state.effort}`;
        trigger.addEventListener('click', () => {
          const sub = d.createElement('div'); sub.setAttribute('role', 'menu'); sub.setAttribute('aria-labelledby', trigger.id);
          choices[state.model].forEach(name => radio(name, 'effort', sub)); d.body.append(sub);
        }); menu.append(trigger);
      } else {
        const efforts = d.createElement('div'); efforts.setAttribute('role', 'group'); efforts.setAttribute('aria-labelledby', 'effort-label');
        efforts.innerHTML = '<div id="effort-label" aria-hidden="true">Effort</div>';
        choices[state.model].forEach(name => radio(name, 'effort', efforts)); menu.append(efforts);
      }
    }
    d.body.append(menu);
  }
  label(); button.addEventListener('click', open);
  d.body.addEventListener('keydown', e => { if (e.key === 'Escape' && (!options.scopedEscape || e.target.closest?.('[role="menu"]'))) {
    if (options.asyncEscape) w.setTimeout(close, 30); else close();
  } });
  w.t = key => key;
  w.chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  for (const file of ['core.js', 'tier.js', 'preset-common.js', 'adapters-intl.js', 'claude-presets.js', 'preset-command.js']) {
    try { w.eval(source(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const S = w.__AMS;
  S.generationProbe = () => options.generating ? 'generating' : 'idle';
  return { dom, state, clicks, S, a: S.adapters['claude.ai'], closes: () => closes,
    menus: () => d.querySelectorAll('[role="menu"]').length,
    dispatch: message => new Promise(resolve => listener({ source: 'AMS', deadline: Date.now() + 10000, ...message }, {}, resolve)),
    command: action => new Promise(resolve => listener({ source: 'AMS', cmd: 'tierPreset', action, deadline: Date.now() + 10000 }, {}, resolve)),
    close: () => dom.window.close() };
}
module.exports = { presetPage };
