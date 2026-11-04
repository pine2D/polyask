// ChatGPT Default：六格是模型 + 强度组合，不能用 High/Pro 字样推断全局档位。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const { checkDeadline, tierAction, waitFor, sleep, escMenus } = S;
  const normalize = value => String(value || "").replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, "").toLowerCase();
  const targets = {
    fast: { index: 1, model: "GPT-6.1 Sol", label: /^(?:gpt-?)?6\.1sollight$/ },
    think: { index: 5, model: "GPT-6 Astra", label: /^(?:gpt-?)?6astraextrahigh$/ },
  };
  const defaults = [{ model: "Default", aliases: ["Default", "Default Recommended set of models"] }];
  const expanded = /^(?:default(?:recommendedsetofmodels)?|gpt-6(?:\.1)?(?:sol|terra|astra|luna))$/;
  const legacy = /^(?:gpt-?6|6|gpt-5\.6sol|gpt-5\.[345]|latest|最新)$/;
  function hasPresets(adapter) {
    const root = adapter._root();
    return [...(root?.querySelectorAll('[role="menuitemradio"]') || [])]
      .some(node => expanded.test(normalize(node.textContent)));
  }

  // 只读闭合按钮；排除隐藏测量文案，不使用可能滞后的 effort data 属性。
  function current(adapter) {
    const a = adapter._anchor();
    if (!a || a.getAttribute("aria-expanded") === "true") return null;
    let text = a.innerText != null ? a.innerText : a.textContent;
    if (a.nodeType === 1 && a.ownerDocument?.createTreeWalker) {
      const parts = [], walker = a.ownerDocument.createTreeWalker(a, 4);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let hidden = false;
        for (let p = node.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p);
          if (p.getAttribute("aria-hidden") === "true" || style.display === "none" || /hidden|collapse/.test(style.visibility)) { hidden = true; break; }
          if (p === a) break;
        }
        if (!hidden) parts.push(node.nodeValue);
      }
      text = parts.join(" ");
    }
    const label = normalize(text).replace(/^(thinkingeffort|selectmodel|思考强度|选择模型)/, "");
    const mode = Object.keys(targets).find(key => targets[key].label.test(label));
    if (mode) return { observed: mode, model: targets[mode].model };
    return /^(?:gpt-?)?6(?:\.\d+)?(?:sol|terra|astra|luna)/.test(label) ? { observed: null } : null;
  }
  function level(adapter) {
    if (!adapter._controlledMenu()) throw new Error("ChatGPT: 菜单关联未确认");
    const value = adapter._level();
    if (!value || value.min !== 0 || value.max !== 5 || !Number.isInteger(value.now))
      throw new Error("ChatGPT: Default 预设范围未确认");
    return value;
  }
  async function apply(adapter, mode, deadline) {
    const resident = () => [...(adapter._root()?.querySelectorAll('[role="menuitemradio"]') || [])];
    const knownLegacy = nodes => nodes.length > 0 && nodes.every(node => legacy.test(normalize(node.textContent)));
    if (knownLegacy(resident())) return null;
    try {
      checkDeadline(deadline);
      if (!resident().length) {
        const strict = !!adapter._root()?.querySelector?.("[data-model-picker-view]");
        await adapter._showModels(deadline, strict);
        if (knownLegacy(resident())) return null;
      }
      // 先识别全部常驻项，再验证组件：隐藏 Default、标签漂移、缺 hook 均不能授权旧回退。
      if (!hasPresets(adapter)) throw new Error("ChatGPT: 未找到模型（未识别的菜单）");
      let root = adapter._controlledMenu();
      if (!root) throw new Error("ChatGPT: 未找到模型（菜单关联未确认）");
      if (!root.querySelector("[data-model-picker-view]") || !root.querySelector("[data-model-picker-power-slider]"))
        throw new Error("ChatGPT: Default 控件结构未确认");
      const items = await adapter._showModels(deadline, true);
      root = adapter._controlledMenu();
      if (!root || items.some(node => !root.contains(node))) throw new Error("ChatGPT: 菜单关联已改变");
      const match = S.matchSelection(items, defaults, adapter._modelInfo);
      if (!match) throw new Error("ChatGPT: Default 选项未确认");
      // 选择 Default 同时退出模型列表；已选中仍重选，以取得本次实际 simple 面板证据。
      tierAction(deadline, () => match.candidate.click()); await sleep(220, deadline);
      await adapter._openRoot(deadline);
      if (!(await waitFor(() => adapter._power(), 1500, 120, deadline))) throw new Error("ChatGPT: Default 滑块未展开");
      let value = level(adapter);
      const target = targets[mode];
      for (let i = 0; i <= 5 && value.now !== target.index; i++) {
        const power = adapter._power();
        if (!power) throw new Error("ChatGPT: Default 滑块已失效");
        const key = value.now < target.index ? "ArrowRight" : "ArrowLeft";
        tierAction(deadline, () => power.focus());
        for (const type of ["keydown", "keyup"]) tierAction(deadline, () => power.dispatchEvent(
          new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, view: window })));
        await sleep(220, deadline);
        value = level(adapter);
      }
      if (value.now !== target.index) throw new Error("ChatGPT: Default 目标档位未生效");
      escMenus();
      const confirmed = await waitFor(() => {
        const actual = current(adapter);
        return actual?.observed === mode && actual.model === target.model ? actual : null;
      }, 1500, 120, deadline);
      if (!confirmed) throw new Error("ChatGPT: Default 模型与强度未确认");
      return { outcome: "preferred", ...confirmed };
    } finally { escMenus(); }
  }
  S.chatGptDefault = { apply, current, hasPresets };
})();
