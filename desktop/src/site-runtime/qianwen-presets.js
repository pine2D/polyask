// 千问：受控模型 dialog + 模式菜单，或已确认的日常页面模式；不把缺席的模型猜成默认。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['qianwen.com'], P = S?.presetDom; if (!a || !P) return;
  function modelButton() {
    const list = [...document.querySelectorAll('.desktop-no-drag [aria-haspopup="dialog"]')].filter(P.visible).filter(P.enabled)
      .filter(el => /^(Qwen(?:[\d\s.-]|$)|千问|千問)/i.test(P.firstText(el)));
    if (list.length > 1) S.presetFail();
    const legacy = a._trigger(); return list[0] || (P.visible(legacy) && P.enabled(legacy) ? legacy : null);
  }
  function modeButton() {
    const layout = S.findComposer()?.closest('[data-chat-input-layout]');
    if (!layout) return a._thinkBtn();
    // 2026-11 真机：同输入区还有附件与 More，按动作语义排除；不按当前模式名称定位。
    const list = [...layout.querySelectorAll('button[aria-haspopup="menu"]')].filter(P.visible).filter(P.enabled)
      .filter(el => !el.hasAttribute('data-capsule-layout') && !/^(添加附件|新增附件|Add attachments?|更多|More)$/i.test(el.getAttribute('aria-label') || ''));
    if (list.length > 1) S.presetFail(); return list[0] || a._thinkBtn();
  }
  const modeRoot = () => P.owned(modeButton());
  const modelRoot = () => { const b = modelButton(), root = b ? a._modelDialog(b) : null; return P.visible(root) ? root : null; };
  const roots = () => [modeRoot(), modelRoot()].filter(Boolean);
  const close = async deadline => {
    // 先回点已展开的入口，再发 Escape；避免 Escape 的异步更新与回点互相翻转状态。
    const mode = modeButton();
    if (modeRoot() && mode?.getAttribute('aria-expanded') === 'true')
      mode.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0 }));
    const button = modelButton();
    if (modelRoot() && button?.getAttribute('aria-expanded') === 'true') button.click();
    await P.close(roots, deadline);
  };
  const modelName = () => P.firstText(modelButton());
  const modeName = () => { const b = modeButton(); return (b?.getAttribute('aria-label') || P.text(b)).trim(); };
  function modeItems() {
    const root = modeRoot(); if (!root) return [];
    return [...root.querySelectorAll('[role="menuitemcheckbox"],[role="menuitemradio"]')].filter(P.visible).filter(P.enabled)
      .map(el => ({ el, label: P.firstText(el), selected: el.getAttribute('aria-checked') === 'true' }));
  }
  async function modes(deadline, url) {
    P.check(deadline, url); const button = modeButton(); if (!P.visible(button) || !P.enabled(button)) S.presetFail();
    if (button.getAttribute('aria-haspopup') !== 'menu') return [];
    const opened = !modeRoot();
    if (opened) P.act(deadline, url, () => button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window, button: 0 })));
    await P.wait(() => modeItems().length ? modeItems() : null, deadline, url);
    // 模型弹层的 300ms 退出过渡仍会拦截下一菜单动作；新开的模式菜单须等过渡落定。
    if (opened) await S.sleep(Math.min(350, Math.max(0, deadline - Date.now())));
    P.check(deadline, url);
    return P.wait(() => modeItems().length ? modeItems() : null, deadline, url);
  }
  function modelItems() {
    const root = modelRoot(); if (!root) return [];
    const elements = [...root.querySelectorAll('li,[role="option"],[role="menuitem"],[role="menuitemradio"],div.group.cursor-pointer')];
    return elements.filter(P.visible).filter(P.enabled).map(el => ({ el, label: P.text(el.querySelector('div.truncate')) || P.firstText(el), selected: false }));
  }
  async function models(deadline, url) {
    P.check(deadline, url); if (!modelRoot()) P.click(modelButton(), deadline, url, true);
    return P.wait(() => modelItems().length ? modelItems() : null, deadline, url, 2200);
  }
  async function chooseModel(model, deadline, url) {
    try {
      const item = P.unique(await models(deadline, url), model);
      if (modelName() !== model) P.click(item.el, deadline, url);
      await P.wait(() => modelName() === model, deadline, url);
    } finally { await close(deadline); }
  }
  a.currentPreset = function () {
    try {
      const b = modeButton(), m = modelButton(); if (!P.visible(b) || (!m && ![...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some(el => P.visible(el) && /^(日常|Daily)$/i.test(P.text(el))))) return null;
      const toggle = b.getAttribute('aria-haspopup') !== 'menu'; if (toggle && !m) return null;
      const model = m ? modelName() : modeName(), effort = m ? toggle ? this._isThink(b) ? 'On' : 'Off' : modeName() : null;
      const result = { model, effort }; return S.presetValid(result) ? result : null;
    } catch (_) { return null; }
  };
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); const current = this.currentPreset(); if (!current) S.presetFail();
      if (modelButton()) { P.unique(await models(deadline, url), current.model); await close(deadline); }
      if (modeButton()?.getAttribute('aria-haspopup') === 'menu') {
        const selected = P.selected(await modes(deadline, url));
        if (selected !== (modelButton() ? current.effort : current.model)) S.presetFail();
      }
      return current;
    } finally { await close(deadline); }
  };
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    return S.withPresetRestored(this, deadline, async (current, workDeadline) => {
      try {
        if (!modelButton()) {
          const list = await modes(workDeadline, url), names = P.labels(list), selected = model ?? current.model;
          if (!names.includes(selected) || P.selected(list) !== current.model) S.presetFail();
          return { models: names, model: selected, efforts: [], current, primary: 'mode' };
        }
        const names = P.labels(await models(workDeadline, url)), selected = model ?? current.model;
        if (!names.includes(selected)) S.presetFail(); await close(workDeadline);
        await chooseModel(selected, workDeadline, url);
        const toggle = modeButton()?.getAttribute('aria-haspopup') !== 'menu';
        return { models: names, model: selected, efforts: toggle ? ['Off', 'On'] : P.labels(await modes(workDeadline, url), true), current,
          primary: 'model', secondary: toggle ? 'toggle' : 'mode' };
      } finally { await close(workDeadline); }
    });
  };
  a.applyPreset = async function (preset, deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset) || !this.currentPreset()) S.presetFail();
      const hasModel = !!modelButton(); if (hasModel) await chooseModel(preset.model, deadline, url);
      const button = modeButton();
      if (button?.getAttribute('aria-haspopup') !== 'menu') {
        if (!['Off', 'On'].includes(preset.effort)) S.presetFail();
        if (this._isThink(button) !== (preset.effort === 'On')) P.click(button, deadline, url);
      } else {
        if (!hasModel && preset.effort !== null || hasModel && preset.effort === null) S.presetFail();
        const item = P.unique(await modes(deadline, url), hasModel ? preset.effort : preset.model);
        if (!item.selected) P.click(item.el, deadline, url);
      }
      await P.wait(() => S.presetSame(this.currentPreset(), preset), deadline, url); return { ...preset };
    } finally { await close(deadline); }
  };
})();
