// desktop/src/site-runtime/adapters-intl.js — 国际站点适配器（Claude；ChatGPT/Gemini 分别在 intl2/intl3 卷）
// 触及 300 行上限后按站分卷，契约与注意事项同 CLAUDE.md / docs/adapters.md。
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus, checkDeadline, tierAction } = S;

  Object.assign(S.adapters, {
    "claude.ai": {
      _open: async function (deadline) {
        checkDeadline(deadline);
        const trig = document.querySelector('[data-testid="model-selector-dropdown"]');
        if (!trig) throw new Error("Claude: 模型按钮未找到");
        if (!document.querySelector('[role="menuitemradio"]')) tierAction(deadline, () => openMenu(trig));
        let ok = await waitFor(() => document.querySelector('[role="menuitemradio"]'), 1500, 120, deadline);
        if (!ok) { tierAction(deadline, () => openMenu(trig)); ok = await waitFor(() => document.querySelector('[role="menuitemradio"]'), 3500, 120, deadline); }
        if (!ok) throw new Error("Claude: 模型菜单未展开");
      },
      // 2026-08 改版：顶层只留当前模型一项，其余收进「More models」子菜单；顶层找不到再展开子菜单。
      _selectModel: async function (re, deadline) {
        try {
          checkDeadline(deadline);
          await this._open(deadline);
          let item = await waitFor(() => findByText('[role="menuitemradio"]', re), 900, 120, deadline);
          if (!item) {
            const more = findByText('[role="menuitem"][aria-haspopup="menu"]', /more models|更多模型/i);
            if (more) { tierAction(deadline, () => openMenu(more)); item = await waitFor(() => findByText('[role="menuitemradio"]', re), 1500, 120, deadline); }
          }
          if (!item) { escMenus(); throw new Error("Claude: 未找到模型 " + re); }
          tierAction(deadline, () => clickEl(item)); await sleep(700, deadline); escMenus(); // 收尾：子菜单不关会罩住输入框，也会让后续动作点空
        } finally { escMenus(); }
      },
      // effort 档位标签，由低到高（真机 2026-08-31：Low / MediumDefault / High / Extra / Max）。
      // think 取本表里在场的最高档，站点加减档自适应：撤掉 Max 就自动退到 Extra，再撤退到 High。
      _EFFORT: [/^(low|低)/i, /^(medium|中)/i, /^(high|高)/i, /^(extra|超)/i, /^(max|极致|最大|最高)/i],
      _THINK: /adaptive|high|extra|max|高|最大|极致|超/i, // state() 与 _setEffort() 的复读共用；必须盖住 _EFFORT 最高两档会点到的每个词（中文 UI 是「极致」「超」）
      // 2026-08 改版：effort-menu-trigger / effort-option-* 两个 testid 已消失（Base UI 菜单只剩
      // 自动生成 id），入口退化成「文本 Effort+当前档」的 role=menuitem 子菜单项。
      _effortTrigger: function () {
        const re = /^(effort|强度|思考强度|努力)/i;
        const submenu = findByText('[role="menuitem"][aria-haspopup="menu"]', re);
        if (submenu) return submenu;
        // 2026-09-23 真机：新版把档位平铺到 group，标题由 aria-labelledby 关联。
        for (const group of document.querySelectorAll('[role="group"][aria-labelledby]')) {
          const label = document.getElementById(group.getAttribute("aria-labelledby"));
          if (label && group.contains(label) && re.test((label.textContent || "").trim())) return label;
        }
        return null;
      },
      // 档位项与模型项同为 menuitemradio 且同时在 DOM（真机 2026-08-31：顶层 4 个模型 + 子菜单 5 个档位）。
      // 双重语义校验：① 最近的带标签 group / menu 必须指回 effort 标题/入口的 id；② 文本须属档位标签集。
      // 少一层都会把「最高档」点成末位模型（同 ChatGPT 2026-08 那次事故）。
      _effortItems: function (trig) {
        const id = trig.id || "";
        // 入口没有 id 就无法校验归属：宁可抛错也不退化成纯文本匹配（那会把「Max Preview」模型项当最高档点下去）。
        if (!id) { escMenus(); throw new Error("Claude: Effort 入口缺少 id，无法校验档位归属"); }
        return [...document.querySelectorAll('[role="menuitemradio"]')]
          .map((el) => ({ el, rank: this._EFFORT.findIndex((re) => re.test((el.textContent || "").trim())) }))
          .filter((x) => {
            if (x.rank < 0) return false;
            const menu = x.el.closest('[role="group"][aria-labelledby], [role="menu"]');
            return !!(menu && menu.getAttribute("aria-labelledby") === id);
          });
      },
      // effort 子菜单在模型下拉内；控件缺失一律 throw（2026-08-31 起不再有「静默 return」例外——
      // 控件仍在，只是选择子变了，静默会让 runMode 误报「已切到」并弹假成功 toast）。
      // pick = "top"（think：在场最高档）| "default"（fast：Medium，即站点默认档；_EFFORT 里 rank 1，不在场就抛错，不退到 Low/Max）。
      // effort 是站点级记忆、换模型不重置：think 过一次再只选 Sonnet 5 会带着 Max 发出去（用户真机 2026-09-16），
      // 所以 fast 也必须显式回到默认档。默认档复读按点中那一项的首词（Medium / 中），think 仍复读 _THINK（state 同源）。
      _setEffort: async function (pick, deadline) {
        try {
          checkDeadline(deadline);
          await this._open(deadline);
          const trig = this._effortTrigger();
          if (!trig) { escMenus(); throw new Error("Claude: Effort 入口未找到"); }
          let items = this._effortItems(trig);
          if (!items.length) { // 子菜单未展开：openMenu 一次再重取（展开会重渲染，不能复用旧节点）
            tierAction(deadline, () => openMenu(trig));
            items = await waitFor(() => { const l = this._effortItems(trig); return l.length ? l : null; }, 1500, 120, deadline) || [];
          }
          if (!items.length) { escMenus(); throw new Error("Claude: Effort 档位未找到"); }
          const dflt = pick === "default";
          const want = dflt ? items.find((x) => x.rank === 1) : items.reduce((a, b) => (b.rank > a.rank ? b : a));
          if (!want) { escMenus(); throw new Error("Claude: 默认档 effort 未找到"); }
          if (want.el.getAttribute("aria-checked") !== "true") { tierAction(deadline, () => clickEl(want.el)); await sleep(450, deadline); }
          // 真机 2026-10-08：MediumRecommended 连写；只取已知档名，说明文字不参与复读。
          const head = this._EFFORT[want.rank].exec((want.el.textContent || "").trim())[0];
          const re = dflt ? new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : this._THINK;
          const ok = await waitFor(() => re.test(this._label()), 1200, 120, deadline); // 点击被吞时不许静默成功
          escMenus();
          if (!ok) throw new Error("Claude: 目标 effort 未生效");
        } finally { escMenus(); }
      },
      _label: function () {
        const e = document.querySelector('[data-testid="model-selector-dropdown"]');
        return e ? (e.getAttribute("aria-label") || "") : "";
      },
      diagnose: function () {
        return [
          { name: t("diag_modelEntry"), ok: !!document.querySelector('[data-testid="model-selector-dropdown"]'), kind: "control" },
          { name: t("diag_modelReadable"), ok: /opus|sonnet|haiku|fable/i.test(this._label()), kind: "tier" },
        ];
      },
      // think = Fable 5.1 + 在场最高 effort（当前 Max）；fast = Opus 5.5 + Medium。
      // Opus 5.5 Medium 判 fast；其余保留旧模型的粗档位识别，Fable Medium 仍不判。
      // aria-label 形如 `Model: Fable 5 · Max`（分隔符 U+00B7，真机 2026-08-31）。
      state: function () {
        const t = this._label();
        if (!t) return null;
        if (/sonnet|haiku/i.test(t)) return this._THINK.test(t) ? null : "fast"; // 快模型带高档 effort 不是预设档（fast 会回到 Medium）
        if (!/fable|opus/i.test(t)) return null;
        if (this._THINK.test(t)) return "think";
        if (/\bopus\s*5\.5(?![\d.])/i.test(t) && /\bmedium(?:default)?\b|中/i.test(t)) return "fast";
        if (/\blow\b|低/i.test(t)) return "fast";
        if (/(?:fable|opus)\s*[\d.]+$/i.test(t.trim())) return "fast"; // 窄屏思考关：无后缀
        return null;
      },
      // 新版（2026-10-02）：正文块 data-perf-reply-text，所在轮次 assistant-message。
      // 最后一个正文块是最终回答；只有思考/工具时不回退整轮或上一条回答。
      // 旧版仍取 grid 正文 .row-start-2，排除 .row-start-1 的思考折叠头。
      answer: function () {
        const modern = document.querySelectorAll('[data-testid="assistant-message"]');
        if (modern.length) {
          const blocks = modern[modern.length - 1].querySelectorAll('[data-perf-reply-text]');
          return blocks[blocks.length - 1] || null;
        }
        const els = document.querySelectorAll(".font-claude-response");
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".row-start-2") || el;
      },
      think: async function (deadline) {
        checkDeadline(deadline);
        await this._selectModel(/fable\s*5/i, deadline); await this._setEffort(undefined, deadline);
      },
      // 模型菜单文本紧连说明（Opus 5.5For complex tasks），版本后不能用词边界；仅排除后续数字/小数点。
      // fast = Opus 5.5 + 默认档 effort（Medium）。只换模型不回档，上一轮 think 留下的 Max 会原样带过来。
      fast: async function (deadline) {
        checkDeadline(deadline);
        await this._selectModel(/opus\s*5\.5(?![\d.])/i, deadline); await this._setEffort("default", deadline);
      },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[data-testid="file-upload"]'), files, el, deadline);
      },
    },

  });
})();
