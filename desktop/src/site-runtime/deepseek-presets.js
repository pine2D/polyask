// DeepSeek 的真实能力：DeepThink 开关；旧首屏另有模式 radio。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['deepseek.com'], P = S?.presetDom; if (!a || !P) return;
  function toggle() {
    const found = [...document.querySelectorAll('.ds-toggle-button')].filter(P.visible).filter(el => /deepthink|深度思考/i.test(P.text(el)));
    if (found.length !== 1 || !P.enabled(found[0])) S.presetFail();
    const el = found[0], pressed = el.getAttribute('aria-pressed');
    if (!['true', 'false'].includes(pressed)) S.presetFail();
    return { el, label: P.text(el), value: pressed === 'true' ? 'On' : 'Off' };
  }
  function modes() {
    const radios = [...document.querySelectorAll('[role="radio"]')].filter(P.visible);
    const anchors = radios.filter(el => /^(Instant|Expert|Vision|即时|专家|视觉)$/i.test(P.text(el)));
    if (!anchors.length) return [];
    const roots = new Set(anchors.map(el => el.closest('[role="radiogroup"]') || el.parentElement));
    if (roots.size !== 1) S.presetFail();
    return radios.filter(el => [...roots][0].contains(el) && P.enabled(el))
      .map(el => ({ el, label: P.text(el), selected: el.getAttribute('aria-checked') === 'true' }));
  }
  a.currentPreset = function () {
    try { const t = toggle(), list = modes(); return { model: list.length ? P.selected(list) : t.label, effort: t.value }; }
    catch (_) { return null; }
  };
  a.presetOptions = async function (model, deadline) {
    S.checkDeadline(deadline); const current = this.currentPreset(); if (!current) S.presetFail();
    const list = modes(), models = list.length ? P.labels(list) : [toggle().label], selected = model ?? current.model;
    if (!models.includes(selected)) S.presetFail();
    return { models, model: selected, efforts: ['Off', 'On'], current, primary: list.length ? 'mode' : 'feature', secondary: 'toggle' };
  };
  a.applyPreset = async function (preset, deadline, image) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset) || !['Off', 'On'].includes(preset.effort)) S.presetFail();
      const list = modes(), t = toggle();
      if (list.length) {
        const item = P.unique(list, preset.model);
        if (image && !/^(Vision|视觉)$/i.test(preset.model)) S.presetFail();
        if (!item.selected) P.click(item.el, deadline, url);
        await P.wait(() => this.currentPreset()?.model === preset.model, deadline, url);
      } else if (preset.model !== t.label) S.presetFail();
      const fresh = toggle(); if (fresh.value !== preset.effort) P.click(fresh.el, deadline, url);
      await P.wait(() => S.presetSame(this.currentPreset(), preset), deadline, url);
      return { ...preset };
    } finally { S.escMenus(); }
  };
})();
