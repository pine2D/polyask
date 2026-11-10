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
  let navigationRevision = 0;
  S.invalidatePreset = () => { navigationRevision++; };
  // Navigation API 在 pushState（包括同 URL）之前通知；popstate/hashchange 兼容其它导航。
  window.navigation?.addEventListener('navigate', S.invalidatePreset);
  window.addEventListener('popstate', S.invalidatePreset);
  window.addEventListener('hashchange', S.invalidatePreset);
  S.presetContext = () => ({ url: location.href, revision: navigationRevision });
  S.presetIsCurrent = context => context.url === location.href && context.revision === navigationRevision;
  S.presetCheck = (deadline, context) => {
    S.checkDeadline(deadline); if (!S.presetIsCurrent(context)) S.presetFail('not_ready');
  };
  S.readPreset = async function (adapter, deadline) {
    const context = S.presetContext();
    S.checkDeadline(deadline);
    const value = await (adapter.readPreset ? adapter.readPreset(deadline) : adapter.currentPreset?.());
    if (!S.presetIsCurrent(context)) S.presetFail('not_ready');
    S.checkDeadline(deadline);
    if (!S.presetValid(value)) S.presetFail();
    return { model: value.model, effort: value.effort };
  };
})();
