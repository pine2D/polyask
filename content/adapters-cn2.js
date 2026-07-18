// content/adapters-cn2.js — 国内站点适配器·续（Kimi/元宝/智谱清言）。
// adapters-cn.js 触及 300 行上限后按站拆分；契约与注意事项同 adapters-cn.js / CLAUDE.md。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    // Kimi：K3 有 Standard/High/Max 思考强度；think=K3 Max，fast=K2.6（chrome-dbg 实测 2026-07-17）。
    // 模型菜单原生 click；Thinking effort 子菜单需 hover 展开后再点 Max。
    "kimi.com": {
      _entry: function () { return document.querySelector(".current-model"); },
      _model: function () {
        const n = this._entry() && this._entry().querySelector(".name");
        return n ? (n.textContent || "").trim() : "";
      },
      _isMax: function () {
        const n = this._entry() && this._entry().querySelector(".current-effort");
        return !!n && /^(Max|最大|最高|最强)$/i.test((n.textContent || "").trim());
      },
      _select: async function (name) {
        const e = this._entry();
        if (!e) throw new Error("Kimi: 模型入口未找到"); // 静默 return 会让 runMode 误报成功
        if (!e.classList.contains("active")) e.click();
        const opt = await waitFor(() => [...document.querySelectorAll(".model-item")].find((el) => {
          const n = el.querySelector(".name");
          return n && (n.textContent || "").trim() === name;
        }), 1500);
        if (!opt) { escMenus(); throw new Error("Kimi: 目标选项未找到"); }
        opt.click();
        await sleep(400);
        escMenus();
      },
      _max: async function () {
        if (this._isMax()) return;
        const e = this._entry();
        if (!e) throw new Error("Kimi: 模型入口未找到");
        if (!e.classList.contains("active")) e.click();
        const row = await waitFor(() => [...document.querySelectorAll(".effort-item")].find((el) =>
          /Thinking|思考|推理/i.test((el.querySelector(".effort-title") || {}).textContent || "")), 1500);
        if (!row) { escMenus(); throw new Error("Kimi: 思考强度入口未找到"); }
        ["pointerenter", "mouseenter", "pointerover", "mouseover"].forEach((type) =>
          row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
        const opt = await waitFor(() => [...document.querySelectorAll(".effort-option")].find((el) =>
          /^(Max|最大|最高|最强)$/i.test(((el.querySelector(".effort-name") || {}).textContent || "").trim())), 1500);
        if (!opt) { escMenus(); throw new Error("Kimi: Max 思考强度未找到"); }
        opt.click();
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
        const model = this._model();
        return model === "K3" && this._isMax() ? "think" : model === "K2.6" ? "fast" : null;
      },
      think: async function () { if (this._model() !== "K3") await this._select("K3"); await this._max(); },
      fast: async function () { if (this._model() !== "K2.6") await this._select("K2.6"); },
      // 发送键是无 role 的 div（真机审计 2026-07），Enter 只插换行 → 原生点它；没找到落回通用路径由校验循环兜底
      submit: function () {
        const b = document.querySelector(".send-button-container");
        if (!b) return false;
        b.click();
      },
      // 最后一条回答（真机审计锚点 2026-07：.chat-content-item-assistant，正文在 .markdown）。
      // Thinking 档思考段也是 .markdown（祖先 .thinking-container，真机 2026-07-11），querySelector
      // 会取到思考全文淹没正文——须过滤后取最后一个（同 DeepSeek/元宝的排除模式）。
      answer: function () {
        const els = document.querySelectorAll(".chat-content-item-assistant");
        if (!els.length) return null;
        const el = els[els.length - 1];
        const mds = [...el.querySelectorAll(".markdown")].filter((m) => !m.closest(".thinking-container"));
        return mds[mds.length - 1] || el;
      },
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
      // 最后一条回答（chrome-dbg 真机审计 2026-07：AI 回答在 .agent-chat__conv--ai__speech_show，
      // 正文 .hyc-common-markdown，需排除深度思考段 .hyc-component-deepsearch-cot__think 内的同类节点）
      answer: function () {
        const els = document.querySelectorAll(".agent-chat__conv--ai__speech_show");
        if (!els.length) return null;
        const host = els[els.length - 1];
        const mds = [...host.querySelectorAll(".hyc-common-markdown")].filter((m) => !m.closest('[class*="cot__think"]'));
        const pick = mds[mds.length - 1] || host;
        return pick;
      },
      // 发送键是 icon-font span（chrome-dbg 真机审计 2026-07：点击后 composer 清空实证可发）；
      // 没找到落回 Enter+校验兜底。注入侧真机实证：元宝 beforeinput 不生效、execCommand 生效（既有回退链覆盖）
      submit: function () {
        const b = document.querySelector(".icon-send");
        if (!b) return false;
        b.click();
      },
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
      // 最后一条回答（真机审计锚点 2026-07：.answer-content；排除隐藏思考段后取末尾正文）
      answer: function () {
        const els = document.querySelectorAll(".answer-content");
        if (!els.length) return null;
        const el = els[els.length - 1];
        const mds = [...el.querySelectorAll(".markdown-body")]
          .filter((m) => !m.closest(".text-advance-thinking-content"));
        return mds[mds.length - 1] || el;
      },
    },
  });
})();
