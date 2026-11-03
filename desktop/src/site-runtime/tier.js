// 切档动作和只读证据分离：无异常不等于已确认，未知状态不触发循环点击。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  function normalize(value, mode) {
    const unconfirmed = { requested: mode, outcome: "unconfirmed" };
    if (!value || Array.isArray(value) || value.observed !== mode) return unconfirmed;
    if (value.outcome === "mode_only" && value.model === undefined)
      return { requested: mode, outcome: "mode_only", observed: mode };
    const model = value.model;
    if (["preferred", "alternative"].includes(value.outcome) && typeof model === "string"
      && model.trim() && model.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(model))
      return { requested: mode, outcome: value.outcome, observed: mode, model: model.trim() };
    return unconfirmed;
  }
  function current(mode) {
    const a = S.pickAdapter();
    return typeof a?.selection === "function" ? a.selection(mode) : { outcome: "mode_only", observed: a?.state?.() };
  }
  function observed(mode) {
    try { return normalize(current(mode), mode); }
    catch (_) { return { requested: mode, outcome: "unconfirmed" }; }
  }
  S.tierCommand = function (msg, respond, serialize) {
    if (msg.cmd !== "setTier") return false;
    serialize(async () => {
      const deadline = Number(msg.deadline) || 0;
      if (Date.now() >= deadline) return { ok: false, code: "timeout" };
      if (!["think", "fast"].includes(msg.tier)) return { ok: false, code: "invalid_response" };
      const waitMs = Math.min(4000, Math.max(0, deadline - Date.now()));
      if (!(await S.waitFor(() => S.findComposer(), waitMs, 120, deadline))) return { ok: false, code: "composer_not_found" };
      if (Date.now() >= deadline) return { ok: false, code: "timeout" };
      const selection = await S.resolveTier(msg.tier, deadline);
      const ok = selection.outcome !== "unconfirmed" && Date.now() < deadline;
      return { ok, selection, ...(!ok ? { code: Date.now() >= deadline ? "timeout" : "tier_unconfirmed" } : {}) };
    }).then(respond, () => respond({ ok: false, code: Date.now() >= Number(msg.deadline) ? "timeout" : "error" }));
    return true;
  };
  S.resolveTier = async function (mode, deadline = Date.now() + 10000, image) {
    const unconfirmed = { requested: mode, outcome: "unconfirmed" };
    if (!["think", "fast"].includes(mode) || Date.now() >= deadline) return unconfirmed;
    // 专用适配器失败只走其既有两次尝试，不把“不安全”异常转给别的点击策略。
    const action = await S.runModeAction(mode, true, image, deadline);
    if (!action || Date.now() >= deadline) return unconfirmed;
    // 证据仅存在于本次调用；收尾失败/超时不会抵达这里，当前明确相反的状态也不能被旧读数覆盖。
    if (action.selection !== undefined) {
      try {
        const latest = current(mode)?.observed;
        if (["think", "fast"].includes(latest) && latest !== mode) return unconfirmed;
        return normalize(action.selection, mode);
      } catch (_) { return unconfirmed; }
    }
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
