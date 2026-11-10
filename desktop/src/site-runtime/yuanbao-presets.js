// 元宝两层同为 radio：只有 Models 子菜单的选项可作模型，根菜单只作模式。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['yuanbao.tencent.com'], P = S?.presetDom; if (!a || !P) return;
  function modeRoot() {
    if (a._modeBtn()?.getAttribute('aria-expanded') === 'false') return null;
    const own = P.owned(a._modeBtn()); if (own) return own;
    const entry = a._modelsEntry(); return P.visible(entry) ? entry.closest('[role="menu"]') : null;
  }
  function modelRoot() {
    const entry = modeRoot()?.querySelector('[role="menuitem"]');
    const list = [...document.querySelectorAll('[role="menu"]')].filter(P.visible)
      .filter(el => /^(Model list|模型列表)$/i.test(el.getAttribute('aria-label') || ''));
    if (list.length > 1) S.presetFail();
    const own = P.owned(entry); return own && list.includes(own) ? own : list.length === 1 && modeRoot() ? list[0] : null;
  }
  function items(home) {
    return [...(home?.querySelectorAll('[role="menuitemradio"]') || [])].filter(el => el.closest('[role="menu"]') === home)
      .filter(P.visible).filter(P.enabled).map(el => ({ el, label: P.firstText(el), selected: el.getAttribute('aria-checked') === 'true' }));
  }
  const close = deadline => P.close(() => [modelRoot(), modeRoot()].filter(Boolean), deadline, async d => {
    // 子菜单收起后，父菜单要到下一轮才接管 Escape；重新取根，避免只关掉一层。
    if (Date.now() < d) await S.sleep(Math.min(80, d - Date.now()));
    for (const root of [modelRoot(), modeRoot()].filter(Boolean))
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    S.escMenus();
  });
  async function modes(deadline, url) {
    P.check(deadline, url); if (!modeRoot()) P.click(a._modeBtn(), deadline, url, true);
    return P.wait(() => items(modeRoot()).length ? items(modeRoot()) : null, deadline, url);
  }
  async function models(deadline, url) {
    await modes(deadline, url);
    if (!modelRoot()) {
      const entries = [...modeRoot().querySelectorAll('[role="menuitem"]')].filter(P.visible)
        .filter(el => /^(Models|模型)/i.test(P.text(el)));
      if (entries.length !== 1) S.presetFail(); const entry = entries[0], r = entry.getBoundingClientRect();
      P.act(deadline, url, () => entry.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 })));
    }
    return P.wait(() => items(modelRoot()).length ? items(modelRoot()) : null, deadline, url);
  }
  a.currentPreset = function () {
    try { return { model: P.selected(items(modelRoot())), effort: P.selected(items(modeRoot())) }; } catch (_) { return null; }
  };
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try { const effort = P.selected(await modes(deadline, url)); return { model: P.selected(await models(deadline, url)), effort }; }
    finally { await close(deadline); }
  };
  async function chooseModel(model, deadline, url) {
    try {
      const item = P.unique(await models(deadline, url), model);
      if (!item.selected) { P.click(item.el, deadline, url); await close(deadline); }
      if (P.selected(await models(deadline, url)) !== model) S.presetFail();
    } finally { await close(deadline); }
  }
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        const names = P.labels(await models(workDeadline, url)), selected = model ?? current.model;
        if (!names.includes(selected)) S.presetFail(); await close(workDeadline); await chooseModel(selected, workDeadline, url);
        return { models: names, model: selected, efforts: P.labels(await modes(workDeadline, url), true), current, primary: 'model', secondary: 'mode' };
      } finally { await close(workDeadline); }
    });
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset) || preset.effort === null) S.presetFail();
      await chooseModel(preset.model, deadline, url); const item = P.unique(await modes(deadline, url), preset.effort);
      if (!item.selected) P.click(item.el, deadline, url);
      await close(deadline); const actual = await this.readPreset(deadline); P.check(deadline, url);
      if (!S.presetSame(actual, preset)) S.presetFail(); return actual;
    } finally { await close(deadline); }
  };
})();
