// content/adapters-cn.js — 国内站点适配器（DeepSeek/豆包/千问/Kimi）
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
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
      diagnose: function () {
        return [
          { name: "DeepThink 开关", ok: !!this._deepThink() },
          { name: "模式选择", ok: document.querySelectorAll('[role="radio"]').length > 0 },
          { name: "档位可读", ok: this.state() != null },
        ];
      },
      state: function () {
        const r = [...document.querySelectorAll('[role="radio"]')]
          .find((x) => x.getAttribute("aria-checked") === "true");
        const t = r ? r.textContent || "" : "";
        return /Expert|专家/.test(t) ? "think" : /Instant|快速/.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectMode(/Expert|专家/); await this._setDeepThink(true); },
      fast: async function () { await this._selectMode(/Instant|快速/); await this._setDeepThink(false); },
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
      diagnose: function () {
        return [
          { name: "模式按钮", ok: !!this._modeBtn() },
          { name: "档位可读", ok: this.state() != null },
        ];
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
          .find((b) => [...b.querySelectorAll("span")].some((x) => /^(思考|Thinking)$/i.test((x.textContent || "").trim())) || /^(思考|Thinking)$/i.test((b.textContent || "").trim()));
      },
      _setThink: async function (on) {
        const b = this._thinkBtn();
        if (!b) return;
        const isOn = (b.className || "").split(/\s+/).includes("text-theme");
        if (isOn !== on) { b.click(); await sleep(300); }
      },
      diagnose: function () {
        const md = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => /Qwen/i.test(x.textContent || ""));
        return [
          { name: "模型下拉", ok: !!md },
          { name: "思考开关", ok: !!this._thinkBtn() },
          { name: "档位可读", ok: this.state() != null },
        ];
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
      diagnose: function () {
        return [
          { name: "模型入口", ok: !!document.querySelector(".current-model") },
          { name: "档位可读", ok: this.state() != null },
        ];
      },
      state: function () {
        const e = document.querySelector(".current-model");
        const t = e ? e.textContent || "" : "";
        return /Thinking|思考/i.test(t) ? "think" : /Instant|快速/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._select(/K2[.\d]*\s*(Thinking|思考)/i); },
      fast: async function () { await this._select(/K2[.\d]*\s*(Instant|快速)/i); },
    },
  });
})();
