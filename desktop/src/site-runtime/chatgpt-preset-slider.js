// 每格只读网页实际闭合标签；Default 的格子是联合模型身份，不能由位置合成名称。
(function () {
  'use strict';
  const S = window.__AMS, P = S?.presetDom; if (!P) return;
  function value(adapter) {
    const v = adapter._level();
    if (!v || ![v.min, v.max, v.now].every(Number.isInteger) || v.min < 0 || v.max - v.min >= 12) S.presetFail();
    return v;
  }
  async function move(adapter, target, deadline, url) {
    let v = value(adapter);
    if (target < v.min || target > v.max) S.presetFail();
    for (let i = 0; i < 12 && v.now !== target; i++) {
      const old = v.now, power = adapter._power(), key = old < target ? 'ArrowRight' : 'ArrowLeft';
      P.act(deadline, url, () => { power.focus(); power.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })); });
      v = await P.wait(() => { const next = value(adapter); return next.now !== old ? next : null; }, deadline, url, 650);
      if (v.now !== old + (key === 'ArrowRight' ? 1 : -1)) S.presetFail();
    }
    if (v.now !== target) S.presetFail();
  }
  function closedLabel(adapter) {
    const value = S.chatGptDefault.closedLabel(adapter);
    if (!P.visible(adapter._anchor()) || !S.presetName(value, 24)) S.presetFail();
    return value;
  }
  S.presetSlider = { value, move, closedLabel };
})();
