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
      _label: function () {
        const e = document.querySelector('[data-testid="model-selector-dropdown"]');
        return e ? (e.getAttribute("aria-label") || "") : "";
      },
      // 嵌入态被官方锁 haiku 的识别（同步）：① 确在 iframe（独立标签恒 false）；
      // ② 模型入口显示原始兜底 id（正常 UI 只显示友好名，绝不显示 api id）——claude 官方嵌入门，无干净绕过
      _isEmbedLocked: function () {
        try { return window.self !== window.top && /haiku-latest|3-5-haiku/i.test(this._label()); }
        catch (e) { return false; }
      },
      diagnose: function () {
        if (this._isEmbedLocked())
          return [{ name: "iframe 受限：仅 haiku（claude 官方嵌入门，请在独立标签使用）", ok: false }];
        return [
          { name: "模型入口", ok: !!document.querySelector('[data-testid="model-selector-dropdown"]') },
          { name: "模型可读", ok: /opus|sonnet|haiku|fable/i.test(this._label()) },
        ];
      },
      // think/fast 同为 Opus（Sonnet 已被灰度收进 More models 子菜单，不再依赖），
      // 档位按 thinking/effort 后缀判：Adaptive/Max/Extra=think；Low/无后缀=fast；High/Medium 不判
      state: function () {
        if (this._isEmbedLocked()) return null; // 受限态：不谎报 "fast"，HUD 不亮琥珀
        const t = this._label();
        if (!t) return null;
        if (/sonnet|haiku/i.test(t)) return "fast";
        if (!/opus/i.test(t)) return null;
        if (/adaptive|max|extra/i.test(t)) return "think";
        if (/\blow\b|低/i.test(t)) return "fast";
        if (/opus\s*[\d.]+$/i.test(t.trim())) return "fast"; // 窄屏思考关：无后缀
        return null;
      },
      think: async function () {
        if (this._isEmbedLocked()) throw new Error("Claude 在 iframe 中被官方限制为 haiku，档位不可切换（请在独立标签使用）");
        await this._selectModel(/opus\s*4\.8/i); await this._setThinking(true);
      },
      // fast = Opus 4.8 + 关思考（窄屏关 Adaptive 开关；宽屏 effort 取 Low）——零子菜单导航
      fast: async function () {
        if (this._isEmbedLocked()) throw new Error("Claude 在 iframe 中被官方限制为 haiku，档位不可切换（请在独立标签使用）");
        await this._selectModel(/opus\s*4\.8/i); await this._setThinking(false);
      },
    },

    "chatgpt.com": {
      // 档位标签集：5 档英文 + 中文（均已确认）：极速/均衡/高级/超高/Pro 扩展
      _LABELS: /^(instant|medium|high|extra\s*high|pro\s*extended|极速|均衡|高级|超高|pro\s*扩展)$/i,
      // 锚点：composer pill（实测精确 1 个）优先，再回退任意 haspopup=menu；文本须属档位标签集（^锚定，避免误中侧栏标题）
      _anchor: function () {
        return [...document.querySelectorAll(
            'button.__composer-pill[aria-haspopup="menu"], button[aria-haspopup="menu"]')]
          .find((x) => this._LABELS.test((x.textContent || "").trim()));
      },
      _radios: function () {
        const wrap = document.querySelector("[data-radix-popper-content-wrapper]") || document;
        return [...wrap.querySelectorAll('[role="menuitemradio"]')];
      },
      // 打开档位菜单，返回 radio 列表（DOM 升序：极速…Pro 扩展）
      _openEffort: async function () {
        const anchor = this._anchor();
        if (!anchor) throw new Error("ChatGPT: Intelligence 按钮未找到");
        if (!this._radios().length) openMenu(anchor);
        let rs = await waitFor(() => { const r = this._radios(); return r.length ? r : null; }, 1500);
        if (!rs) { openMenu(anchor); rs = await waitFor(() => { const r = this._radios(); return r.length ? r : null; }); }
        if (!rs) { escMenus(); throw new Error("ChatGPT: 档位菜单未展开"); }
        return rs;
      },
      // top=true 取最高档（末位），否则最低档（首位）；不写死标签，自适应加减档
      _pickEdge: async function (top) {
        const rs = await this._openEffort();
        const item = top ? rs[rs.length - 1] : rs[0];
        if (!item) { escMenus(); throw new Error("ChatGPT: 档位为空"); }
        clickEl(item); await sleep(400);
      },
      diagnose: function () {
        return [
          { name: "Intelligence 入口", ok: !!this._anchor() },
          { name: "档位可读", ok: this.state() != null },
        ];
      },
      state: function () {
        const a = this._anchor();
        const t = a ? (a.textContent || "").trim() : "";
        if (/high|extended|高|扩展/i.test(t)) return "think";   // High/Extra High/Pro Extended·高级/超高/Pro 扩展
        if (/instant|medium|极速|均衡/i.test(t)) return "fast";  // Instant/Medium·极速/均衡
        return null;
      },
      think: async function () { await this._pickEdge(true); },   // 菜单最高档
      fast: async function () { await this._pickEdge(false); },   // 菜单最低档 = Instant/极速
      stop: function () {
        const b = document.querySelector('[data-testid="stop-button"]') ||
          [...document.querySelectorAll('button[aria-label]')]
            .find((x) => /stop (answering|streaming|generating)/i.test(x.getAttribute("aria-label") || ""));
        if (b) { clickEl(b); S.toast("已停止", true); }
      },
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
      diagnose: function () {
        return [
          { name: "模型入口", ok: !!this._modelBtn() },
          { name: "档位可读", ok: this.state() != null },
        ];
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
