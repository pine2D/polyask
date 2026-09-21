// desktop/src/site-runtime/adapters-cn3.js — 国内站点适配器·三（元宝）。
// adapters-cn2.js 贴着 300 行上限，元宝要加模型子菜单逻辑时按站拆出；契约与注意事项同 adapters-cn.js / CLAUDE.md。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    // 元宝（真机 2026-09-15）：模式菜单 = 「模型/Models」子菜单入口 + 模式项（即时/思考/专家；Hy4 preview 下只剩专家）。
    // think = 模型 Hy4 preview（站点强制专家模式，没有独立的思考项）；fast = 模型 Hy3 + 即时。
    // 新会话默认模型是 Hy4 preview，所以 fast 必须先把模型切回 Hy3，否则「即时」项根本不在菜单里。
    // 旧版 Deep Thinking toggle 作为 A/B 回退。
    "yuanbao.tencent.com": {
      _modeBtn: function () { return document.querySelector('button[aria-label="Switch model"], button[aria-label="切换模型"]'); },
      _mode: function () { const b = this._modeBtn(); return b ? (b.textContent || "").trim() : ""; },
      // 模式标签集。Models 子菜单（Hy4 preview / Hy3 / DeepSeek，真机 2026-08-31）与模式项同为
      // menuitemradio 且同时在 DOM，候选必须过 _isMode 才允许点——否则档位会被点成模型
      // （同 ChatGPT 2026-08 那次事故；DeepSeek 那项的描述里就带「deep thinking」字样）。
      _MODES: /^(thinking|instant|expert|思考|深度思考|即时|快速|专家)/i,
      // 两层语义校验，缺一不可：① 模型列表那层菜单带 aria-label="Model list"，模式那层没有
      // aria-label —— 先按容器把模型列表整个排除；② 再要求文本命中模式标签集。
      // 只做文本校验挡不住「模型取名叫深度思考版」，只做容器校验挡不住站点把模型塞进同一层。
      _isMode: function (el) {
        const menu = el.closest ? el.closest('[role="menu"]') : null;
        if (menu && /model|模型/i.test(menu.getAttribute("aria-label") || "")) return false;
        return this._MODES.test((el.textContent || "").trim());
      },
      _toggle: function () { return document.querySelector('[class*="ThinkSelector"]'); },
      _isOn: function () {
        const t = this._toggle();
        return !!t && /ThinkSelector_selected/.test((t.className || "").toString());
      },
      _modeItems: function () { return [...document.querySelectorAll('[role="menuitemradio"]')].filter((el) => this._isMode(el)); },
      // openMenu 是**切换**语义：菜单已开时再点会把它关掉。真机 2026-09-01：关闭动画期间 menuitemradio
      // 仍在 DOM，waitFor 照样找得到项、click 却点在正在消失的节点上 → 落空 → 抛「目标模式未生效」。
      // 所以先看是否已展开，且一次不成要重开一次（同 Claude `_open`、Gemini `_openModelMenu`）。
      _openModes: async function (b) {
        if (!this._modeItems().length) openMenu(b);
        let ok = await waitFor(() => this._modeItems().length || null, 1500);
        if (!ok) { openMenu(b); ok = await waitFor(() => this._modeItems().length || null, 1500); }
        if (!ok) { escMenus(); throw new Error("元宝: 模式菜单未展开"); }
      },
      _selectMode: async function (re) {
        const b = this._modeBtn();
        if (!b) throw new Error("元宝: 模式按钮未找到");
        if (re.test(this._mode())) return;
        await this._openModes(b);
        const item = this._modeItems().find((el) => re.test((el.textContent || "").trim())); // 语义校验在前：模型项一律不可点
        if (!item) { escMenus(); throw new Error("元宝: 目标模式未找到"); }
        item.click(); escMenus();
        // 按钮文本回显有延迟：复读到目标为止再判失败（原来是 500ms 固定等待，贴着实测值没余量）
        if (!await waitFor(() => re.test(this._mode()) || null, 2000)) throw new Error("元宝: 目标模式未生效");
      },
      // —— 模型子菜单（真机 2026-09-15）——
      _THINK_MODEL: /^hy4\s*preview/i,
      _FAST_MODEL: /^hy3(?![\d.])/i,
      // 入口是 [role=menuitem]，文本 = 「模型」/「Models」+ 当前模型名（如 ModelsHy3），只在模式菜单开着时存在——
      // 所以 state() 读不到模型，菜单关着时只能按模式粗判（见 state 注释）。
      _modelsEntry: function () {
        return [...document.querySelectorAll('[role="menuitem"]')].find((el) => /^(models|模型)/i.test((el.textContent || "").trim())) || null;
      },
      _model: function () { const e = this._modelsEntry(); return e ? (e.textContent || "").trim().replace(/^(models|模型)\s*/i, "") : ""; },
      // 模型项与模式项同为 menuitemradio，靠容器 aria-label（Model list / 模型列表）区分——与 _isMode 互为反面
      _modelItems: function () {
        return [...document.querySelectorAll('[role="menuitemradio"]')].filter((el) => {
          const menu = el.closest ? el.closest('[role="menu"]') : null;
          return !!menu && /model|模型/i.test(menu.getAttribute("aria-label") || "");
        });
      },
      // 子菜单靠悬停展开。入口 button 的 React 处理器只有 onMouseMove / onMouseLeave / onClick（CDP 真机 2026-09-16），
      // 合成 mousemove（带坐标）能打开，mouseover / pointermove / click / 方向键都打不开；click 留作站点改版时的第二招。
      _openModels: async function (b) {
        await this._openModes(b);
        for (let i = 0; i < 2 && !this._modelItems().length; i++) {
          const entry = this._modelsEntry();
          if (!entry) { escMenus(); throw new Error("元宝: 模型入口未找到"); }
          const r = entry.getBoundingClientRect ? entry.getBoundingClientRect() : { left: 0, top: 0 };
          try { entry.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 })); } catch (e) {}
          if (!await waitFor(() => this._modelItems().length || null, 1000)) { entry.click(); await waitFor(() => this._modelItems().length || null, 1000); }
        }
        if (!this._modelItems().length) { escMenus(); throw new Error("元宝: 模型子菜单未展开"); }
      },
      _selectModel: async function (re) {
        const b = this._modeBtn();
        if (!b) throw new Error("元宝: 模式按钮未找到");
        await this._openModes(b);
        if (re.test(this._model())) return;
        await this._openModels(b);
        const item = this._modelItems().find((el) => re.test((el.textContent || "").trim()));
        if (!item) { escMenus(); throw new Error("元宝: 目标模型未找到"); }
        item.click(); await sleep(300);
        await this._openModes(b); // 真机 2026-09-16：选完模型根菜单留着、子菜单收起、按钮即时回显；仍重开一次兜底，不猜
        if (!await waitFor(() => re.test(this._model()) || null, 2000)) { escMenus(); throw new Error("元宝: 目标模型未生效"); }
      },
      _set: async function (on) {
        if (this._modeBtn()) {
          if (on) {
            await this._selectModel(this._THINK_MODEL); escMenus();
            // Hy4 preview 只提供专家模式，站点自动落到专家；复读到位才算成功
            if (!await waitFor(() => /^(Expert|专家)/i.test(this._mode()) || null, 2000)) throw new Error("元宝: 目标模式未生效");
            return;
          }
          if (/^(Instant|即时|快速)/i.test(this._mode())) return; // 已是即时 → 模型必不是 Hy4 preview，免开菜单
          await this._selectModel(this._FAST_MODEL);
          await this._selectMode(/^(Instant|即时|快速)/i);
          escMenus(); // 切回 Hy3 时站点会自动恢复上一次的模式（CDP 真机 2026-09-16），_selectMode 可能直接命中返回而菜单还开着
          return;
        }
        const t = this._toggle();
        if (!t) throw new Error("元宝: Deep Thinking 控件未找到");
        if (this._isOn() !== on) { t.click(); await sleep(500); }
        if (this._isOn() !== on) throw new Error("元宝: 深度思考未生效"); // 点击被吞时不许静默成功
      },
      diagnose: function () {
        return [
          { name: t("diag_modeBtn"), ok: !!(this._modeBtn() || this._toggle()), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      // 菜单关着读不到模型，只能按模式粗判：专家 = think（Hy4 preview 强制专家；Hy3+专家也算，那是用户自己停的档），
      // 即时 = fast，思考 = null（不再是预设档，用户手选的合法档位，同 Kimi Instant / 千问 Qwen3.7+快速）
      state: function () {
        const mode = this._mode();
        if (mode) return /^(Expert|专家)/i.test(mode) ? "think" : /^(Instant|即时|快速)/i.test(mode) ? "fast" : null;
        return this._toggle() ? (this._isOn() ? "think" : "fast") : null;
      },
      think: async function () { await this._set(true); },
      fast: async function () { await this._set(false); },
      attach: async function (files, el, deadline) {
        const end = Number(deadline) || Date.now() + 15000;
        const boundedWait = async find => {
          const limit = Math.min(end, Date.now() + 1500);
          while (Date.now() < limit) {
            const node = find();
            if (Date.now() >= end) return null;
            if (node) return node;
            await sleep(Math.min(120, Math.max(0, limit - Date.now())));
          }
          return null;
        };
        if (Date.now() >= end) return false;
        const selector = 'input[type="file"][accept*="png"]';
        let input = document.querySelector(selector);
        const add = document.querySelector('button[aria-label="Add"],button[aria-label="添加"]');
        if (!add && !input) return S.dropFiles(el, files, el, deadline); // 旧版仍支持拖放。
        // 新版保留 input，但每次必须通过菜单重新激活上传处理器。
        if (add) {
          // 菜单项会创建 input 并 click；自动上传已有文件，不应再弹系统选择窗。
          const preventPicker = event => { if (event.target?.matches?.('input[type="file"]')) event.preventDefault(); };
          document.addEventListener("click", preventPicker, true);
          try {
            if (Date.now() >= end) return false;
            add.click();
            const item = await boundedWait(() => [...document.querySelectorAll('[role="menuitem"]')]
              .find(node => /^(Upload Image|上传图片)$/i.test((node.textContent || "").trim())));
            if (!item || Date.now() >= end) return false;
            item.click();
            input = await boundedWait(() => document.querySelector(selector));
          } finally { document.removeEventListener("click", preventPicker, true); escMenus(); }
        }
        return input && Date.now() < end ? S.setInputFiles(input, files, el, deadline) : false;
      },
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
      // 新版发送键是 aria-label=Send 的 div；旧版 icon-font 已下线。不可用时落回 Enter+校验兜底。
      // 注入侧真机实证：元宝 beforeinput 不生效、execCommand 生效（既有回退链覆盖）
      sendSel: '[aria-label="Send"], [aria-label="发送"]', // 供 diag.js 巡检，与 submit 同步维护
      submit: function () {
        const b = document.querySelector('[aria-label="Send"], [aria-label="发送"]');
        if (!b || /disabled/i.test((b.className || "").toString()) || b.getAttribute("aria-disabled") === "true") return false;
        clickEl(b);
      },
    },
  });
})();
