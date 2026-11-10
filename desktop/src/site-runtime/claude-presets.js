// Claude 的动态模型/强度能力。只相信当前可见菜单的语义归属，不按版本或档位高低猜测。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['claude.ai'];
  if (!a) return;
  const invalid = () => S.presetFail();
  const name = S.presetName, valid = S.presetValid, same = S.presetSame;
  const visible = el => el?.isConnected && !el.closest('[hidden], [aria-hidden="true"], [data-state="closed"], [role="menu"][data-closed]') && el.getClientRects().length > 0;
  const enabled = el => !el.closest('[disabled], [aria-disabled="true"], [data-disabled]');
  const button = () => document.querySelector('[data-testid="model-selector-dropdown"]');
  function texts(el) {
    if (!el) return [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), found = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('svg, [role="img"], [aria-hidden="true"], [hidden]')) continue;
      const text = node.textContent.trim();
      if (text) found.push(text);
      if (found.length > 24) break;
    }
    return found;
  }
  a.currentPreset = function () {
    // 强度名称可能拆成多个文本节点；只剥离已确认的用量说明，不能接受任意后缀。
    const withoutUsage = text => text.replace(/\s+\d+(?:[.,]\d+)?\s*[×x](?:\s+or more)?\s+usage$/i, '');
    const b = button(), parts = texts(b), model = parts[0], effort = withoutUsage(parts.slice(1).join(' ')) || null;
    if (!name(model) || (effort !== null && !name(effort, 24))) return null;
    const label = b?.getAttribute('aria-label') || '', index = label.indexOf(model);
    if (index < 0) return null;
    const tail = withoutUsage(label.slice(index + model.length).trim().replace(/^[·\s]+/, ''));
    if (tail !== (effort ?? '')) return null;
    return { model, effort };
  };
  function rootsFor(trigger) {
    if (!trigger || trigger.getAttribute('aria-expanded') === 'false') return [];
    const controlled = (trigger.getAttribute('aria-controls') || '').split(/\s+/);
    return [...document.querySelectorAll('[role="menu"]')].filter(root => visible(root) &&
      ((trigger.id && (root.getAttribute('aria-labelledby') || '').split(/\s+/).includes(trigger.id)) || controlled.includes(root.id) && root.id));
  }
  async function closeMenus(deadline) {
    // 新菜单只处理自身冒泡的 Escape；body 上的按键事件不会经过它。
    const trigger = button();
    for (const root of rootsFor(trigger)) root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    S.escMenus();
    // React 异步移除菜单，确认关闭后才能重新打开；超时后只发 Escape，不再选择。
    if (rootsFor(trigger).length && !await S.waitFor(() => !rootsFor(trigger).length, 500, 40, deadline)) invalid();
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
  function checkPage(deadline, url) {
    S.presetCheck(deadline, url);
  }
  function act(deadline, url, callback) { checkPage(deadline, url); return S.tierAction(deadline, callback); }
  async function open(deadline, url) {
    checkPage(deadline, url);
    const b = button(); if (!b || !visible(b) || !enabled(b)) invalid();
    await closeMenus(deadline);
    act(deadline, url, () => S.openMenu(b));
    const roots = await S.waitFor(() => { const r = rootsFor(b); return r.length ? r : null; }, 1800, 80, deadline);
    checkPage(deadline, url);
    if (!roots) invalid();
    return roots;
  }
  async function models(deadline, url) {
    const roots = await open(deadline, url);
    const top = entries(roots);
    const more = roots.flatMap(root => [...root.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')])
      .filter(el => visible(el) && enabled(el) && /^(more models|更多模型)/i.test((el.textContent || '').trim()));
    if (more.length > 1) invalid();
    if (more.length) {
      act(deadline, url, () => S.openMenu(more[0]));
      const sub = await S.waitFor(() => { const r = rootsFor(more[0]); return r.length ? r : null; }, 1500, 80, deadline);
      checkPage(deadline, url);
      if (!sub) invalid();
      const all = [...top, ...entries(sub)];
      return all.filter((item, i) => all.findIndex(other => other.el === item.el) === i);
    }
    return top;
  }
  async function chooseModel(model, deadline, url) {
    try {
      const item = unique(await models(deadline, url), model);
      if (a.currentPreset()?.model !== model) {
        act(deadline, url, () => S.clickEl(item.el));
        if (!await S.waitFor(() => a.currentPreset()?.model === model, 1500, 80, deadline)) invalid();
      }
    } finally { await closeMenus(deadline); }
  }
  async function efforts(deadline, url) {
    const roots = await open(deadline, url);
    let items = entries(roots, true);
    if (!items.length) {
      const triggers = roots.flatMap(root => [...root.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')])
        .filter(el => visible(el) && enabled(el) && /^(effort|强度|思考强度|努力)/i.test((el.textContent || '').trim()));
      if (triggers.length > 1) invalid();
      const trigger = triggers[0];
      if (!trigger) { if (a.currentPreset()?.effort !== null) invalid(); return []; }
      if (!trigger.id) invalid();
      act(deadline, url, () => S.openMenu(trigger));
      items = await S.waitFor(() => { const list = entries(rootsFor(trigger), true); return list.length ? list : null; }, 1500, 80, deadline);
    }
    if (!items?.length) invalid();
    labels(items, 12);
    return items;
  }
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      S.checkDeadline(deadline);
      if (!valid(preset) || !this.currentPreset()) invalid();
      await chooseModel(preset.model, deadline, url);
      const items = await efforts(deadline, url);
      if (preset.effort === null) { if (items.length) invalid(); }
      else {
        const wanted = unique(items, preset.effort);
        if (!same(this.currentPreset(), preset)) act(deadline, url, () => S.clickEl(wanted.el));
      }
      if (!await S.waitFor(() => same(this.currentPreset(), preset), 1200, 80, deadline)) invalid();
      checkPage(deadline, url);
      return { ...preset };
    } finally { await closeMenus(deadline); }
  };
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        const list = labels(await models(workDeadline, url), 50);
        const selected = model === undefined ? current.model : model;
        if (!list.includes(selected)) invalid();
        await closeMenus(workDeadline);
        await chooseModel(selected, workDeadline, url);
        return { models: list, model: selected, efforts: labels(await efforts(workDeadline, url), 12), current };
      } finally { await closeMenus(workDeadline); }
    });
  };
})();
