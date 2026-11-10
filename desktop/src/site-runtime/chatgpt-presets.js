// ChatGPT 每次按当前模型遍历真实滑块标签，旧版和 Default 使用同一精确证据契约。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['chatgpt.com'], P = S?.presetDom, slider = S?.presetSlider; if (!a || !P || !slider) return;
  function root() {
    const owned = a._controlledMenu(); if (owned) return owned;
    // 旧版专属容器可没有关联 ID；声明了关联而不匹配时不得回退。
    const button = a._anchor(); if (!P.visible(button) || button.getAttribute('aria-expanded') !== 'true' || button.getAttribute('aria-controls')) return null;
    const list = [...document.querySelectorAll('[data-testid="composer-intelligence-picker-content"]')].filter(P.visible);
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  function items() {
    return [...(root()?.querySelectorAll('[role="menuitemradio"]') || [])].filter(P.visible).filter(P.enabled)
      .map(el => ({ el, label: P.firstText(el), selected: el.getAttribute('aria-checked') === 'true' }));
  }
  const close = deadline => P.close(() => [root()].filter(Boolean), deadline);
  async function open(deadline, url) {
    P.check(deadline, url);
    // 冷启动先渲染占位输入框；等真正的模型入口可用，每次重取，仍受本次截止时间约束。
    while (!root()) {
      const anchor = a._anchor();
      if (P.visible(anchor) && P.enabled(anchor)) { P.click(anchor, deadline, url, true); break; }
      await S.sleep(60, deadline); P.check(deadline, url);
    }
    return P.wait(root, deadline, url);
  }
  async function models(deadline, url) {
    const home = await open(deadline, url); if (items().length) return items();
    const entries = [...home.querySelectorAll('[role="menuitem"]')].filter(P.visible).filter(P.enabled)
      .filter(el => /^(Select model|选择模型)$/i.test(el.getAttribute('aria-label') || ''));
    if (entries.length !== 1) S.presetFail(); P.click(entries[0], deadline, url);
    return P.wait(() => items().length ? items() : null, deadline, url);
  }
  async function power(deadline, url) {
    await open(deadline, url); return P.wait(() => { const p = a._power(); return root()?.contains(p) ? p : null; }, deadline, url);
  }
  async function chooseModel(model, deadline, url) {
    const target = P.unique(await models(deadline, url), model);
    // 双面板通过选中当前模型回到滑块。选择后再从可见列表核对模型身份。
    P.click(target.el, deadline, url); await close(deadline);
    const fresh = await models(deadline, url);
    if (P.selected(fresh) !== model) S.presetFail();
    if (!a._power()) P.click(P.unique(fresh, model).el, deadline, url);
    await power(deadline, url);
  }
  a.currentPreset = () => null;
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try {
      const model = P.selected(await models(deadline, url)); await close(deadline);
      P.check(deadline, url); return { model, effort: slider.closedLabel(this) };
    } finally { await close(deadline); }
  };
  async function positions(deadline, url) {
    await power(deadline, url); const initial = slider.value(a), result = [];
    await slider.move(a, initial.min, deadline, url);
    for (let index = initial.min; index <= initial.max; index++) {
      await power(deadline, url); const current = slider.value(a);
      if (current.min !== initial.min || current.max !== initial.max) S.presetFail();
      await slider.move(a, index, deadline, url); await close(deadline);
      const label = slider.closedLabel(a); result.push({ index, label });
    }
    P.labels(result, true); return result;
  }
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        const names = P.labels(await models(workDeadline, url)), selected = model ?? current.model;
        if (!names.includes(selected)) S.presetFail(); await chooseModel(selected, workDeadline, url);
        return { models: names, model: selected, efforts: P.labels(await positions(workDeadline, url), true), current, primary: 'model', secondary: 'effort' };
      } finally { await close(workDeadline); }
    });
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset) || preset.effort === null) S.presetFail();
      await chooseModel(preset.model, deadline, url);
      const target = P.unique(await positions(deadline, url), preset.effort);
      await power(deadline, url); await slider.move(this, target.index, deadline, url); await close(deadline);
      const actual = await this.readPreset(deadline); P.check(deadline, url);
      if (!S.presetSame(actual, preset)) S.presetFail(); return actual;
    } finally { await close(deadline); }
  };
})();
