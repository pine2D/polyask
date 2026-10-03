// desktop/src/site-runtime/adapters-cn4.js — 国内站点适配器·续（千问）。
// 按站分卷以遵守 300 行上限；selection-match.js 在本卷之前，generation/diag 在本卷之后。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, openMenu, sleep, escMenus, checkDeadline, tierAction } = S;
  Object.assign(S.adapters, {
    // 千问：think=Qwen3.7-千问+思考研究，fast=Qwen3.7-千问+快速；兼容旧版裸思考按钮。
    "qianwen.com": {
      attach: async function (files, el, deadline) {
        if (Date.now() >= deadline) return false;
        const add = document.querySelector('button[aria-label="添加附件"],button[aria-label="Add attachment"],button[aria-label="Add attachments"]');
        if (!add) return false;
        const blockPicker = event => { if (event.target?.matches?.('input[type="file"]')) event.preventDefault(); };
        document.addEventListener("click", blockPicker, true);
        try {
          // Radix 新版要求 PointerEvent.pointerType；通用 MouseEvent 序列不会展开。
          for (const type of ["pointerdown", "pointerup"]) add.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerType: "mouse", button: 0, buttons: type === "pointerdown" ? 1 : 0
          }));
          const item = await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')]
            .find(node => /^(上传图片|上傳圖片|Upload images?)$/i.test((node.textContent || "").trim())), Math.min(1500, Math.max(0, deadline - Date.now())));
          if (!item || Date.now() >= deadline) return false;
          item.click();
          const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image/"]'), Math.min(1500, Math.max(0, deadline - Date.now())));
          if (!input || Date.now() >= deadline) return false;
          return await S.setInputFiles(input, files, el, deadline);
        } finally { document.removeEventListener("click", blockPicker, true); escMenus(); }
      },
      // 模型下拉触发器：aria-haspopup 属性由前端延迟水合，新加载页面一段时间内只有纯文本节点，
      // 先按 aria 找，水合期文字回退限定顶部控件区，不能把聊天正文中的模型名当成入口。
      _trigger: function () {
        const byAria = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => /Qwen3/.test(x.textContent || ""));
        if (byAria) return byAria;
        return [...document.querySelectorAll("div,button,span")].filter((e) => {
          const t = (e.textContent || "").trim();
          return /^Qwen3/.test(t) && t.length <= 25 && e.children.length <= 3 && e.closest(".desktop-no-drag");
        }).pop() || null;
      },
      _MODELS: [{ model: "Qwen3.7-千问", aliases: ["Qwen3.7-千问"] }],
      _candidateInfo: function (node) {
        const r = node.getBoundingClientRect();
        const style = typeof getComputedStyle === "function" ? getComputedStyle(node) : null;
        return { text: node.innerText != null ? node.innerText : node.textContent,
          visible: r.width > 0 && r.height > 0 && !node.hidden && node.isConnected !== false &&
            (!style || !/hidden|collapse/.test(style.visibility) && style.display !== "none"),
          disabled: !!node.disabled || node.getAttribute("aria-disabled") === "true" ||
            node.getAttribute("data-disabled") != null };
      },
      _matchModel: function (nodes) { return S.matchSelection(nodes, this._MODELS, this._candidateInfo); },
      _modelDialog: function (trigger) {
        const usable = node => node && node.getAttribute("role") === "dialog" && this._candidateInfo(node).visible;
        const id = trigger.getAttribute("aria-controls");
        if (id) {
          const controlled = document.getElementById(id);
          return usable(controlled) ? controlled : null;
        }
        const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(dialog => {
          if (!usable(dialog)) return false;
          const labels = (dialog.getAttribute("aria-labelledby") || "").split(/\s+/)
            .filter(Boolean).map(id => document.getElementById(id)).filter(Boolean);
          const headings = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"],header'), ...labels];
          return headings.some(node => /^(选择模型|模型|select model|models?)$/i.test((node.textContent || "").trim()));
        });
        return dialogs.length === 1 ? dialogs[0] : null;
      },
      _modelChoice: function (trigger) {
        const dialog = this._modelDialog(trigger);
        if (!dialog) return null;
        const options = [...dialog.querySelectorAll('li,[role="option"],[role="menuitem"],[role="menuitemradio"]')]
          .map(node => ({ node, label: node }));
        // 2026-09-29 真机：模型卡是 group.cursor-pointer 的 DIV，精确名称在 truncate 叶节点。
        // 卡内另有「设为默认」按钮；只上溯到卡片，不用任意可点击后代替代模型选择。
        for (const label of dialog.querySelectorAll("div.truncate")) {
          if (label.children.length || label.closest("button")) continue;
          const node = label.closest("div.group.cursor-pointer");
          if (node && dialog.contains(node) && !options.some(option => option.node === node)) options.push({ node, label });
        }
        return S.matchSelection(options, this._MODELS, option => {
          const node = this._candidateInfo(option.node), label = this._candidateInfo(option.label);
          return { text: label.text, visible: node.visible && label.visible, disabled: node.disabled || label.disabled };
        });
      },
      _selectModel: async function (deadline) {
        try {
          checkDeadline(deadline);
          const md = this._trigger();
          // 无模型入口的日常页面仅承诺模式；其后的 _setThink 仍须切换并复读确认。
          if (!md && this._modeOnly()) return;
          if (!md) throw new Error("千问模型下拉未就绪");
          if (this._matchModel([md])) return;
          // 原生 click / 单独 PointerEvent 不展开当前菜单；复用已真机确认的通用事件序列。
          // 先收上轮弹层并等关闭动画结束，否则 openMenu 的首轮事件会被旧状态吞掉。
          escMenus(); await sleep(500, deadline);
          tierAction(deadline, () => openMenu(md));
          const match = await waitFor(() => this._modelChoice(md), 3500, 120, deadline);
          if (!match) throw new Error("千问: 模型选项未找到");
          tierAction(deadline, () => match.candidate.node.click());
          await sleep(500, deadline);
          escMenus();
          const after = this._trigger();
          if (!after || !this._matchModel([after])) throw new Error("千问: 模型未生效");
        } finally { escMenus(); }
      },
      _thinkBtn: function () {
        const usable = node => { const info = this._candidateInfo(node); return info.visible && !info.disabled; };
        const menu = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => {
          const label = (b.getAttribute("aria-label") || b.textContent || "").trim();
          return usable(b) && /^(快速|思考研究|Fast|Thinking Research)$/i.test(label);
        });
        if (menu) return menu;
        return [...document.querySelectorAll("button")].filter(usable)
          .find((b) => [...b.querySelectorAll("span")].some((x) => /^(思考|Thinking)$/i.test((x.textContent || "").trim())) || /^(思考|Thinking)$/i.test((b.textContent || "").trim()));
      },
      _isThink: function (b) {
        if (b && b.getAttribute("aria-haspopup") === "menu")
          return /思考研究|Thinking Research/i.test(b.getAttribute("aria-label") || b.textContent || "");
        return !!b && (b.className || "").split(/\s+/).includes("text-theme");
      },
      _modeOnly: function () {
        const daily = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && /^(日常|Daily)$/i.test((e.textContent || "").trim());
        });
        const b = this._thinkBtn();
        return daily && !!S.findComposer() && !!b && b.getAttribute("aria-haspopup") === "menu";
      },
      _setThink: async function (on, deadline) {
        try {
          checkDeadline(deadline);
          const b = this._thinkBtn();
          if (!b) throw new Error("千问: 思考按钮未找到"); // 常驻 composer，缺失即异常
          if (this._isThink(b) === on) return;
          if (b.getAttribute("aria-haspopup") === "menu") {
            tierAction(deadline, () => b.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window, detail: 1, button: 0 })));
            const re = on ? /思考研究|Thinking Research/i : /^快速|^Fast/i;
            const item = await waitFor(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((x) => {
              const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && re.test((x.textContent || "").trim());
            }), 1500, 120, deadline);
            if (!item) { escMenus(); throw new Error("千问: 模式选项未找到"); }
            tierAction(deadline, () => item.click()); await sleep(500, deadline);
            escMenus();
          } else { tierAction(deadline, () => b.click()); await sleep(300, deadline); }
          const after = this._thinkBtn();
          if (!after || this._isThink(after) !== on) { escMenus(); throw new Error("千问: 思考开关未生效"); }
        } finally { escMenus(); }
      },
      diagnose: function () {
        return [
          { name: t("diag_modelDropdown"), ok: !!this._trigger(), kind: !this._trigger() && this._modeOnly() ? "tier" : "control" },
          { name: t("diag_thinkBtn"), ok: !!this._thinkBtn(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      state: function () {
        const m = this._trigger(), b = this._thinkBtn();
        if (!b) return null;
        if (m ? !this._matchModel([m]) : !this._modeOnly()) return null;
        return this._isThink(b) ? "think" : "fast";
      },
      selection: function (mode) {
        const observed = this.state();
        if (observed !== mode) return observed ? { outcome: "unconfirmed", observed } : { outcome: "unconfirmed" };
        const m = this._trigger(), match = m && this._matchModel([m]);
        return match ? { outcome: "preferred", observed, model: match.model } : { outcome: "mode_only", observed };
      },
      think: async function (deadline) {
        checkDeadline(deadline); await this._selectModel(deadline); await this._setThink(true, deadline); },
      fast: async function (deadline) {
        checkDeadline(deadline); await this._selectModel(deadline); await this._setThink(false, deadline); },
      // 动态 input 需可信菜单点击，合成 drop/paste 被忽略（2026-07-23 真机），明确报 unsupported。
      // 最后一条回答（真机审计锚点 2026-07：.answer-common-card，正文在 .qk-markdown）。
      // 思考档思考段也是 .qk-markdown（祖先 thinkingContent-<hash>，CSS-module 后缀会变故用
      // [class*=] 匹配，真机 2026-07-11），过滤后取最后一个，否则思考全文混入汇总。
      answer: function () {
        const cards = document.querySelectorAll(".answer-common-card");
        if (!cards.length) return null;
        const el = cards[cards.length - 1];
        const mds = [...el.querySelectorAll(".qk-markdown")].filter((m) => !m.closest('[class*="thinkingContent"]'));
        // 只有思考段时返回 null，不退回含思考全文的整张卡（同 Kimi）；空占位卡仍返回卡本身
        return mds[mds.length - 1] || (el.querySelector('[class*="thinkingContent"]') ? null : el);
      },
    },
  });
})();
