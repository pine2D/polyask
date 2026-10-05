// desktop/src/site-runtime/adapters-cn.js — 国内站点适配器（DeepSeek/豆包；其它国内站按站分卷）
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus, checkDeadline, tierAction } = S;

  Object.assign(S.adapters, {
    "deepseek.com": {
      _deepThink: function () {
        return [...document.querySelectorAll(".ds-toggle-button")]
          .find((x) => /deepthink|深度思考/i.test((x.textContent || "").trim()));
      },
      _setDeepThink: async function (on, deadline) {
        checkDeadline(deadline);
        const t = this._deepThink();
        if (!t) throw new Error("DeepSeek: DeepThink 开关未找到"); // 开关常驻 composer，缺失即异常（静默 return 会让 runMode 误报成功）
        if ((t.getAttribute("aria-pressed") === "true") !== on) tierAction(deadline, () => clickEl(t));
        await sleep(300, deadline);
        const after = this._deepThink(); // 点击被吞时不许静默成功
        if (!after || (after.getAttribute("aria-pressed") === "true") !== on) throw new Error("DeepSeek: DeepThink 未生效");
      },
      _selectMode: async function (re, deadline) {
        checkDeadline(deadline);
        // DeepSeek 模式 radio 只认原生 click(拒绝合成事件 isTrusted=false)；选择幂等，原生 click 安全。
        // radio 仅空对话首屏存在，聊天中缺失属正常态 → 静默跳过（档位真值由 DeepThink 开关兜底）
        const el = findByText('[role="radio"]', re); // Instant / Expert / Vision
        if (el) { tierAction(deadline, () => el.click()); await sleep(400, deadline); }
      },
      // diag 不含模式 radio：它仅空对话首屏存在，聊天中缺失属正常态，列进来会让巡检恒红误报
      diagnose: function () {
        return [
          { name: t("diag_deepThink"), ok: !!this._deepThink(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      // 档位真值优先读常驻 composer 的 DeepThink 开关（真机实证 2026-07-11：radio 首条消息后
      // 从 DOM 消失，只读 radio 会在整个对话期恒 null——pill 高亮熄灭/巡检误报/二轮切档失去确认）；
      // radio 仅作首屏无开关时的兜底。
      state: function () {
        const dt = this._deepThink();
        if (dt) return dt.getAttribute("aria-pressed") === "true" ? "think" : "fast";
        const r = [...document.querySelectorAll('[role="radio"]')]
          .find((x) => x.getAttribute("aria-checked") === "true");
        const t = r ? r.textContent || "" : "";
        return /Expert|专家/.test(t) ? "think" : /Instant|快速/.test(t) ? "fast" : null;
      },
      think: async function (deadline) {
        checkDeadline(deadline); await this._selectMode(/Expert|专家/, deadline); await this._setDeepThink(true, deadline); },
      fast: async function (deadline) {
        checkDeadline(deadline); await this._selectMode(/Instant|快速/, deadline); await this._setDeepThink(false, deadline); },
      thinkImage: async function (deadline) {
        checkDeadline(deadline); await this._selectMode(/Vision|视觉/, deadline); await this._setDeepThink(true, deadline); },
      fastImage: async function (deadline) {
        checkDeadline(deadline); await this._selectMode(/Vision|视觉/, deadline); await this._setDeepThink(false, deadline); },
      // 2026-07-23 真机：常驻文件 input 接受合成 change；上传完成后预览 img.alt 保留文件名。
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[type="file"][accept*=".png"]'), files, el, deadline);
      },
      // 发送键无 send/发送 标签（真机审计 2026-07：composer 右下 primary 圆钮）；图片处理期间仅加
      // ds-button--disabled，不设 aria-disabled，需等按钮真正可用后再原生点击。
      // sendSel 供 desktop/src/site-runtime/diag.js 做只读存在性巡检，与下方 submit 的选择子同步维护。
      sendSel: '[role="button"].ds-button--primary.ds-button--circle',
      // 已知限制（真机证实，DeepSeek/豆包/Kimi 同）：流式生成期间站点把同一按钮复用为「停止」（class/id 不变
      // 仅换图标），流式中二次群发会点成停止、截断上一条回答——confirmSubmitted 会诚实报失败，retry 可恢复；
      // 图标判别太脆弱不做守卫，属窄窗口取舍。
      submit: async function (_el, deadline) {
        checkDeadline(deadline);
        const draft = () => _el?.value ?? _el?.innerText ?? _el?.textContent ?? "";
        const before = draft();
        const b = await waitFor(() => {
          const el = [...document.querySelectorAll('[role="button"].ds-button--primary.ds-button--circle')].pop();
          return el && !el.classList.contains("ds-button--disabled") &&
            el.getAttribute("aria-disabled") !== "true" ? el : null;
        }, Number(deadline) ? Math.max(0, Number(deadline) - Date.now()) : 10000, 120, deadline);
        checkDeadline(deadline);
        if (!b) return false;
        if (draft() !== before) throw new Error("inject_failed");
        b.click();
      },
      // 最后一条回答：.ds-message 为 AI 消息容器，正文取思考段（.ds-think-content）之外的最后一个 .ds-markdown
      answer: function () {
        const msgs = document.querySelectorAll(".ds-message");
        for (let i = msgs.length - 1; i >= 0; i--) {
          const mds = [...msgs[i].querySelectorAll(".ds-markdown")].filter((x) => !x.closest(".ds-think-content"));
          if (mds.length) return mds[mds.length - 1];
        }
        return null;
      },
    },

    // 豆包：composer 模式按钮(显示当前模式)，菜单两项 [role=menuitem]：「豆包 快速」/「豆包 2.1 Turbo」+专家角标（真机 2026-09-15 复核不变；「超能」仅历史档位，留在 _modeBtn 过滤里兜底）
    "doubao.com": {
      _modeBtn: function () {
        const found = [...document.querySelectorAll("button")].filter((x) => {
          const t = (x.textContent || "").trim();
          return (/^豆包\s+\S/.test(t) || /^(快速|专家|超能)/.test(t)) && t.length < 30;
        });
        const composer = S.findComposer && S.findComposer();
        if (!composer || !found.length) return found.pop() || null;
        const cr = composer.getBoundingClientRect();
        const near = found.map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0)
          .sort((a, b) => Math.abs(a.r.y - cr.y) - Math.abs(b.r.y - cr.y))[0];
        return near && Math.abs(near.r.y - cr.y) < 240 ? near.el : null;
      },
      _select: async function (re, expected, deadline) {
        try {
          checkDeadline(deadline);
          for (let i = 0; i < 3; i++) {
            if (this.state() === expected) return;
            const btn = this._modeBtn();
            if (!btn) throw new Error("豆包: 模式按钮未找到"); // 静默 return 会让 runMode 误报"已切到"
            if (!findByText('[role="menuitem"]', re)) tierAction(deadline, () => openMenu(btn));
            const item = await waitFor(() => findByText('[role="menuitem"]', re), 1500, 120, deadline);
            if (item) { tierAction(deadline, () => item.click()); await sleep(500, deadline); } // 选项 onclick，用原生 click
            escMenus(); await sleep(200, deadline);
          }
          throw new Error("豆包: 目标模式未选中");
        } finally { escMenus(); }
      },
      diagnose: function () {
        return [
          { name: t("diag_modeBtn"), ok: !!this._modeBtn(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      state: function () {
        const b = this._modeBtn();
        const t = b ? (b.textContent || "").trim() : "";
        return (/专家$/.test(t) || /^豆包\s+[\d.]/.test(t)) ? "think" : /快速$/.test(t) ? "fast" : null;
      },
      think: async function (deadline) {
        checkDeadline(deadline); await this._select(/专家$/, "think", deadline); },
      fast: async function (deadline) {
        checkDeadline(deadline); await this._select(/快速$/, "fast", deadline); },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[type="file"][accept*="png"]'), files, el, deadline);
      },
      // 发送键无标签但有稳定 id（真机审计 2026-07）；不可用时落回通用路径（textarea Enter 可发）。
      // 有意不声明 sendSel：真机 2026-08-18 实测空输入框时该按钮整个不在 DOM（非常驻），列进巡检会恒红误报
      submit: function () {
        const b = document.getElementById("flow-end-msg-send");
        if (!b || b.disabled || b.getAttribute("aria-disabled") === "true" || b.getAttribute("data-disabled") === "true") return false;
        b.click();
      },
      // 最后一条回答（chrome-dbg 真机审计 2026-07：消息容器 [data-message-id]，用户消息右对齐带
      // justify-end、AI 无；正文在 .md-box-root。注意豆包渲染会在中文与数字间插空格）
      // 深度思考块是 data-plugin-identifier="block_type:10040 | thinking_block.scene:N" 的插件节点（正文块是 block_type:10000），
      // 思考进度区 data-message-selection-module="thinking_progress"（think-collapse-block-<hash>）里同样用 MdBox 渲染，步骤标题
      // （「正在思考」「规划说明结构」）也是 .md-box-root（2026-10-04 豆包前端包与真机属性）。取思考块之外的第一个正文；没有正文、只有思考块时
      // 返回 null（同千问/Kimi），中途封存的副本才不会是一串思考标题；空占位消息仍返回消息本身。
      answer: function () {
        const msgs = [...document.querySelectorAll("[data-message-id]")]
          .filter((m) => !((m.className || "").includes("justify-end")) && !m.querySelector(".justify-end"));
        if (!msgs.length) return null;
        const el = msgs[msgs.length - 1], THINK = '[data-plugin-identifier*="thinking_block"],[data-message-selection-module="thinking_progress"],[class*="think" i]';
        const inThink = (node) => { const t = node.closest(THINK); return !!t && t !== el && el.contains(t); };
        const body = [...el.querySelectorAll(".md-box-root")].find((m) => !inThink(m));
        if (body) return body;
        const thinks = [...el.querySelectorAll(THINK)].filter(inThink);
        if (!thinks.length) return el;
        // 思考块完成后折叠常驻，终态却不是 MdBox（繁忙/违规提示、卡片、图片）：取最后一个最外层思考块之后、自身不含思考块、有字或有图的
        // 第一个兄弟（逐层向上找到消息为止）；一个都没有才是还在思考，返回 null。
        const top = thinks.filter((x) => !thinks.some((o) => o !== x && o.contains(x))).pop();
        for (let node = top; node && node !== el; node = node.parentElement) {
          for (let s = node.nextElementSibling; s; s = s.nextElementSibling) {
            if (!s.matches(THINK) && !s.querySelector(THINK) && ((s.textContent || "").trim() || s.querySelector("img"))) return s;
          }
        }
        return null;
      },
    },

  });
})();
