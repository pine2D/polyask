// 豆包图标入口不暴露当前模式；每次显式读取都重新打开其所属菜单取证。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['doubao.com'], P = S?.presetDom; if (!a || !P) return;
  function root() {
    // Radix 模态菜单会把入口背景标 aria-hidden；归属由仍连接的入口 ID 确认。
    const button = a._modeBtn(); if (!button?.isConnected) return null;
    const modern = a._modeMenu(button); if (modern && P.visible(modern)) return modern;
    return P.owned(button);
  }
  function items() {
    const menu = root(); if (!menu) return [];
    return [...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"]')].filter(P.visible).filter(P.enabled).map(el => ({ el,
      label: P.text(el.querySelector('span.shrink-0')) || P.firstText(el),
      selected: el.getAttribute('aria-checked') === 'true' || !!el.querySelector(':scope > svg') }));
  }
  const close = deadline => P.close(() => [root()].filter(Boolean), deadline, d => a._closeModeMenu(d));
  async function open(deadline, url) {
    P.check(deadline, url); const button = a._modeBtn();
    const trigger = button?.closest('[data-slot="dropdown-menu-trigger"]') || button;
    if (!root() && trigger?.getAttribute('aria-expanded') !== 'true') P.click(button, deadline, url, true);
    return P.wait(() => { const list = items(); return list.length ? list : null; }, deadline, url);
  }
  a.currentPreset = function () {
    try { return { model: P.selected(items()), effort: null }; } catch (_) { return null; }
  };
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try { return { model: P.selected(await open(deadline, url)), effort: null }; }
    finally { await close(deadline); }
  };
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    try {
      const list = await open(deadline, url), current = { model: P.selected(list), effort: null };
      const models = P.labels(list), selected = model ?? current.model; if (!models.includes(selected)) S.presetFail();
      return { models, model: selected, efforts: [], current, primary: 'mode' };
    } finally { await close(deadline); }
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      if (!S.presetValid(preset) || preset.effort !== null) S.presetFail();
      const item = P.unique(await open(deadline, url), preset.model);
      if (!item.selected) { P.click(item.el, deadline, url); await close(deadline); }
      const current = { model: P.selected(await open(deadline, url)), effort: null };
      if (!S.presetSame(current, preset)) S.presetFail(); return current;
    } finally { await close(deadline); }
  };
})();
