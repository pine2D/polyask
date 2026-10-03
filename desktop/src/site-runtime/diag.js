// desktop/src/site-runtime/diag.js — 巡检通用检查：给九站 diagnose() 统一前置只读常驻锚点（输入框/发送键）。
// 必须在 adapters-*.js 之后注入（注册表已填充才能逐站包装）；新增站点/新分卷自动获得通用检查。
// 契约同 adapter.diagnose（CLAUDE.md / docs/adapters.md）：只读同步、不得开菜单、只列常驻控件。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S || !S.adapters) return;
  // 通用检查两条：
  // ① composer 存在——九站常驻，findComposer 返回 null 意味着整条群发链必然 composer_not_found；
  // ② 发送键存在——仅适配器声明 sendSel 的站（DeepSeek/Kimi/元宝）。不做全站发送键检查：ChatGPT 空输
  //    入框时发送键被语音键替换、豆包发送键干脆不在 DOM（真机 2026-08-18），通用检查会在巡检时恒红误报。
  function common(a) {
    const checks = [{ name: t("diag_composer"), ok: !!S.findComposer(), kind: "reach" }];
    if (a.sendSel) checks.push({ name: t("diag_sendKey"), ok: !!document.querySelector(a.sendSel), kind: "control" });
    return checks;
  }
  // 采集定位探针（kind:"capture"，只提示、不决定站点可用性）：只看第 ① 级逐站选择器能否定位末条用户轮次与其回答根，
  // ②③ 级兜底接得住也记红——那正是选择器已漂移的信号。首页/新会话天然零命中，只在会话路由上产出，
  // 路由语义复用 history.js 的 route()。只读同步：historyTurn 不开菜单、不序列化正文。
  function capture(a) {
    if (typeof a.historyTurn !== "function" || typeof S.history?.route !== "function") return [];
    let turn = null;
    try { if (S.history.route().home) return []; turn = a.historyTurn({ method: "selector" }); } catch (_) {}
    return [{ name: t("diag_captureUser"), ok: !!turn?.user, kind: "capture" },
      { name: t("diag_captureAnswer"), ok: !!(turn?.user && (turn.answerRoot || turn.answer)), kind: "capture" }];
  }
  Object.keys(S.adapters).forEach(function (key) {
    const a = S.adapters[key];
    if (a.__diagWrapped) return; // 幂等：真机排错时重复注入本文件不得叠加包装（否则通用检查出现两遍）
    a.__diagWrapped = true;
    const orig = typeof a.diagnose === "function" ? a.diagnose.bind(a) : null;
    a.diagnose = function () {
      let rest;
      // orig 抛异常正是站点改版的高发场景——不能让它把通用检查一起带走，降级为一条「诊断异常」
      if (orig) { try { rest = orig(); } catch (e) { rest = [{ name: t("cs_diagError"), ok: false, kind: "probe" }]; } }
      // 缺 diagnose 的站保住「档位可读」兜底——core.js 的同款回退分支已被本包装遮蔽（包装后 a.diagnose 恒存在）
      else rest = [{ name: t("diag_tierReadable"), ok: S.getState() != null, kind: "tier" }];
      return common(a).concat(rest, capture(a));
    };
  });
})();
