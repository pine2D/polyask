'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('gemini.google.com', '<button aria-label="Open mode picker, currently Gemini Flash"></button>', ['adapters-gemini', 'gemini-presets']);
  const state = { model: options.initialModel || (options.modern ? '4 Carbon' : '3.8 Flash'), effort: 'Low' }, clicks = [];
  const choices = { '3.8 Flash': ['Low', 'Medium', 'High'], '4 Argon': ['Low', 'High'], 'Future Lite': [] };
  if (options.modern) { delete choices['Future Lite']; choices['3.5 Flash-Lite'] = []; choices['4 Carbon'] = ['Low', 'Medium', 'High']; }
  const descriptions = { '3.8 Flash': 'All-around help', '4 Argon': 'Code & analysis', '4 Carbon': 'Most complex work', 'Future Lite': 'Quick answers' };
  if (options.currentMenu) {
    for (const name of Object.keys(choices)) delete choices[name];
    Object.assign(choices, { '4 Hydrogen': ['Low', 'Medium', 'High'], '4 Neon': ['Low', 'Medium', 'High'], '4 Carbon': ['Low', 'Medium', 'High'] });
    Object.assign(descriptions, { '4 Hydrogen': 'Everyday help', '4 Neon': 'Deeper analysis', '4 Carbon': 'Code & complex work' });
    state.model = options.initialModel || '4 Hydrogen';
    f.d.body.insertAdjacentHTML('beforeend', `<chat-spark-toggle><button aria-pressed="${!options.task}">Chat</button><button aria-pressed="${!!options.task}">Task</button></chat-spark-toggle>`);
    if (options.task) state.effort = null;
  }
  const panels = '[role="menu"]:not([data-unrelated]),.cdk-overlay-pane';
  const close = () => f.d.querySelectorAll(panels).forEach(el => el.remove());
  const button = f.d.querySelector('button');
  if (options.currentMenu) button.setAttribute('data-test-id', 'bard-mode-menu-button');
  function item(name, kind) {
    const el = f.d.createElement('gem-menu-item'); el.setAttribute('role', 'menuitemradio');
    const flipped = (options.modern || options.currentMenu) && kind === 'model';
    el.innerHTML = `<gem-menu-item-content><span class="label"> ${flipped ? descriptions[name] || 'Quick answers' : name} </span><span class="sublabel">${flipped ? name : 'Description with High and other models'}</span></gem-menu-item-content>`;
    el.className = name === state[kind] ? 'selected' : 'active';
    if (options.disabled?.includes(name)) el.setAttribute('aria-disabled', 'true');
    if (kind === 'model') el.setAttribute('data-test-id', `bard-mode-option-${name}`);
    const select = () => { if (!el.isConnected) return; clicks.push(`${kind}:${name}`);
      if (!options.ignore) { state[kind] = name; if (kind === 'model') state.effort = options.task ? null : choices[name][0] || null; }
      close(); button.setAttribute('aria-label', `Open mode picker, currently Gemini ${state.model}${state.effort && state.effort !== 'Low' ? ` ${state.effort}` : ''}`);
    };
    el.onclick = select; el.onkeydown = e => { if (e.key === 'Enter') select(); }; return el;
  }
  function showList() {
    const root = f.d.createElement('div'); root.setAttribute('role', 'menu'); f.d.body.append(root);
    if (options.currentMenu) root.setAttribute('data-test-id', 'gem-mode-menu');
    Object.keys(choices).forEach(name => root.append(item(name, 'model')));
    if (options.duplicate) root.append(item(state.model, 'model'));
    if (!options.task && choices[state.model].length) {
      const row = f.d.createElement('gem-menu-item'); row.setAttribute('role', 'menuitem'); row.innerHTML = '<span class="label">Thinking level</span>';
      row.onclick = () => {
        if (row.getAttribute('aria-expanded') === 'true') return;
        row.setAttribute('aria-expanded', 'true');
        let menu = row;
        if (options.detached) {
          menu = f.d.createElement('div'); menu.id = 'gemini-thinking-levels'; menu.setAttribute('role', 'menu');
          f.d.body.append(menu); row.setAttribute('aria-controls', menu.id);
        }
        choices[state.model].forEach(name => menu.append(item(name, 'effort')));
      };
      root.append(row);
    }
  }
  button.onclick = () => {
    if (f.d.querySelector(panels)) { close(); return; }
    if (!options.table) { showList(); return; }
    const pane = f.d.createElement('div'); pane.className = 'cdk-overlay-pane';
    pane.innerHTML = '<h2>The Periodic Table of Gemini</h2><button>Full table</button><button>List view</button><button>C</button><button>Use Carbon</button>';
    f.d.body.append(pane);
    for (const control of pane.querySelectorAll('button')) control.onclick = () => {
      clicks.push(control.textContent);
      if (control.textContent === 'List view' && !options.stuckTable) { close(); showList(); }
    };
  };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return { ...f, state, clicks };
}
test('Gemini modern radios read pure labels and fresh Low evidence hidden by the closed button', async () => {
  const f = setup(); try {
    assert.equal(f.a.currentPreset?.() ?? null, null);
    const result = plain(await f.command({ kind: 'options', model: '4 Argon' })); assert.equal(result.ok, true);
    assert.deepEqual(result.catalog.models, ['3.8 Flash', '4 Argon', 'Future Lite']); assert.deepEqual(result.catalog.efforts, ['Low', 'High']);
    assert.deepEqual(f.state, { model: '3.8 Flash', effort: 'Low' });
    assert.equal((await f.command({ kind: 'verify', preset: { model: '4 Argon', effort: 'High' } })).ok, true);
    assert.deepEqual(f.state, { model: '3.8 Flash', effort: 'Low' }); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Gemini distinguishes an actual no-level model from unsupported combinations', async () => {
  const f = setup(); try {
    assert.deepEqual(plain((await f.command({ kind: 'options', model: 'Future Lite' })).catalog.efforts), []);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Future Lite', effort: null } })).ok, true);
    assert.equal((await f.command({ kind: 'verify', preset: { model: '4 Argon', effort: null } })).ok, false);
    assert.deepEqual(f.state, { model: '3.8 Flash', effort: 'Low' });
  } finally { f.close(); }
});
test('Gemini rejects duplicate model labels and does not confirm an ignored effort click', async () => {
  for (const options of [{ duplicate: true }, { ignore: true }]) {
    const f = setup(options); try { assert.equal((await f.command({ kind: 'verify', preset: { model: '3.8 Flash', effort: 'High' } })).ok, false); }
    finally { f.close(); }
  }
});
test('Gemini keeps saved modern menu labels compatible when reading and verifying Carbon presets', async () => {
  const f = setup({ modern: true }); try {
    assert.deepEqual(plain((await f.command({ kind: 'current' })).current), { model: 'Most complex work', effort: 'Low' });
    const options = plain(await f.command({ kind: 'options', model: 'Most complex work' }));
    assert.equal(options.ok, true);
    assert.deepEqual(options.catalog.models, ['All-around help', 'Code & analysis', 'Quick answers', 'Most complex work']);
    assert.deepEqual(options.catalog.efforts, ['Low', 'Medium', 'High']);
    const verified = plain(await f.command({ kind: 'verify', preset: { model: 'Most complex work', effort: 'High' } }));
    assert.equal(verified.ok, true);
    assert.deepEqual(verified.verified, { model: 'Most complex work', effort: 'High' });
    assert.deepEqual(f.state, { model: '4 Carbon', effort: 'Low' });
    assert.equal(f.d.querySelector('textarea').value, 'untouched draft');
    assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Gemini Chat selects Carbon High and falls back to Argon Low when Neon is absent', async () => {
  const f = setup({ modern: true }); try {
    for (const [mode, effort] of [['think', 'High'], ['fast', 'Low']]) {
      const result = plain(await f.S.resolveTier(mode, Date.now() + 10000));
      assert.equal(result.outcome, 'mode_only');
      assert.deepEqual(f.state, { model: mode === 'think' ? '4 Carbon' : '4 Argon', effort });
      assert.equal(f.menus(), 0);
    }
    for (const [mode, effort] of [['think', 'High'], ['fast', 'Low'], ['fast', 'Low'], ['think', 'Medium']]) {
      const result = plain(await f.S.resolveTier(mode, Date.now() + 10000, undefined, { model: 'Most complex work', effort }));
      assert.equal(result.outcome, 'preferred');
      assert.deepEqual(f.state, { model: '4 Carbon', effort });
      assert.equal(f.a.state(), effort === 'High' ? 'think' : null);
      assert.equal(f.menus(), 0);
    }
    assert.equal(f.d.querySelector('textarea').value, 'untouched draft');
  } finally { f.close(); }
});
test('Gemini excludes a disabled Carbon model and cannot validate it or change the current model', async () => {
  const f = setup({ modern: true, initialModel: '4 Argon', disabled: ['4 Carbon'] }); try {
    const result = plain(await f.command({ kind: 'options' }));
    assert.equal(result.ok, true);
    assert.equal(result.catalog.models.includes('Most complex work'), false);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Most complex work', effort: 'High' } })).ok, false);
    assert.deepEqual(f.state, { model: '4 Argon', effort: 'Low' });
    assert.equal(f.clicks.includes('model:4 Carbon'), false);
    assert.equal(f.menus(), 0);
  } finally { f.close(); }
});

test('Gemini Chat opens List view and confirms Neon Low without selecting the previewed element', async () => {
  const f = setup({ currentMenu: true, table: true });
  try {
    const r = plain(await f.S.resolveTier('fast', Date.now() + 10000));
    assert.equal(r.outcome, 'mode_only');
    assert.deepEqual(f.state, { model: '4 Neon', effort: 'Low' });
    assert.ok(f.clicks.includes('List view'));
    assert.equal(f.clicks.some(s => ['C', 'Use Carbon', 'Full table'].includes(s)), false);
    assert.equal(f.d.querySelector('.cdk-overlay-pane,[role="menu"]') === null, true);
  } finally { f.close(); }
});

test('Gemini wide Chat uses the level menu named only by aria-controls and ignores an unrelated High row', async () => {
  const f = setup({ currentMenu: true, detached: true });
  try {
    f.d.body.insertAdjacentHTML('afterbegin', '<div role="menu" data-unrelated><button role="menuitemradio">High</button></div>');
    const decoy = f.d.querySelector('[role=menuitemradio]'); let unrelatedClicks = 0;
    decoy.onclick = () => { unrelatedClicks++; };
    const tier = await f.S.resolveTier('think', Date.now() + 9000);
    assert.equal(tier.outcome, 'mode_only');
    assert.deepEqual(f.state, { model: '4 Carbon', effort: 'High' });
    assert.equal(unrelatedClicks, 0);
  } finally { f.close(); }
});

test('Gemini Task fast and think select and re-read Neon and Carbon without a level menu', async () => {
  const f = setup({ currentMenu: true, task: true, table: true });
  try {
    for (const [mode, model] of [['fast', '4 Neon'], ['think', '4 Carbon'], ['think', '4 Carbon']]) {
      assert.equal((await f.S.resolveTier(mode, Date.now() + 10000)).outcome, 'mode_only');
      assert.deepEqual(f.state, { model, effort: null });
      assert.equal(f.a.state(), mode);
    }
    assert.equal(f.clicks.filter(s => s === 'model:4 Carbon').length, 1);
    assert.equal(f.d.querySelector('.cdk-overlay-pane,[role="menu"]') === null, true);
    assert.equal(f.d.querySelector('textarea').value, 'untouched draft');
  } finally { f.close(); }
});

test('Gemini recognizes the saved Carbon label in the renamed Chat list and restores settings previews', async () => {
  const f = setup({ currentMenu: true, table: true });
  try {
    const preset = { model: 'Most complex work', effort: 'High' };
    const catalog = plain((await f.command({ kind: 'options', model: preset.model })).catalog);
    assert.equal(catalog.model, preset.model);
    assert.ok(catalog.models.includes(preset.model));
    const verified = plain(await f.command({ kind: 'verify', preset }));
    assert.equal(verified.ok, true);
    assert.deepEqual(verified.verified, preset);
    assert.deepEqual(f.state, { model: '4 Hydrogen', effort: 'Low' });
    const tier = plain(await f.S.resolveTier('think', Date.now() + 10000, undefined, preset));
    assert.equal(tier.outcome, 'preferred');
    assert.deepEqual(f.state, { model: '4 Carbon', effort: 'High' });
  } finally { f.close(); }
});

test('Gemini closes a stuck periodic table at deadline without touching an unrelated List view', async () => {
  const f = setup({ currentMenu: true, task: true, table: true, stuckTable: true });
  try {
    const decoy = f.d.createElement('button'); decoy.textContent = 'List view';
    decoy.onclick = () => f.clicks.push('unrelated'); f.d.body.prepend(decoy);
    const r = await f.S.resolveTier('think', Date.now() + 650);
    assert.equal(r.outcome, 'unconfirmed');
    assert.ok(f.clicks.includes('List view'));
    assert.equal(f.clicks.includes('unrelated'), false);
    assert.deepEqual(f.state, { model: '4 Hydrogen', effort: null });
    assert.equal(f.d.querySelector('.cdk-overlay-pane') === null, true);
  } finally { f.close(); }
});

test('Gemini Task rejects a disabled or ignored Carbon option and leaves the picker closed', async () => {
  for (const options of [{ disabled: ['4 Carbon'] }, { ignore: true }]) {
    const f = setup({ currentMenu: true, task: true, ...options });
    try {
      assert.equal((await f.S.resolveTier('think', Date.now() + 5000)).outcome, 'unconfirmed');
      assert.deepEqual(f.state, { model: '4 Hydrogen', effort: null });
      assert.equal(f.menus(), 0);
    } finally { f.close(); }
  }
});

test('Gemini Task reports the actual model when a saved Chat preset also requests an unavailable level', async () => {
  const f = setup({ currentMenu: true, task: true });
  try {
    const preset = { model: 'Most complex work', effort: 'High' };
    const tier = plain(await f.S.resolveTier('fast', Date.now() + 10000, undefined, preset));
    assert.equal(tier.outcome, 'alternative');
    assert.deepEqual(f.state, { model: '4 Carbon', effort: null });
    assert.equal(tier.model.includes('High'), false);
    assert.equal((await f.command({ kind: 'verify', preset })).ok, false);
    const exact = { model: 'Deeper analysis', effort: null };
    assert.equal((await f.S.resolveTier('fast', Date.now() + 10000, undefined, exact)).outcome, 'preferred');
  } finally { f.close(); }
});
