// content/adapters-intl.js — 国际站点适配器（Claude/ChatGPT/Gemini）
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    "claude.ai": {
      _open: async function () {
        const trig = document.querySelector('[data-testid="model-selector-dropdown"]');
        if (!trig) throw new Error("Claude: 模型按钮未找到");
        if (!document.querySelector('[role="menuitemradio"]')) openMenu(trig);
        let ok = await waitFor(() => document.querySelector('[role="menuitemradio"]'), 1500);
        if (!ok) { openMenu(trig); ok = await waitFor(() => document.querySelector('[role="menuitemradio"]')); }
        if (!ok) throw new Error("Claude: 模型菜单未展开");
      },
      _selectModel: async function (re) {
        await this._open();
        const item = await waitFor(() => findByText('[role="menuitemradio"]', re));
        if (!item) { escMenus(); throw new Error("Claude: 未找到模型 " + re); }
        clickEl(item); await sleep(700);
      },
      // 兼容两布局：窄屏 Adaptive thinking [role=switch]；宽屏 effort 子菜单
      _setThinking: async function (on) {
        await this._open();
        const sw = [...document.querySelectorAll('[role="switch"]')]
          .find((s) => /thinking|思考/i.test((s.getAttribute("aria-label") || "") +
            (s.closest('[role="menuitem"]') ? s.closest('[role="menuitem"]').textContent : "")));
        if (sw) {
          if ((sw.getAttribute("aria-checked") === "true") !== on) clickEl(sw);
          await sleep(300); escMenus(); return;
        }
        const trig = document.querySelector('[data-testid="effort-menu-trigger"]');
        if (trig) {
          openMenu(trig);
          const lvl = await waitFor(() => findByText('[role="menuitemradio"]', on ? /max|最大/i : /^(low|低)/i));
          if (lvl) clickEl(lvl);
          await sleep(300); escMenus(); return;
        }
        escMenus();
      },
      state: function () {
        const e = document.querySelector('[data-testid="model-selector-dropdown"]');
        const t = e ? e.getAttribute("aria-label") || "" : "";
        return /opus/i.test(t) ? "think" : /sonnet|haiku/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectModel(/opus\s*4\.8/i); await this._setThinking(true); },
      fast: async function () { await this._selectModel(/sonnet/i); await this._setThinking(false); },
    },

    "chatgpt.com": {
      _select: async function (re) {
        const anchor = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
          .find((x) => /^(Instant|Medium|High|即时|中等|高)$/i.test((x.textContent || "").trim()));
        if (!anchor) throw new Error("ChatGPT: Intelligence 按钮未找到");
        const probe = () => {
          const wrap = document.querySelector("[data-radix-popper-content-wrapper]") || document;
          return findByText('[role="menuitemradio"]', re, wrap);
        };
        if (!probe()) openMenu(anchor);
        let item = await waitFor(probe, 1500);
        if (!item) { openMenu(anchor); item = await waitFor(probe); }
        if (!item) { escMenus(); throw new Error("ChatGPT: 未找到档位 " + re); }
        clickEl(item); await sleep(400);
      },
      state: function () {
        const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
          .find((x) => /^(Instant|Medium|High|即时|中等|高)$/i.test((x.textContent || "").trim()));
        const t = b ? b.textContent.trim() : "";
        return /high|高/i.test(t) ? "think" : /medium|instant|中等|即时/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._select(/^(high|高)$/i); },
      fast: async function () { await this._select(/^(medium|中等)$/i); },
    },

    "gemini.google.com": {
      _MI: "button.mat-mdc-menu-item, [role=menuitem]",
      _modelBtn: function () {
        return [...document.querySelectorAll("button")]
          .find((b) => /mode picker/i.test(b.getAttribute("aria-label") || ""))
          || document.querySelector('button[class*="input-area-swi"]');
      },
      _openModelMenu: async function () {
        const btn = this._modelBtn();
        if (!btn) throw new Error("Gemini: 模型按钮未找到");
        if (!document.querySelector(this._MI)) openMenu(btn);
        let ok = await waitFor(() => document.querySelector(this._MI), 1500);
        if (!ok) { openMenu(btn); ok = await waitFor(() => document.querySelector(this._MI)); }
        if (!ok) throw new Error("Gemini: 模型菜单未展开");
      },
      _selectModel: async function (re) {
        await this._openModelMenu();
        const item = await waitFor(() => findByText(this._MI, re));
        if (!item) { escMenus(); throw new Error("Gemini: 未找到模型 " + re); }
        clickEl(item); await sleep(700);
      },
      // Material 嵌套子菜单不稳：仅在子菜单项未出现时点 trigger，轮询重试，Enter+click 提交
      _setThinking: async function (re) {
        await this._openModelMenu();
        const trig = await waitFor(() => findByText(this._MI, /thinking level|思考(等级|程度)?/i));
        if (!trig) { escMenus(); return; }
        let lvl = null;
        for (let i = 0; i < 6 && !lvl; i++) {
          if (!findByText(this._MI, re)) openMenu(trig);
          lvl = await waitFor(() => findByText(this._MI, re), 600);
        }
        if (!lvl) { escMenus(); return; }
        if (lvl.focus) lvl.focus();
        lvl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        clickEl(lvl); await sleep(400); escMenus();
      },
      state: function () {
        const b = this._modelBtn();
        const t = b ? b.getAttribute("aria-label") || "" : "";
        return /pro/i.test(t) ? "think" : /flash/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectModel(/3\.1\s*pro\b/i); await this._setThinking(/^extended/i); },
      fast: async function () { await this._selectModel(/3\.5\s*flash\b/i); },
    },

    // DeepSeek：模式 tab(Instant/Expert/Vision，空对话首屏) + DeepThink 开关(ds-toggle-button, aria-pressed)
  });
})();
