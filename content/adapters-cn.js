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
          { name: t("diag_deepThink"), ok: !!this._deepThink() },
          { name: t("diag_modeSelect"), ok: document.querySelectorAll('[role="radio"]').length > 0 },
          { name: t("diag_tierReadable"), ok: this.state() != null },
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
          { name: t("diag_modeBtn"), ok: !!this._modeBtn() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
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
      // 模型下拉触发器：aria-haspopup 属性由前端延迟水合，新加载页面一段时间内只有纯文本节点，
      // 先按 aria 找，找不到退回按可见文本找最内层节点（click 冒泡可达真正持有 handler 的祖先）
      _trigger: function () {
        const byAria = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => /Qwen3/.test(x.textContent || ""));
        if (byAria) return byAria;
        return [...document.querySelectorAll("div,button,span")].filter((e) => {
          const t = (e.textContent || "").trim();
          return /^Qwen3/.test(t) && t.length <= 25 && e.children.length <= 3; // 只读 state() 不需可见性判定
        }).pop() || null;
      },
      _selectModel: async function (re) {
        const md = this._trigger();
        if (!md) throw new Error("千问模型下拉未就绪");
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
        return [
          { name: t("diag_modelDropdown"), ok: !!this._trigger() },
          { name: t("diag_thinkBtn"), ok: !!this._thinkBtn() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () {
        const m = this._trigger();
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
          { name: t("diag_modelEntry"), ok: !!document.querySelector(".current-model") },
          { name: t("diag_tierReadable"), ok: this.state() != null },
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

    // 元宝：composer 的 Deep Thinking/深度思考 为 toggle（CSS-module 类 ThinkSelector_selected=开），原生 click
    "yuanbao.tencent.com": {
      _toggle: function () { return document.querySelector('[class*="ThinkSelector"]'); },
      _isOn: function () {
        const t = this._toggle();
        return !!t && /ThinkSelector_selected/.test((t.className || "").toString());
      },
      _set: async function (on) {
        const t = this._toggle();
        if (!t) throw new Error("元宝: Deep Thinking 控件未找到");
        if (this._isOn() !== on) { t.click(); await sleep(500); }
      },
      diagnose: function () {
        return [
          { name: t("diag_deepThinking"), ok: !!this._toggle() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () { return this._toggle() ? (this._isOn() ? "think" : "fast") : null; },
      think: async function () { await this._set(true); },
      fast: async function () { await this._set(false); },
    },

    // 智谱清言：composer 的「思考」mode-button 为 toggle（selected 类=开），原生 click
    "chatglm.cn": {
      _btn: function () {
        return [...document.querySelectorAll(".mode-button, [class*=mode-button]")]
          .find((x) => /思考|Thinking/i.test((x.textContent || "").trim()));
      },
      _isOn: function () {
        const b = this._btn();
        return !!b && /(^|\s)selected(\s|$)/.test((b.className || "").toString());
      },
      _set: async function (on) {
        const b = this._btn();
        if (!b) throw new Error("智谱: 思考按钮未找到");
        if (this._isOn() !== on) { b.click(); await sleep(500); }
      },
      diagnose: function () {
        return [
          { name: t("diag_thinkButton"), ok: !!this._btn() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () { return this._btn() ? (this._isOn() ? "think" : "fast") : null; },
      think: async function () { await this._set(true); },
      fast: async function () { await this._set(false); },
    },
  });
})();
