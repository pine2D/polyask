// 纯候选匹配：站点先限定控件语义，再提供文字/可见/禁用证据；此处不查 DOM、不点击。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const normalize = text => typeof text === "string" ? text
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "").replace(/[\u2010-\u2015\u2212\ufe63\uff0d]/g, "-")
    .replace(/\s+/g, "").toLowerCase() : "";

  // preferences 按优先级排列；别名必须显式登记，不从版本号或 Pro/Max 推测能力。
  // read(candidate) -> { text, visible: boolean, disabled: boolean }。
  // 返回 { candidate, model } 或 null；最高命中优先级存在多个选项即拒绝，不跳过歧义。
  S.matchSelection = function (candidates, preferences, read) {
    const matches = preferences.map(() => []);
    for (const candidate of new Set(candidates)) {
      const info = read(candidate);
      if (!info || info.visible !== true || info.disabled !== false) continue;
      const text = normalize(info.text);
      if (!text) continue;
      const indexes = preferences.flatMap((entry, index) =>
        entry.aliases.some(alias => normalize(alias) === text) ? [index] : []);
      if (indexes.length > 1) return null;
      if (indexes.length) matches[indexes[0]].push(candidate);
    }
    const index = matches.findIndex(items => items.length);
    if (index < 0 || matches[index].length !== 1) return null;
    return { candidate: matches[index][0], model: preferences[index].model };
  };
})();
