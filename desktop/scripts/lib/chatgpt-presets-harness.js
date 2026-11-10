'use strict';
const { page } = require('./site-preset-harness');
function chatgpt(options = {}) {
  const f = page('chatgpt.com', '<button id="trigger" data-composer-navigation-target="reasoning" aria-haspopup="menu"></button>', ['adapters-intl2', 'chatgpt-default', 'chatgpt-preset-slider', 'chatgpt-presets']);
  const choices = options.legacy ? { '6': ['6 Instant', '6 Medium', '6 High', '6 Extra High', '6 Pro'], 'Future 8': ['Future Light', 'Future Deep'] }
    : { Default: ['GPT-6 Luna High', 'GPT-6.1 Sol Light', 'GPT-6.1 Sol Medium', 'GPT-6 Astra Light', 'GPT-6 Astra Medium', 'GPT-6 Astra Extra High'], 'Future 8': ['Future Light', 'Future Deep'] };
  const state = { model: Object.keys(choices)[0], index: 1, open: false, pane: 'simple' }, clicks = [], keys = [], button = f.d.querySelector('button');
  function render() {
    f.d.getElementById('picker')?.remove(); button.setAttribute('aria-expanded', String(state.open)); button.setAttribute('aria-controls', 'picker');
    button.setAttribute('data-state', state.open ? 'open' : 'closed');
    button.textContent = state.open ? 'Thinking effort' : choices[state.model][state.index];
    Object.defineProperty(button, 'innerText', { configurable: true, value: state.open ? 'Thinking effort' : 'Thinking effort\n' + choices[state.model][state.index] });
    if (!state.open) return;
    const root = f.d.createElement('div'); root.id = 'picker'; root.setAttribute('role', 'menu'); root.setAttribute('aria-labelledby', options.wrongOwner ? 'wrong' : 'trigger');
    root.setAttribute('data-testid', 'composer-intelligence-picker-content');
    root.innerHTML = `<div data-model-picker-view="${state.pane}"><div data-pane="simple" aria-hidden="${!options.legacy && state.pane !== 'simple'}">
      <div role="menuitem" aria-label="Select model" data-model-picker-view-toggle>Select model</div>
      <div id="description">${state.model === 'Default' ? 'Light' : choices[state.model][state.index]}, ${state.index + 1} of ${choices[state.model].length}.</div>
      <div role="menuitem" aria-label="Power" tabindex="0" aria-describedby="description"><div data-model-picker-power-slider><span role="slider" aria-valuenow="${state.index}" aria-valuemin="0" aria-valuemax="${choices[state.model].length - 1}"></span></div></div></div>
      <div data-pane="models" aria-hidden="${!options.legacy && state.pane !== 'models'}"></div></div>`;
    for (const name of Object.keys(choices)) {
      const el = f.d.createElement('div'); el.setAttribute('role', 'menuitemradio'); el.setAttribute('aria-checked', String(name === state.model)); el.innerHTML = `<span>${name}</span><span>description</span>`;
      el.onclick = () => { clicks.push(name); if (!options.ignoreModel) { if (state.model !== name) state.index = 0; state.model = name; }
        state.pane = 'simple'; state.open = false; render(); }; root.querySelector('[data-pane="models"]').append(el);
    }
    root.querySelector('[data-model-picker-view-toggle]').onclick = () => { state.pane = 'models'; render(); };
    root.querySelector('[aria-label="Power"]').onkeydown = e => {
      keys.push(e.key); if (!options.ignoreKeys) state.index = Math.max(0, Math.min(choices[state.model].length - 1, state.index + (e.key === 'ArrowRight' ? 1 : -1)));
      options.afterKey?.(state, f); render();
    };
    f.d.body.append(root);
  }
  button.onclick = () => { state.open = !state.open; render(); };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape') { state.open = false; render(); } }); render();
  return { ...f, state, choices, clicks, keys };
}
module.exports = { chatgpt };
