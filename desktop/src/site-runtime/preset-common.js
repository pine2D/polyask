// 显式预设交互的共享边界；普通 state/selection 从不调用异步读取或打开菜单。
(function () {
  'use strict';
  const S = window.__AMS;
  if (!S) return;
  S.presetName = (value, limit = 48) => typeof value === 'string' && value.length > 0 && value.length <= limit &&
    value.trim() === value && !/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(value);
  S.presetValid = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 &&
    S.presetName(value.model) && (value.effort === null || S.presetName(value.effort, 24));
  S.presetSame = (x, y) => !!x && !!y && x.model === y.model && x.effort === y.effort;
  S.presetFail = (code = 'preset_unavailable') => { throw new Error(code); };
  S.readPreset = async function (adapter, deadline) {
    const url = location.href;
    S.checkDeadline(deadline);
    const value = await (adapter.readPreset ? adapter.readPreset(deadline) : adapter.currentPreset?.());
    if (location.href !== url) S.presetFail('not_ready');
    S.checkDeadline(deadline);
    if (!S.presetValid(value)) S.presetFail();
    return { model: value.model, effort: value.effort };
  };
})();
