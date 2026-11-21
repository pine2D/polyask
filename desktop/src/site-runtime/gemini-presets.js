// Gemini 模型与 Thinking level 分开取证；闭合按钮省略 Low，不能靠它推测等级。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['gemini.google.com'], P = S?.presetDom; if (!a || !P) return;
  const MODEL = '[data-test-id^="bard-mode-option-"]';
  const ITEM = '[role="menuitemradio"],[role="menuitem"],button.mat-mdc-menu-item';
  const label = el => P.text(el.querySelector('.label')) || P.firstText(el);
  const carbonNames = ['Most complex work', 'Code & complex work', '4 Carbon'];
  const listView = /^(?:List view|列表视图|列表視圖|清單檢視)$/i;
  const viewButtons = panel => [...panel.querySelectorAll('button,[role="button"]')]
    .filter(el => listView.test(P.text(el)) || listView.test(el.getAttribute('aria-label') || '')).filter(P.visible);
  function table() {
    const panels = [...document.querySelectorAll('.cdk-overlay-pane,[role="dialog"],[role="menu"],[popover],bard-mode-switcher')]
      .filter(panel => /Periodic Table of Gemini|Gemini\s*(?:的)?元素[周週]期表/i.test(panel.textContent) && P.visible(panel) && viewButtons(panel).length);
    return panels.find(panel => !panels.some(other => other !== panel && panel.contains(other))) || null;
  }
  function root() {
    const owned = P.owned(a._modelBtn()); if (owned) return owned;
    const list = [...document.querySelectorAll('[role="menu"]')].filter(P.visible).filter(el => el.querySelector(MODEL));
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  a._listRoot = root;
  a._periodicTable = table;
  a._listPicker = () => !!(a._modelBtn()?.closest('[data-test-id="bard-mode-menu-button"]') || root() || table());
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
  const roots = () => [table(), root(), P.owned(levelTrigger())].filter(Boolean);
  function close(deadline = Date.now() + 1000) {
    return P.close(roots, deadline, async d => {
      if (roots().length && Date.now() < d) await S.sleep(Math.min(200, Math.max(0, d - Date.now())));
      if (roots().length) a._modelBtn()?.click();
    });
  }
  a._closeList = close;
  // 宽版和窄版入口可重绘；已在周期表时只点所属面板的 List view。
  a._openList = async function (deadline, url) {
    P.check(deadline, url);
    const surface = () => table() || root();
    if (!surface()) P.click(a._modelBtn(), deadline, url, true);
    await P.wait(surface, deadline, url);
    const panel = table();
    if (panel) {
      const buttons = viewButtons(panel);
      if (buttons.length !== 1) S.presetFail();
      P.click(buttons[0], deadline, url);
      await P.wait(() => !table() && root(), deadline, url);
    }
  };
  async function open(deadline, url) {
    await a._openList(deadline, url);
    return P.wait(() => models().length ? models() : null, deadline, url);
  }
  async function levels(deadline, url) {
    await open(deadline, url); const trigger = levelTrigger(); if (!trigger) return [];
    if (!levelItems().length) P.click(trigger, deadline, url, true);
    return P.wait(() => levelItems().length ? levelItems() : null, deadline, url);
  }
  a.currentPreset = function () {
    try {
      if (table() || !root()) return null;
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
  function modelItem(items, name) {
    if (!carbonNames.includes(name)) return P.unique(items, name);
    // 两代列表的用途名称不同，只以当前行仍带准确的 4 Carbon 为兼容证据。
    const carbon = items.filter(item => /^4\s+Carbon$/i.test(a._modelLabel(item.el)));
    if (carbon.length !== 1) S.presetFail();
    return P.unique(items, carbon[0].label);
  }
  async function chooseModel(model, deadline, url) {
    const item = modelItem(await open(deadline, url), model);
    if (!item.selected) { P.click(item.el, deadline, url); await close(deadline); }
    if (P.selected(await open(deadline, url)) !== item.label) S.presetFail();
    return item.label;
  }
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        const names = P.labels(await open(workDeadline, url));
        const requested = model ?? current.model, selected = await chooseModel(requested, workDeadline, url);
        // 指定旧标签的目录仍须与请求同名；普通刷新直接显示网页当前名称。
        const models = names.map(name => name === selected ? requested : name);
        if (new Set(models).size !== models.length) S.presetFail();
        return { models, model: requested, efforts: P.labels(await levels(workDeadline, url), true), current, primary: 'model', secondary: 'effort' };
      } finally { await close(workDeadline); }
    });
  };
  a.presetForTier = async function (preset, deadline) {
    if (!carbonNames.includes(preset.model) && !(a._taskMode() && preset.effort !== null)) return preset;
    const url = S.presetContext();
    try {
      const model = modelItem(await open(deadline, url), preset.model).label;
      return { model, effort: a._taskMode() && !levelTrigger() ? null : preset.effort };
    } finally { await close(deadline); }
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset)) S.presetFail();
      if (a._taskMode() && preset.effort !== null) S.presetFail();
      const model = await chooseModel(preset.model, deadline, url), list = await levels(deadline, url);
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
      if (!S.presetSame(actual, { model, effort: preset.effort })) S.presetFail();
      return { model: preset.model, effort: actual.effort };
    } finally { await close(deadline); }
  };
})();
