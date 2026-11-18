// desktop/src/site-runtime/adapters-intl3.js — 国际站点适配器·续（Gemini）。
// 按站分卷以遵守 300 行上限；思考等级须复读，所有菜单动作自行收尾。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, openMenu, clickEl, sleep, escMenus, checkDeadline, tierAction } = S;
  const levelModels = [/^4\s+argon(?:\s|$)/i, /^4\s+hydrogen(?:\s|$)/i];
  Object.assign(S.adapters, {
    "gemini.google.com": {
      attach: async function (files, el, deadline) {
        if (Date.now() >= deadline) return false;
        // 当前媒体入口同时声明 image/*,video/*；相机与文档入口不能接管图片。
        const findInput = () => [...document.querySelectorAll('input[type="file"]:not([capture]):not(:disabled)')]
          .find(node => (node.getAttribute('accept') || '').toLowerCase().split(',').some(type => type.trim() === 'image/*')) || null;
        const add = [...document.querySelectorAll("button")].find(node =>
          /upload.*tools|上传.*工具|上傳.*工具|添加文件/i.test(node.getAttribute("aria-label") || ""));
        let input = findInput();
        try {
          if (!input) {
            if (!add) return "attachment_action_required";
            if (add.getAttribute('aria-expanded') !== 'true') add.click();
            try { input = await waitFor(findInput, 1500, 120, deadline); }
            catch (error) {
              // 保留 uploadImages 的超时码；其它等待故障仍按上传失败处理。
              if (error?.message === 'timeout' && Date.now() >= deadline) return false;
              throw error;
            }
          }
          if (!input || Date.now() >= deadline) return false;
          return await S.setInputFiles(input, files, el, deadline);
        } finally {
          escMenus();
          // Gemini 的 Escape 可能不收菜单；仅切回仍展开的上传触发器。
          if (add?.getAttribute('aria-expanded') === 'true') add.click();
        }
      },
      _MI: "button.mat-mdc-menu-item, [role=menuitem], [role=menuitemradio]",
      // 只认可见项：页面常驻隐藏的导出菜单（`gv-pm-saved-export-menu gv-hidden` 的 JSON/Markdown 也是
      // [role=menuitem]），拿它当「菜单已展开」会让模型按钮永远不被点开（真机 2026-08-14）。
      _items: function () { return [...document.querySelectorAll(this._MI)]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); },
      _find: function (re) { return this._items().find((el) => re.test((el.textContent || "").trim())) || null; },
      // 新菜单把用途放在 label、模型名放在 sublabel；旧菜单顺序相反。
      // 内置推荐只在这两处文本中辨认版本开头的模型名，不依赖用途说明。
      _modelLabel: function (el) {
        const labels = [".label", ".sublabel"].map(selector => (el.querySelector?.(selector)?.textContent || "").trim());
        const models = labels.filter(text => /^\d+(?:\.\d+)*\s+\S/.test(text));
        if (models.length > 1) throw new Error("Gemini: 模型标签歧义");
        return models[0] || labels[0] || (el.textContent || "").trim();
      },
      _modelBtn: function () { return [...document.querySelectorAll("button")]
        .find((b) => /mode picker/i.test(b.getAttribute("aria-label") || "")) ||
        document.querySelector('button[class*="input-area-swi"]'); },
      _openModelMenu: async function (deadline) {
        checkDeadline(deadline);
        const btn = this._modelBtn();
        if (!btn) throw new Error("Gemini: 模型按钮未找到");
        if (btn.getAttribute("aria-expanded") !== "true" || !this._items().length) tierAction(deadline, () => openMenu(btn));
        let ok = await waitFor(() => this._items().length, 1500, 120, deadline);
        if (!ok) { tierAction(deadline, () => openMenu(btn)); ok = await waitFor(() => this._items().length, 3500, 120, deadline); }
        if (!ok) throw new Error("Gemini: 模型菜单未展开");
      },
      // 收尾：**escMenus 对 Gemini 无效**（真机 2026-08-31：Escape 与点 cdk backdrop 都关不掉，
      // aria-expanded 一直是 true），只有再点一次触发器才收 → 先 Escape 再兜底点触发器。
      // 菜单不关会罩住输入框，让随后的注入点空。
      _close: async function (deadline) {
        // 清理允许到期后关闭已开的菜单；不选项、不启动新等待。
        escMenus();
        if (!this._items().length) return;
        if (!deadline || Date.now() < deadline) await sleep(Math.min(250, Math.max(0, (deadline || Infinity) - Date.now())));
        if (!this._items().length) return;
        clickEl(this._modelBtn()); if (!deadline || Date.now() < deadline) await sleep(Math.min(300, Math.max(0, (deadline || Infinity) - Date.now())));
      },
      _selectModel: async function (re, deadline) {
        try {
          checkDeadline(deadline);
          await this._openModelMenu(deadline);
          const patterns = Array.isArray(re) ? re : [re];
          const match = await waitFor(() => {
            for (const pattern of patterns) {
              const matches = this._items().filter(el => pattern.test(this._modelLabel(el)));
              if (!matches.length) continue;
              const el = matches[0];
              return { el, invalid: matches.length !== 1 || el.disabled || el.getAttribute("aria-disabled") === "true" };
            }
            return null;
          }, 3500, 120, deadline);
          if (!match) { await this._close(deadline); throw new Error("Gemini: 未找到模型 " + re); }
          // waitFor 会捕获回调异常；校验在外面做，禁用/歧义立即失败且不退选 Pro。
          if (match.invalid) throw new Error("Gemini: 模型不可用或选项歧义");
          const item = match.el;
          const model = this._modelLabel(item);
          tierAction(deadline, () => clickEl(item)); await sleep(700, deadline); await this._close(deadline); // 收尾：不依赖后续 _setThinking 替它关菜单
          return model;
        } finally { await this._close(deadline); }
      },
      _selected: function (el) { return el.classList.contains("selected") || el.getAttribute("aria-checked") === "true"; },
      _openLevel: async function (re, deadline, required, allowLegacy = false) {
        const trig = await waitFor(() => this._find(/thinking level|思考(等级|程度)?/i), 3500, 120, deadline);
        if (!trig && required) throw new Error("Gemini: 思考等级入口未找到");
        if (!trig) return null; // Pro 旧布局可没有等级菜单。
        const patterns = Array.isArray(re) ? re : [re];
        const inLevelMenu = node => {
          if (trig.contains?.(node)) return true;
          const menu = node.closest?.('[role="menu"]');
          return !!trig.id && (menu?.getAttribute("aria-labelledby") || "").split(/\s+/).includes(trig.id);
        };
        const findLevel = () => {
          for (const pattern of patterns) {
            const el = this._items().find(node => {
              const text = (node.textContent || "").trim();
              // 入口后代或明确关联的旧浮层；同 role 的其它菜单不得当等级证据。
              return pattern.test(text) && inLevelMenu(node);
            });
            if (el) return el;
          }
          return null;
        };
        let lvl = null;
        for (let i = 0; i < 6 && !lvl; i++) {
          if (!findLevel()) tierAction(deadline, () => openMenu(trig));
          lvl = await waitFor(findLevel, 600, 120, deadline);
          // 旧嵌套 Standard/Extended 同样有等级入口，不能误当缺 Low 的新版。
          const labels = this._items().filter(inLevelMenu).map(el => (el.textContent || "").trim());
          if (!lvl && allowLegacy && labels.some(text => /^(extended|扩展)/i.test(text)) &&
            !labels.some(text => /^(low\b|medium\b|high\b|低|中|高)/i.test(text))) return null;
        }
        if (!lvl) throw new Error("Gemini: 思考等级选项未找到");
        if (lvl.disabled || lvl.getAttribute("aria-disabled") === "true") throw new Error("Gemini: 思考等级不可用");
        return lvl;
      },
      // 旧 Extended 是直达开关；新版跨模型记忆 Low/Medium/High，快档必须重置 Low。
      _setThinking: async function (re, on = true, deadline, expectedModel) {
        const confirmModel = () => {
          if (!expectedModel) return;
          const rows = this._items().filter(el => expectedModel.test(this._modelLabel(el)));
          if (rows.length !== 1 || !this._selected(rows[0])) throw new Error("Gemini: 模型未生效");
        };
        try {
          checkDeadline(deadline);
          await this._openModelMenu(deadline);
          confirmModel();
          let required = !!expectedModel;
          const directRe = Array.isArray(re) ? re[0] : re;
          const direct = required ? null : this._items().find(el => {
            const text = (el.textContent || "").trim();
            return directRe.test(text) && /^(extended thinking\b|extended$|扩展思考(?:\s|$)|扩展$)/i.test(text);
          });
          if (direct) {
            const active = this._selected(direct);
            if (active !== on) tierAction(deadline, () => clickEl(direct));
            await sleep(400, deadline); await this._close(deadline); return;
          }
          if (!on) {
            if (!this._find(/thinking level|思考(等级|程度)?/i)) return;
            re = /^(low\b|低)/i; required = true;
          }
          const lvl = await this._openLevel(re, deadline, required, !on);
          if (!lvl) return;
          if (!this._selected(lvl)) {
            if (lvl.focus) tierAction(deadline, () => lvl.focus());
            tierAction(deadline, () => lvl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
            tierAction(deadline, () => clickEl(lvl));
          }
          await sleep(400, deadline); await this._close(deadline);
          // Low 的闭合标签省略等级，不能仅靠标签证明；重开真实子菜单复读 selected。
          if (required || /^(high\b|高)/i.test((lvl.textContent || "").trim())) {
            await this._openModelMenu(deadline);
            confirmModel();
            const applied = await this._openLevel(re, deadline, true);
            if (!this._selected(applied)) throw new Error("Gemini: 思考等级未生效");
          }
        } finally { await this._close(deadline); }
      },
      diagnose: function () {
        return [
          { name: t("diag_modelEntry"), ok: !!this._modelBtn(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      // 明确显示等级才判档；这三个模型的 Low 均可能在闭合按钮上省略。
      // 实际等级确认由本次动作复读子菜单并回传，state 始终只读、不开菜单。
      state: function () {
        const t = this._modelBtn()?.getAttribute("aria-label") || "";
        if (/\b(?:argon|carbon|hydrogen)(?:\s|$)/i.test(t)) {
          const low = /\blow\b|低/i.test(t), high = /\bhigh\b|高/i.test(t);
          return low !== high ? (low ? "fast" : "think") : null;
        }
        return /flash/i.test(t) ? "fast" : (/\bpro\b|extended|扩展/i.test(t) ? "think" : null);
      },
      // 最后一条回答（真机审计锚点 2026-07：每条回答一个 <message-content>，正文在 .markdown）
      answer: function () {
        const els = document.querySelectorAll("message-content");
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".markdown") || el;
      },
      // 保留两档的 Argon 首选；缺席时用 Hydrogen 同一等级，再兼容旧 Pro/Flash 菜单。
      _setTier: async function (mode, deadline) {
        checkDeadline(deadline);
        const think = mode === "think", high = /^(high\b|高)/i, extended = /^(extended|扩展)/i;
        const legacy = think ? /\b\d+(?:\.\d+)?\s*pro\b/i : /\b\d+(?:\.\d+)?\s*flash\b(?!\s*-?\s*lite)/i;
        const label = await this._selectModel([...levelModels, legacy], deadline);
        const modern = levelModels.find(pattern => pattern.test(label));
        if (modern) {
          await this._setThinking(think ? high : /^(low\b|低)/i, true, deadline, modern);
          return { outcome: "mode_only", observed: mode };
        }
        await this._setThinking(think ? [extended, high] : extended, think, deadline);
      },
      think: function (deadline) { return this._setTier("think", deadline); },
      fast: function (deadline) { return this._setTier("fast", deadline); },
    },

  });
})();
