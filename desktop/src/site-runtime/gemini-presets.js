// Gemini 模型与 Thinking level 分开取证；闭合按钮省略 Low，不能靠它推测等级。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['gemini.google.com'], P = S?.presetDom; if (!a || !P) return;
  const MODEL = '[data-test-id^="bard-mode-option-"]';
  const ITEM = '[role="menuitemradio"],[role="menuitem"],button.mat-mdc-menu-item';
  const label = el => P.text(el.querySelector('.label')) || P.firstText(el);
  function root() {
    const owned = P.owned(a._modelBtn()); if (owned) return owned;
    const list = [...document.querySelectorAll('[role="menu"]')].filter(P.visible).filter(el => el.querySelector(MODEL));
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  function levelTrigger() {
    const list = [...(root()?.querySelectorAll(ITEM) || [])].filter(P.visible)
      .filter(el => /^(Thinking level|思考等级|思考程度|思考)$/i.test(label(el)));
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  function models() {
    const home = root(); if (!home) return [];
    const modern = [...home.querySelectorAll(MODEL)], trigger = levelTrigger();
    return (modern.length ? modern : [...home.querySelectorAll(ITEM)].filter(el =>
      !trigger?.contains(el) && !/^(Thinking level|Extended thinking|Extended|思考等级|思考程度|扩展思考|擴展思考)$/i.test(label(el))))
      .filter(P.visible).filter(P.enabled).map(el => ({ el, label: label(el), selected: a._selected(el) }));
  }
  function levelItems() {
    const trigger = levelTrigger(); if (!trigger) return [];
    const homes = [trigger, P.owned(trigger)].filter(Boolean);
    return [...new Set(homes.flatMap(home => [...home.querySelectorAll(ITEM)]))].filter(P.visible).filter(P.enabled)
      .map(el => ({ el, label: label(el), selected: a._selected(el) }));
  }
  const roots = () => [root(), P.owned(levelTrigger())].filter(Boolean);
  const close = deadline => P.close(roots, deadline, async d => {
    if (root() && Date.now() < d) await S.sleep(Math.min(200, Math.max(0, d - Date.now())));
    if (root()) a._modelBtn()?.click();
  });
  async function open(deadline, url) {
    P.check(deadline, url); if (!root()) P.click(a._modelBtn(), deadline, url, true);
    return P.wait(() => models().length ? models() : null, deadline, url);
  }
  async function levels(deadline, url) {
    await open(deadline, url); const trigger = levelTrigger(); if (!trigger) return [];
    if (!levelItems().length) P.click(trigger, deadline, url, true);
    return P.wait(() => levelItems().length ? levelItems() : null, deadline, url);
  }
  a.currentPreset = function () {
    try {
      if (!root()) return null;
      return { model: P.selected(models()), effort: levelTrigger() ? P.selected(levelItems()) : null };
    } catch (_) { return null; }
  };
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try {
      const model = P.selected(await open(deadline, url)), list = await levels(deadline, url);
      return { model, effort: list.length ? P.selected(list) : null };
    } finally { await close(deadline); }
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
        return { models: names, model: selected, efforts: P.labels(await levels(workDeadline, url), true), current, primary: 'model', secondary: 'effort' };
      } finally { await close(workDeadline); }
    });
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset)) S.presetFail();
      await chooseModel(preset.model, deadline, url); const list = await levels(deadline, url);
      if (preset.effort === null) { if (list.length) S.presetFail(); }
      else {
        const item = P.unique(list, preset.effort);
        if (!item.selected) {
          P.act(deadline, url, () => { item.el.focus(); item.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
          if (P.visible(item.el)) P.click(item.el, deadline, url);
        }
      }
      await close(deadline);
      const actual = await this.readPreset(deadline); P.check(deadline, url);
      if (!S.presetSame(actual, preset)) S.presetFail(); return actual;
    } finally { await close(deadline); }
  };
})();
