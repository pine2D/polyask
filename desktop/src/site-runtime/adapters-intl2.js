// desktop/src/site-runtime/adapters-intl2.js — 国际站点适配器·续（ChatGPT）。
// adapters-intl.js 触及 300 行上限后按站分卷；契约与注意事项同 adapters-intl.js / CLAUDE.md。
// desktop/src/preload/site.ts 的 require 列表里必须排在 adapters-intl.js 之后、diag.js 之前（diag 按已填充的注册表
// 统一包装 diagnose，排在它后面的分卷拿不到通用检查且静默缺席）。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, openMenu, clickEl, sleep, escMenus, checkDeadline, tierAction } = S;

  Object.assign(S.adapters, {
    "chatgpt.com": {
      // 2026-08-31 改版实测（chrome-dbg，英文界面）：pill 菜单是 Radix popper
      // `[data-testid="composer-intelligence-picker-content"]`，**没有任何 aria-haspopup 子菜单**——
      // 档位从「radio 列表」改成一根 5 格滑块（Power 项，0..4 = Instant/Medium/High/Extra High/Pro），
      // 模型 radio（GPT-5.6 Sol / GPT-5.5）与滑块同时常驻。关闭时 pill 显示当前档名（如 Pro），
      // 打开时显示控件名 Thinking effort。中文界面档位词仍为候选、待真机验证。
      // 菜单开着时 pill 文本变控件名「Thinking effort」（真机 2026-08-31）——不是档位，state() 判非终态
      _OPEN_PILL: /^(thinking effort|思考(强度|力度)?)$/i,
      // 旧模型会把版本前缀并进 pill（实测如 5.5Pro / 5.5Instant），先剥掉再判档。
      _tier: function (text) {
        return (text || "").trim().replace(/^(?:gpt-?)?(?:6(?![\d.]|\s*sol)|5\.[3456](?:\s*sol)?)/i, "").trim();
      },
      // 2026-09-28：新版去掉 __composer-pill，改用专属 data 属性；旧版选择子保留兜底。
      // 不按档位文本定位，菜单展开时按钮显示的是控件名。
      _anchor: function () {
        return document.querySelector('button[data-codex-intelligence-trigger="true"][aria-haspopup="menu"]') ||
          document.querySelector('button.__composer-pill[aria-haspopup="menu"]');
      },
      // 打开 pill 菜单（2026-08 改版：Radix popper `composer-intelligence-picker-content`，
      // 里面是 Power 滑块 + 常驻的模型 radio，**没有任何 aria-haspopup 子菜单入口**）
      _openRoot: async function (deadline) {
        checkDeadline(deadline);
        const anchor = this._anchor();
        if (!anchor) throw new Error("ChatGPT: Intelligence 按钮未找到");
        const open = () => document.querySelector('[data-testid="composer-intelligence-picker-content"]') || this._power();
        for (let i = 0; i < 2; i++) { if (open()) return; tierAction(deadline, () => openMenu(anchor)); if (await waitFor(open, 1500, 120, deadline)) return; }
        escMenus(); throw new Error("ChatGPT: 档位菜单未展开");
      },
      // 档位控件：role=menuitem[aria-label=Power]，内含 [data-model-reasoning-effort-slider]；
      // 两条锚点取并集，任一在就认（aria-label 会随界面语言变，data-* 属性不会）。
      _power: function () {
        return [...document.querySelectorAll('[role="menuitem"]')].find((x) => {
          if (!/^(power|强度|力度)$/i.test(x.getAttribute("aria-label") || "") &&
              !x.querySelector("[data-model-reasoning-effort-slider]")) return false;
          const info = this._modelInfo(x);
          return info.visible && !info.disabled;
        }) || null;
      },
      // 档位真值只认位次「now/min/max」，不认档名：0–3 档的档名不在 DOM 里（只有 describedby 的
      // 一行朗读文本给出当前档），拿标签判档一改版就漂。滑块读不出时回退解析 `Pro, 5 of 5.`。
      _level: function () {
        const p = this._power();
        if (!p) return null;
        const sl = p.querySelector('[role="slider"]');
        if (sl) {
          const raw = ["aria-valuenow", "aria-valuemin", "aria-valuemax"].map(name => sl.getAttribute(name));
          const [now, min, max] = raw.map(Number);
          if (raw.every(value => value != null && value.trim() !== "") &&
              [now, min, max].every(Number.isFinite) && max > min && now >= min && now <= max) return { now, min, max };
        }
        const m = /(\d+)\s*(?:of|\/|共)\s*(\d+)/i.exec(this._describe(p));
        return m && +m[2] > 1 && +m[1] >= 1 && +m[1] <= +m[2]
          ? { now: +m[1] - 1, min: 0, max: +m[2] - 1 } : null;
      },
      _describe: function (el) {
        return (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
          .map((id) => { const e = document.getElementById(id); return e ? (e.textContent || "").replace(/\s+/g, " ").trim() : ""; })
          .join(" ");
      },
      // top=true 取最高档，否则最低档；不写死标签，自适应加减档。
      // 键盘驱动：站点自己在 Power 项上声明 aria-keyshortcuts="ArrowLeft ArrowRight"；
      // **End/Home 真机无效**（2026-08-31 实测：值纹丝不动），只能逐格按，端点会饱和不越界。
      _pickEdge: async function (top, deadline) {
        try {
          checkDeadline(deadline);
          await this._openRoot(deadline);
          let lv = this._level();
          if (!lv) { escMenus(); throw new Error("ChatGPT: 档位滑块未找到"); }
          const key = top ? "ArrowRight" : "ArrowLeft", goal = top ? lv.max : lv.min;
          for (let i = 0; i <= lv.max - lv.min && lv.now !== goal; i++) {
            const el = this._power(); // 每格重渲染，必须重取节点
            if (!el) break;
            if (el.focus) tierAction(deadline, () => el.focus());
            ["keydown", "keyup"].forEach((type) => tierAction(deadline, () => el.dispatchEvent(
              new KeyboardEvent(type, { key: key, code: key, bubbles: true, cancelable: true, view: window }))));
            await sleep(220, deadline);
            lv = this._level() || lv;
          }
          const ok = lv.now === goal;
          escMenus(); // 收尾：菜单不关会罩住输入框，让随后的注入点空
          if (!ok) throw new Error("ChatGPT: 档位未到端点");
        } finally { escMenus(); }
      },
      // 模型 radio 与滑块同时常驻菜单（Advanced 视图不必展开也在 DOM，真机 2026-08-31）：先直接找，
      // 找不到再点 aria-label="Select model" 入口展开一次。已选中就不点——点了会连带把菜单收掉。
      // GPT-6 已上线 ChatGPT；旧账号尚未灰度时保留已知的 GPT-5.6 Sol。
      _MODELS: [{ model: "GPT-6", aliases: ["GPT-6", "6"] },
        { model: "GPT-5.6 Sol", aliases: ["GPT-5.6 Sol"] }],
      _modelItems: function () {
        const root = document.querySelector('[data-testid="composer-intelligence-picker-content"]') ||
          this._power()?.closest('[role="menu"]');
        return root ? [...root.querySelectorAll('[role="menuitemradio"]')] : [];
      },
      _modelInfo: function (node) {
        const r = node.getBoundingClientRect();
        const style = typeof getComputedStyle === "function" ? getComputedStyle(node) : null;
        return { text: node.innerText != null ? node.innerText : node.textContent,
          visible: r.width > 0 && r.height > 0 && !node.hidden && node.isConnected !== false &&
            (!style || !/hidden|collapse/.test(style.visibility) && style.display !== "none"),
          disabled: !!node.disabled || node.getAttribute("aria-disabled") === "true" ||
            node.getAttribute("data-disabled") != null };
      },
      _matchModel: function (nodes) { return S.matchSelection(nodes, this._MODELS, this._modelInfo); },
      _selectedModel: function () {
        const selected = this._modelItems().filter(node => {
          const info = this._modelInfo(node);
          return info.visible && !info.disabled && node.getAttribute("aria-checked") === "true";
        });
        return selected.length === 1 ? this._matchModel(selected) : null;
      },
      _selectModel: async function (deadline) {
        try {
          checkDeadline(deadline);
          await this._openRoot(deadline);
          let match = this._matchModel(this._modelItems());
          if (!match) {
            const entry = [...document.querySelectorAll('[role="menuitem"]')]
              .find((x) => /^(select model|选择模型)$/i.test(x.getAttribute("aria-label") || ""));
            if (entry) {
              tierAction(deadline, () => entry.click());
              match = await waitFor(() => this._matchModel(this._modelItems()), 1500, 120, deadline);
            }
          }
          if (!match) throw new Error("ChatGPT: 未找到模型");
          if (this._selectedModel()?.model === match.model) return;
          tierAction(deadline, () => match.candidate.click()); await sleep(700, deadline);
          // 模型点击可能关闭菜单；动作路径可重开复读，selection 本身永远只读。
          await this._openRoot(deadline);
          const applied = await waitFor(() => this._selectedModel()?.model === match.model, 1500, 120, deadline);
          if (!applied) throw new Error("ChatGPT: 模型未生效");
        } finally { escMenus(); }
      },
      diagnose: function () {
        return [
          { name: t("diag_intelEntry"), ok: !!this._anchor(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      state: function () {
        const a = this._anchor();
        if (!a || a.getAttribute("aria-expanded") === "true") return null;
        // 新版含 visibility:hidden 的测量副本（Thinking effort），只读可见标签。
        const raw = (a.innerText != null ? a.innerText : a.textContent || "").trim();
        if (!raw || this._OPEN_PILL.test(raw)) return null; // 菜单开着：pill 是控件名，非终态
        if (/^(?:gpt-?)?6[\d.]|^(?:gpt-?)?6\s+(?:sol|astra)/i.test(raw)) return null;
        const t = this._tier(raw);
        if (/instant|medium|极速|即时|均衡|中/i.test(t)) return "fast"; // Instant/Medium
        if (/(?:gpt-?)?5\.[345](?!\d)|\bo3\b/i.test(raw)) return null; // 旧模型高档不能冒充 5.6 think
        if (/high|pro|高/i.test(t)) return "think";             // High/Extra High/Pro（含旧 Standard/Extended）
        return null;
      },
      selection: function (mode) {
        const level = this._level();
        const observed = level ? (level.now === level.max ? "think" : level.now === level.min ? "fast" : null) : this.state();
        if (observed !== mode) return observed ? { outcome: "unconfirmed", observed } : { outcome: "unconfirmed" };
        const match = this._selectedModel();
        // 粗档位不能证明滑块端点；菜单关着读不到模型时仅确认模式，不缓存先前读数。
        return level && match ? { outcome: match.model === this._MODELS[0].model ? "preferred" : "alternative",
          observed, model: match.model } : { outcome: "mode_only", observed };
      },
      // 2026-09 新版用语义 data 属性；限定 assistant 区块，排除用户气泡和思考段。
      // 保留 section[data-turn] 与 data-message-author-role 两种旧布局。
      answer: function () {
        const modern = document.querySelectorAll('[data-content-search-unit-key]:has([data-conversation-role="assistant"]) [data-markdown-text-style="assistant-message"]');
        if (modern.length) return modern[modern.length - 1];
        let els = document.querySelectorAll('[data-turn="assistant"]');
        if (!els.length) els = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".markdown") || el;
      },
      think: async function (deadline) {
        checkDeadline(deadline); await this._selectModel(deadline); await this._pickEdge(true, deadline); },
      fast: async function (deadline) {
        checkDeadline(deadline); await this._selectModel(deadline); await this._pickEdge(false, deadline); },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector("#upload-photos"), files, el, deadline);
      },
      stop: function () {
        const b = document.querySelector('[data-testid="stop-button"]') ||
          [...document.querySelectorAll('button[aria-label]')]
            .find((x) => /stop (answering|streaming|generating)/i.test(x.getAttribute("aria-label") || ""));
        if (b) { clickEl(b); S.toast(t("cs_stopped"), true); }
      },
    },
  });
})();
