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
        if (!t) throw new Error("DeepSeek: DeepThink 开关未找到"); // 开关常驻 composer，缺失即异常（静默 return 会让 runMode 误报成功）
        if ((t.getAttribute("aria-pressed") === "true") !== on) clickEl(t);
        await sleep(300);
      },
      _selectMode: async function (re) {
        // DeepSeek 模式 radio 只认原生 click(拒绝合成事件 isTrusted=false)；选择幂等，原生 click 安全。
        // radio 仅空对话首屏存在，聊天中缺失属正常态 → 静默跳过（档位真值由 DeepThink 开关兜底）
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
          if (!btn) throw new Error("豆包: 模式按钮未找到"); // 静默 return 会让 runMode 误报"已切到"
          if (re.test((btn.textContent || "").trim())) return; // 已是目标，幂等返回
          if (!findByText('[role="menuitem"]', re)) openMenu(btn);
          const item = await waitFor(() => findByText('[role="menuitem"]', re), 1500);
          if (item) { item.click(); await sleep(500); } // 选项 onclick，用原生 click
          escMenus(); await sleep(200);
        }
        throw new Error("豆包: 目标模式未选中");
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
        if (!leaf) { escMenus(); throw new Error("千问: 模型选项未找到"); } // 静默 return 会让 runMode 误报成功
        let c = leaf, clicked = false;
        for (let i = 0; i < 5 && c; i++) {
          if (c.onclick || /option|menuitem/.test(c.getAttribute("role") || "") || c.tagName === "LI") { c.click(); clicked = true; break; }
          c = c.parentElement;
        }
        if (!clicked) leaf.click();
        await sleep(500);
        escMenus();
      },
      _thinkBtn: function () {
        return [...document.querySelectorAll("button")]
          .find((b) => [...b.querySelectorAll("span")].some((x) => /^(思考|Thinking)$/i.test((x.textContent || "").trim())) || /^(思考|Thinking)$/i.test((b.textContent || "").trim()));
      },
      _setThink: async function (on) {
        const b = this._thinkBtn();
        if (!b) throw new Error("千问: 思考按钮未找到"); // 常驻 composer，缺失即异常
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
        if (!e) throw new Error("Kimi: 模型入口未找到"); // 静默 return 会让 runMode 误报成功
        if (!e.classList.contains("active")) e.click();
        const opt = await waitFor(() =>
          [...document.querySelectorAll("*")].find((el) =>
            el.children.length <= 2 && re.test((el.textContent || "").trim()) &&
            (el.textContent || "").trim().length < 20 && !el.closest(".current-model")), 1500);
        if (!opt) { escMenus(); throw new Error("Kimi: 目标选项未找到"); }
        let c = opt, clicked = false;
        for (let i = 0; i < 5 && c; i++) {
          if (c.onclick || /menuitem|option/.test(c.getAttribute("role") || "") || (c.className || "").toString().includes("menu-item")) { c.click(); clicked = true; break; }
          c = c.parentElement;
        }
        if (!clicked) opt.click();
        await sleep(400);
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

    // 智谱清言：思考已从「toggle」改为「触发器 + el-tooltip 弹层菜单」——顶层 快速 / 思考(.has-submenu)，
    // 思考子菜单含 标准 / 深度。映射 think→深度（深度全力推理）、fast→快速。
    // 选档序列（chrome-dbg 实测验证）：hover+click .think-mode-trigger 开弹层；深度还需先 hover 父项
    //（.has-submenu，其名随当前档变故按 class 找）展开子菜单，再原生 click 目标 .item-name 项。
    // state 只读：读 .think-mode-item 的 selected 类（弹层关闭时菜单项仍在 DOM，不开菜单）。
    "chatglm.cn": {
      _trigger: function () { return document.querySelector(".think-mode-trigger"); },
      _hover: function (el) {
        if (!el) return;
        ["pointerenter", "mouseenter", "pointerover", "mouseover"].forEach((e) =>
          el.dispatchEvent(new MouseEvent(e, { bubbles: true, cancelable: true, view: window })));
      },
      _itemByName: function (name) {
        return [...document.querySelectorAll(".think-mode-item:not(.has-submenu)")].find((it) => {
          const n = it.querySelector(".item-name"); return n && (n.textContent || "").trim() === name;
        });
      },
      _selected: function (name) {
        const it = this._itemByName(name);
        return !!it && /(^|\s)selected(\s|$)/.test((it.className || "").toString());
      },
      _pick: async function (name, viaSubmenu) {
        const tg = this._trigger();
        if (!tg) throw new Error("智谱: 思考触发器未找到");
        this._hover(tg); tg.click();                                          // 开 el-tooltip 弹层
        await sleep(350);
        if (viaSubmenu) { this._hover(document.querySelector(".think-mode-item.has-submenu")); await sleep(300); } // 展开子菜单
        const it = this._itemByName(name);
        if (!it) throw new Error("智谱: 档位「" + name + "」未找到");
        it.click(); await sleep(500); escMenus();
      },
      diagnose: function () {
        return [
          { name: t("diag_thinkButton"), ok: !!this._trigger() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () { return this._selected("深度") ? "think" : this._selected("快速") ? "fast" : null; },
      think: async function () { await this._pick("深度", true); },
      fast: async function () { await this._pick("快速", false); },
    },
  });
})();
