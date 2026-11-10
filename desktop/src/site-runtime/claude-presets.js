// Claude 的动态模型/强度能力。只相信当前可见菜单的语义归属，不按版本或档位高低猜测。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['claude.ai'];
  if (!a) return;
  const invalid = () => { throw new Error('preset_unavailable'); };
  const name = (value, limit = 48) => typeof value === 'string' && value.length > 0 && value.length <= limit &&
    value.trim() === value && !/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(value);
  const valid = value => value && Object.keys(value).length === 2 && name(value.model) &&
    (value.effort === null || name(value.effort, 24));
  const same = (x, y) => !!x && !!y && x.model === y.model && x.effort === y.effort;
  const visible = el => el?.isConnected && !el.closest('[hidden], [aria-hidden="true"], [data-state="closed"]') && el.getClientRects().length > 0;
  const enabled = el => !el.closest('[disabled], [aria-disabled="true"], [data-disabled]');
  const button = () => document.querySelector('[data-testid="model-selector-dropdown"]');
  function texts(el) {
    if (!el) return [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), found = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('svg, [aria-hidden="true"], [hidden]')) continue;
      const text = node.textContent.trim();
      if (text) found.push(text);
      if (found.length > 24) break;
    }
    return found;
  }
  a.currentPreset = function () {
    const b = button(), parts = texts(b), model = parts[0], effort = parts[1] || null;
    if (!name(model) || (effort !== null && !name(effort, 24))) return null;
    const label = b?.getAttribute('aria-label') || '', index = label.indexOf(model);
    if (index < 0) return null;
    const tail = label.slice(index + model.length).trim().replace(/^[·\s]+/, '');
    if (effort === null ? !!tail : tail !== effort && !tail.startsWith(effort + ' ')) return null;
    return { model, effort };
  };
  function rootsFor(trigger) {
    if (!trigger) return [];
    const controlled = (trigger.getAttribute('aria-controls') || '').split(/\s+/);
    return [...document.querySelectorAll('[role="menu"]')].filter(root => visible(root) &&
      ((trigger.id && (root.getAttribute('aria-labelledby') || '').split(/\s+/).includes(trigger.id)) || controlled.includes(root.id) && root.id));
  }
  const effortHome = el => {
    const home = el.closest('[role="group"][aria-labelledby], [role="menu"][aria-labelledby]');
    const title = document.getElementById(home?.getAttribute('aria-labelledby') || '');
    return title && /^(effort|强度|思考强度|努力)/i.test((title.textContent || '').trim()) ? home : null;
  };
  function entries(roots, effort = false) {
    const elements = new Set(roots.flatMap(root => [...root.querySelectorAll('[role="menuitemradio"]')]));
    return [...elements].filter(el => visible(el) && enabled(el) && !!effortHome(el) === effort)
      .map(el => { const label = texts(el)[0]; if (!name(label, effort ? 24 : 48)) invalid(); return { el, label }; });
  }
  function unique(items, wanted) {
    const found = items.filter(item => item.label === wanted);
    if (found.length !== 1) invalid();
    return found[0];
  }
  function labels(items, max) {
    const result = items.map(item => item.label);
    if (result.length > max || new Set(result).size !== result.length) invalid();
    return result;
  }
  async function open(deadline) {
    S.checkDeadline(deadline);
    const b = button(); if (!b || !visible(b) || !enabled(b)) invalid();
    S.escMenus(); S.tierAction(deadline, () => S.openMenu(b));
    const roots = await S.waitFor(() => { const r = rootsFor(b); return r.length ? r : null; }, 1800, 80, deadline);
    if (!roots) invalid();
    return roots;
  }
  async function models(deadline) {
    const roots = await open(deadline);
    const top = entries(roots);
    const more = roots.flatMap(root => [...root.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')])
      .filter(el => visible(el) && enabled(el) && /^(more models|更多模型)/i.test((el.textContent || '').trim()));
    if (more.length > 1) invalid();
    if (more.length) {
      S.tierAction(deadline, () => S.openMenu(more[0]));
      const sub = await S.waitFor(() => { const r = rootsFor(more[0]); return r.length ? r : null; }, 1500, 80, deadline);
      if (!sub) invalid();
      const all = [...top, ...entries(sub)];
      return all.filter((item, i) => all.findIndex(other => other.el === item.el) === i);
    }
    return top;
  }
  async function chooseModel(model, deadline) {
    try {
      const item = unique(await models(deadline), model);
      if (a.currentPreset()?.model !== model) {
        S.tierAction(deadline, () => S.clickEl(item.el));
        if (!await S.waitFor(() => a.currentPreset()?.model === model, 1500, 80, deadline)) invalid();
      }
    } finally { S.escMenus(); }
  }
  async function efforts(deadline) {
    const roots = await open(deadline), trigger = a._effortTrigger();
    if (!trigger) {
      if (a.currentPreset()?.effort !== null) invalid();
      return [];
    }
    if (!roots.some(root => root.contains(trigger)) || !trigger.id) invalid();
    let items = entries(roots, true);
    if (!items.length && trigger.getAttribute('aria-haspopup') === 'menu') {
      S.tierAction(deadline, () => S.openMenu(trigger));
      items = await S.waitFor(() => { const list = entries(rootsFor(trigger), true); return list.length ? list : null; }, 1500, 80, deadline);
    }
    if (!items?.length) invalid();
    labels(items, 12);
    return items;
  }
  a.applyPreset = async function (preset, deadline) {
    try {
      S.checkDeadline(deadline);
      if (!valid(preset) || !this.currentPreset()) invalid();
      await chooseModel(preset.model, deadline);
      const items = await efforts(deadline);
      if (preset.effort === null) { if (items.length) invalid(); }
      else {
        const wanted = unique(items, preset.effort);
        if (!same(this.currentPreset(), preset)) S.tierAction(deadline, () => S.clickEl(wanted.el));
      }
      if (!await S.waitFor(() => same(this.currentPreset(), preset), 1200, 80, deadline)) invalid();
      S.checkDeadline(deadline);
      return { ...preset };
    } finally { S.escMenus(); }
  };
  a.presetOptions = async function (model, deadline) {
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        const list = labels(await models(workDeadline), 50);
        const selected = model === undefined ? current.model : model;
        if (!list.includes(selected)) invalid();
        S.escMenus();
        await chooseModel(selected, workDeadline);
        return { models: list, model: selected, efforts: labels(await efforts(workDeadline), 12), current };
      } finally { S.escMenus(); }
    });
  };
  S.presetValid = valid;
  S.presetSame = same;
})();
