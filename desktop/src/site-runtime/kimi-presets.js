// Kimi 设置探测不换模型（会离开会话）；实际切档允许网站自身的模型导航。
(function () {
  'use strict';
  const S = window.__AMS, a = S?.adapters?.['kimi.com'], P = S?.presetDom; if (!a || !P) return;
  a.presetModelRequiresNavigation = true;
  const visible = el => P.visible(el) && !el.closest('.kimi-menu-leave-active');
  const roots = () => [...document.querySelectorAll('.model-list-options')].filter(visible);
  function models() {
    const list = roots(); if (list.length !== 1) S.presetFail();
    return [...list[0].querySelectorAll('.model-item')].filter(visible).filter(P.enabled).map(el => ({ el,
      label: P.text(el.querySelector('.name')), selected: el.classList.contains('checked') }));
  }
  function effortRow() {
    const list = [...document.querySelectorAll('.kimi-menu__inner .effort-item')].filter(visible)
      .filter(el => /^(Thinking effort|思考强度|思考强度设置|推理强度)$/i.test(P.text(el.querySelector('.effort-title'))));
    if (list.length > 1) S.presetFail(); return list[0] || null;
  }
  const close = deadline => {
    const opened = [...roots(), P.owned(effortRow())].filter(Boolean);
    return P.close(() => [...new Set([...roots(), ...opened.filter(visible)])], deadline, d => a._close(d));
  };
  async function open(deadline, url) {
    P.check(deadline, url); if (!roots().length) P.click(a._entry(), deadline, url);
    return P.wait(() => roots().length && models().length ? models() : null, deadline, url);
  }
  async function efforts(deadline, url) {
    await open(deadline, url); const row = effortRow();
    if (!row) { if (a._effort()) S.presetFail(); return []; }
    const list = () => {
      const owner = effortRow(), homes = [owner, P.owned(owner)].filter(Boolean);
      return [...new Set(homes.flatMap(home => [...home.querySelectorAll('.effort-option')]))].filter(visible).filter(P.enabled)
        .map(el => ({ el, label: P.text(el.querySelector('.effort-name')), selected: el.classList.contains('checked') }));
    };
    for (let i = 0; i < 3; i++) {
      const fresh = effortRow(); if (!fresh) S.presetFail();
      for (const type of ['pointerenter', 'mouseenter', 'pointerover', 'mouseover'])
        P.act(deadline, url, () => fresh.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
      const found = await S.waitFor(() => list().length ? list() : null, 600, 60, deadline);
      P.check(deadline, url); if (found) { P.labels(found, true); return found; }
    }
    S.presetFail();
  }
  a.currentPreset = function () {
    const model = this._model(), effort = this._effort();
    if (!P.visible(this._entry()) || !S.presetName(model)) return null;
    if (S.presetName(effort, 24)) return { model, effort };
    try { return roots().length && P.selected(models()) === model && !effortRow() ? { model, effort: null } : null; }
    catch (_) { return null; }
  };
  a.readPreset = async function (deadline) {
    const url = S.presetContext();
    try {
      P.check(deadline, url); const current = this.currentPreset(); if (current) return current;
      await open(deadline, url); const value = this.currentPreset(); if (!value) S.presetFail(); return value;
    } finally { await close(deadline); }
  };
  a.presetOptions = async function (model, deadline) {
    const url = S.presetContext();
    try {
      const current = await this.readPreset(deadline);
      const list = P.labels(await open(deadline, url)), selected = model ?? current.model;
      if (!list.includes(selected)) S.presetFail();
      if (selected !== current.model) S.presetFail('preset_model_switch_required');
      return { models: list, model: selected, efforts: P.labels(await efforts(deadline, url), true), current, primary: 'model', secondary: 'effort' };
    } finally { await close(deadline); }
  };
  a.applyPreset = async function (preset, deadline) {
    let url = S.presetContext();
    try {
      P.check(deadline, url); if (!S.presetValid(preset)) S.presetFail();
      const item = P.unique(await open(deadline, url), preset.model);
      if (!item.selected) {
        const host = location.hostname; P.click(item.el, deadline, url);
        // 唯一允许跟随导航的预设动作；只在目标模型确实回显且仍在本站时继续。
        if (!await S.waitFor(() => location.hostname === host && this._model() === preset.model, 1600, 60, deadline)) S.presetFail();
        S.checkDeadline(deadline); url = S.presetContext();
        await close(deadline);
      }
      const list = await efforts(deadline, url);
      if (preset.effort === null) { if (list.length) S.presetFail(); }
      else {
        const target = P.unique(list, preset.effort);
        if (this._effort() !== preset.effort) P.click(target.el, deadline, url);
      }
      await P.wait(() => this._model() === preset.model && (this._effort() || null) === preset.effort, deadline, url);
      return { ...preset };
    } finally { await close(deadline); }
  };
})();
