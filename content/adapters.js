// content/adapters.js — 各 AI 站点的 think/fast 适配器，注册到 window.__AMS.adapters。
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast，不连累其他站。
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
          .find((s) => /thinking/i.test((s.getAttribute("aria-label") || "") +
            (s.closest('[role="menuitem"]') ? s.closest('[role="menuitem"]').textContent : "")));
        if (sw) {
          if ((sw.getAttribute("aria-checked") === "true") !== on) clickEl(sw);
          await sleep(300); escMenus(); return;
        }
        const trig = document.querySelector('[data-testid="effort-menu-trigger"]');
        if (trig) {
          openMenu(trig);
          const lvl = await waitFor(() => findByText('[role="menuitemradio"]', on ? /max/i : /^low/i));
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
          .find((x) => /^(Instant|Medium|High)$/i.test((x.textContent || "").trim()));
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
          .find((x) => /^(Instant|Medium|High)$/i.test((x.textContent || "").trim()));
        const t = b ? b.textContent.trim() : "";
        return /high/i.test(t) ? "think" : /medium|instant/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._select(/^high$/i); },
      fast: async function () { await this._select(/^medium$/i); },
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
        const trig = await waitFor(() => findByText(this._MI, /thinking level/i));
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
    "deepseek.com": {
      _deepThink: function () {
        return [...document.querySelectorAll(".ds-toggle-button")]
          .find((x) => /deepthink|深度思考/i.test((x.textContent || "").trim()));
      },
      _setDeepThink: async function (on) {
        const t = this._deepThink();
        if (!t) return;
        if ((t.getAttribute("aria-pressed") === "true") !== on) clickEl(t);
        await sleep(300);
      },
      _selectMode: async function (re) {
        // DeepSeek 模式 radio 只认原生 click(拒绝合成事件 isTrusted=false)；选择幂等，原生 click 安全
        const el = findByText('[role="radio"]', re); // Instant / Expert / Vision
        if (el) { el.click(); await sleep(400); }
      },
      state: function () {
        const r = [...document.querySelectorAll('[role="radio"]')]
          .find((x) => x.getAttribute("aria-checked") === "true");
        const t = r ? r.textContent || "" : "";
        return /Expert/.test(t) ? "think" : /Instant/.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectMode(/Expert/); await this._setDeepThink(true); },
      fast: async function () { await this._selectMode(/Instant/); await this._setDeepThink(false); },
    },

    // 豆包：composer 模式按钮(当前显示当前模式)，点开菜单含 快速/专家/超能模式([role=menuitem])
    "doubao.com": {
      _modeBtn: function () {
        return [...document.querySelectorAll("button")]
          .find((x) => { const t = (x.textContent || "").trim(); return /^(快速|专家|超能)/.test(t) && t.length < 14; });
      },
      _select: async function (re) {
        for (let i = 0; i < 3; i++) {
          const btn = this._modeBtn();
          if (!btn) return;
          if (re.test((btn.textContent || "").trim())) return; // 已是目标，幂等返回
          if (!findByText('[role="menuitem"]', re)) openMenu(btn);
          const item = await waitFor(() => findByText('[role="menuitem"]', re), 1500);
          if (item) { item.click(); await sleep(500); } // 选项 onclick，用原生 click
          escMenus(); await sleep(200);
        }
      },
      state: function () {
        const b = this._modeBtn();
        const t = b ? (b.textContent || "").trim() : "";
        return /^专家/.test(t) ? "think" : /^快速/.test(t) ? "fast" : null;
      },
      think: async function () { await this._select(/^专家/); },
      fast: async function () { await this._select(/^快速/); },
    },

    // 千问：模型下拉(aria-haspopup=dialog, 原生 click 开)含 Qwen3.7-Max / Qwen3.7-千问；
    // composer「思考」按钮无 aria-pressed，状态靠 class：text-theme=开 / text-primary=关
    "qianwen.com": {
      _selectModel: async function (re) {
        const md = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => /Qwen3/.test(x.textContent || ""));
        if (!md) return;
        if (!findByText("div,li,span,button", re)) md.click();
        const leaf = await waitFor(() =>
          [...document.querySelectorAll("div,li,span,button")]
            .filter((e) => e.children.length <= 2 && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 26).pop());
        if (leaf) {
          let c = leaf, clicked = false;
          for (let i = 0; i < 5 && c; i++) {
            if (c.onclick || /option|menuitem/.test(c.getAttribute("role") || "") || c.tagName === "LI") { c.click(); clicked = true; break; }
            c = c.parentElement;
          }
          if (!clicked) leaf.click();
          await sleep(500);
        }
        escMenus();
      },
      _thinkBtn: function () {
        return [...document.querySelectorAll("button")]
          .find((b) => [...b.querySelectorAll("span")].some((x) => /^思考$/.test((x.textContent || "").trim())) || /^思考$/.test((b.textContent || "").trim()));
      },
      _setThink: async function (on) {
        const b = this._thinkBtn();
        if (!b) return;
        const isOn = (b.className || "").split(/\s+/).includes("text-theme");
        if (isOn !== on) { b.click(); await sleep(300); }
      },
      state: function () {
        const m = [...document.querySelectorAll('[aria-haspopup="dialog"]')]
          .find((x) => /Qwen/i.test(x.textContent || ""));
        const t = m ? m.textContent || "" : "";
        return /Max/i.test(t) ? "think" : /千问|Flash/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectModel(/Qwen3\.7-Max/i); await this._setThink(true); },
      fast: async function () { await this._selectModel(/Qwen3\.7-千问/); await this._setThink(false); },
    },

    // Kimi：composer .current-model 触发(开菜单时加 active 类)，选项英文 K2.6 Thinking / K2.6 Instant。
    // 用原生 click(合成事件不生效)；选项排除 trigger 本身(同名 K2.6 Instant)。
    "kimi.com": {
      _entry: function () { return document.querySelector(".current-model"); },
      _select: async function (re) {
        const e = this._entry();
        if (!e) return;
        if (!e.classList.contains("active")) e.click();
        const opt = await waitFor(() =>
          [...document.querySelectorAll("*")].find((el) =>
            el.children.length <= 2 && re.test((el.textContent || "").trim()) &&
            (el.textContent || "").trim().length < 20 && !el.closest(".current-model")), 1500);
        if (opt) {
          let c = opt, clicked = false;
          for (let i = 0; i < 5 && c; i++) {
            if (c.onclick || /menuitem|option/.test(c.getAttribute("role") || "") || (c.className || "").toString().includes("menu-item")) { c.click(); clicked = true; break; }
            c = c.parentElement;
          }
          if (!clicked) opt.click();
          await sleep(400);
        }
        escMenus();
      },
      state: function () {
        const e = document.querySelector(".current-model");
        const t = e ? e.textContent || "" : "";
        return /Thinking|思考/i.test(t) ? "think" : /Instant|快速/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._select(/K2\.6\s*Thinking/i); },
      fast: async function () { await this._select(/K2\.6\s*Instant/i); },
    },
  });
})();
