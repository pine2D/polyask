// 切档动作和只读证据分离：无异常不等于已确认，未知状态不触发循环点击。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  function observed(mode) {
    const unconfirmed = { requested: mode, outcome: "unconfirmed" };
    const a = S.pickAdapter();
    if (!a) return unconfirmed;
    try {
      if (typeof a.selection === "function") {
        const value = a.selection(mode);
        if (!value || Array.isArray(value) || value.observed !== mode) return unconfirmed;
        if (value.outcome === "mode_only" && value.model === undefined)
          return { requested: mode, outcome: "mode_only", observed: mode };
        const model = value.model;
        if (["preferred", "alternative"].includes(value.outcome) && typeof model === "string"
          && model.trim() && model.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(model))
          return { requested: mode, outcome: value.outcome, observed: mode, model: model.trim() };
        return unconfirmed;
      }
      return a.state?.() === mode ? { requested: mode, outcome: "mode_only", observed: mode } : unconfirmed;
    } catch (_) { return unconfirmed; }
  }
  S.resolveTier = async function (mode, deadline = Date.now() + 10000, image) {
    const unconfirmed = { requested: mode, outcome: "unconfirmed" };
    if (!["think", "fast"].includes(mode) || Date.now() >= deadline) return unconfirmed;
    // 专用适配器失败只走其既有两次尝试，不把“不安全”异常转给别的点击策略。
    if (!await S.runModeAction(mode, true, image, deadline) || Date.now() >= deadline) return unconfirmed;
    const until = Math.min(deadline, Date.now() + 800);
    do {
      const result = observed(mode);
      if (result.outcome !== "unconfirmed") return result;
      if (Date.now() >= until) break;
      await S.sleep(Math.min(100, Math.max(0, until - Date.now())));
    } while (Date.now() < deadline);
    return unconfirmed;
  };
})();
