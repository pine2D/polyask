// 智谱模型在一级，强度在本级所属的 CSS hover 子菜单；两者分别核对 selected。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['chatglm.cn'], P = S?.presetDom; if (!a || !P) return;
  function root() {
    const list = [...document.querySelectorAll('.think-mode-list')].filter(P.visible);
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  const entry = el => ({ el, label: P.text(el.querySelector('.item-name')), selected: el.classList.contains('selected') });
  function models() {
    return [...(root()?.querySelectorAll(':scope > .think-mode-item:not(.has-submenu)') || [])].filter(P.visible).filter(P.enabled).map(entry);
  }
  function owner() {
    const list = [...(root()?.querySelectorAll(':scope > .think-mode-item.has-submenu') || [])].filter(P.visible);
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  function levels() {
    const row = owner(), sub = row?.querySelector(':scope > .think-submenu'); if (!sub) return [];
    // 唯一隐藏例外：可见根菜单的显式所属子菜单。hidden/aria-hidden 等失效项仍排除。
    return [...sub.querySelectorAll(':scope > .think-mode-item:not(.has-submenu)')]
      .filter(el => !el.closest('[hidden],[aria-hidden="true"],[data-state="closed"]') && P.enabled(el)).map(entry);
  }
  const close = deadline => P.close(() => [root()].filter(Boolean), deadline, async d => {
    if (Date.now() < d) await S.sleep(Math.min(100, Math.max(0, d - Date.now())));
    // 退出动画仍有几何；root 同时核对 aria-hidden，不能沿用旧 _open 的纯几何判断。
    if (root()) { a._trigger()?.click();
      if (Date.now() < d) await S.sleep(Math.min(300, Math.max(0, d - Date.now())));
    }
  });
  async function open(deadline, url) {
    P.check(deadline, url);
    if (!root()) { P.act(deadline, url, () => a._hover(a._trigger())); P.click(a._trigger(), deadline, url); }
    return P.wait(() => models().length ? models() : null, deadline, url);
  }
  a.currentPreset = function () {
    try {
      const model = P.selected(models()), list = levels(), effort = list.length ? P.selected(list) : null;
      if (owner() && (!list.length || P.text(owner().querySelector(':scope > .item-name,:scope > .item-name-container > .item-name')) !== effort)) return null;
      return { model, effort };
    } catch (_) { return null; }
  };
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try { await open(deadline, url); const current = this.currentPreset(); if (!current) S.presetFail(); return current; }
    finally { await close(deadline); }
  };
  async function chooseModel(model, deadline, url) {
    const item = P.unique(await open(deadline, url), model);
    if (!item.selected) { P.click(item.el, deadline, url); await close(deadline); }
    if (P.selected(await open(deadline, url)) !== model) S.presetFail();
  }
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        const names = P.labels(await open(workDeadline, url)), selected = model ?? current.model;
        if (!names.includes(selected)) S.presetFail(); await chooseModel(selected, workDeadline, url);
        return { models: names, model: selected, efforts: P.labels(levels(), true), current, primary: 'model', secondary: 'effort' };
      } finally { await close(workDeadline); }
    });
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset)) S.presetFail();
      await chooseModel(preset.model, deadline, url); const list = levels();
      if (preset.effort === null) { if (list.length) S.presetFail(); }
      else {
        const item = P.unique(list, preset.effort);
        if (!item.selected) {
          if (!owner()?.querySelector(':scope > .think-submenu')?.contains(item.el) || !P.enabled(item.el)) S.presetFail();
          P.act(deadline, url, () => item.el.click());
        }
      }
      await close(deadline); const actual = await this.readPreset(deadline); P.check(deadline, url);
      if (!S.presetSame(actual, preset)) S.presetFail(); return actual;
    } finally { await close(deadline); }
  };
})();
