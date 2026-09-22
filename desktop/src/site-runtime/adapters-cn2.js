// desktop/src/site-runtime/adapters-cn2.js — 国内站点适配器·续（Kimi/智谱清言；元宝在 adapters-cn3.js）。
// adapters-cn.js 触及 300 行上限后按站拆分；契约与注意事项同 adapters-cn.js / CLAUDE.md。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    // Kimi：think=K3+Max、fast=K3+Standard（K3 才有 Max 档；effort 经 hover 子菜单选）。
    // 换模型会 SPA 路由跳 /agent?chat_enter_method=change_model（2026-07-21 真机），该面发送
    // 偶发对真人也失效（疑站点高峰限流禁用对话）——发送失败会诚实报 submit_unconfirmed 可 retry。
    "kimi.com": {
      _entry: function () { return document.querySelector(".current-model"); },
      _model: function () {
        const n = this._entry() && this._entry().querySelector(".name");
        return n ? this._zap(n.textContent) : ""; // 与 _effort() 同款去零宽，见 F076
      },
      _zap: function (s) { return (s || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim(); }, // 零宽字符防御
      // 收尾：**escMenus 只收得掉 effort 子菜单，收不掉模型根菜单**（真机 2026-08-31：Escape 后
      // .model-item 仍可见、入口仍带 .active），再点一次入口才整体关掉。菜单不关会罩住输入框，
      // 让随后的注入点空——Kimi 的注入本就是站点特调的 execCommand 路径，点空即整条群发哑火。
      _close: async function () {
        escMenus();
        const e = this._entry();
        if (!e || !e.classList.contains("active")) return;
        await sleep(250);
        if (this._entry() && this._entry().classList.contains("active")) { this._entry().click(); await sleep(300); }
      },
      _effort: function () {
        const n = this._entry() && this._entry().querySelector(".current-effort");
        return n ? this._zap(n.textContent) : "";
      },
      _select: async function (name) {
        const e = this._entry();
        if (!e) throw new Error("Kimi: 模型入口未找到"); // 静默 return 会让 runMode 误报成功
        if (!e.classList.contains("active")) e.click();
        const opt = await waitFor(() => [...document.querySelectorAll(".model-item")].find((el) => {
          const n = el.querySelector(".name");
          return n && this._zap(n.textContent) === name; // 去零宽再比，同上，见 F076
        }), 1500);
        if (!opt) { await this._close(); throw new Error("Kimi: 目标选项未找到"); }
        opt.click();
        await sleep(400);
        await this._close();
      },
      _setEffort: async function (re) {
        if (re.test(this._effort())) return;
        const e = this._entry();
        if (!e) throw new Error("Kimi: 模型入口未找到");
        if (!e.classList.contains("active")) e.click();
        // 菜单开启动画期间合成 hover 会丢失、effort 行节点还会被重挂（真机 2026-07-21：
        // 重开菜单后对首个找到的行 hover 子菜单不渲染，重查新节点再 hover 才出）
        // → 每轮重新取行、重发 hover，而不是单次 hover 后干等
        let opt = null;
        for (let i = 0; i < 4 && !opt; i++) {
          const row = await waitFor(() => [...document.querySelectorAll(".effort-item")].find((el) =>
            /Thinking|思考|推理/i.test((el.querySelector(".effort-title") || {}).textContent || "")), 1500);
          if (!row) { await this._close(); throw new Error("Kimi: 思考强度入口未找到"); }
          ["pointerenter", "mouseenter", "pointerover", "mouseover"].forEach((type) =>
            row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
          opt = await waitFor(() => [...document.querySelectorAll(".effort-option")].find((el) =>
            re.test(this._zap((el.querySelector(".effort-name") || {}).textContent))), 900);
        }
        if (!opt) { await this._close(); throw new Error("Kimi: 目标思考强度未找到"); }
        opt.click();
        await sleep(400);
        await this._close();
        if (!re.test(this._effort())) throw new Error("Kimi: 思考强度未生效"); // 点击被吞时不许静默成功
      },
      diagnose: function () {
        return [
          { name: t("diag_modelEntry"), ok: !!document.querySelector(".current-model"), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      state: function () {
        if (this._model() !== "K3") return null;
        const ef = this._effort();
        return /^(Max|极致|最大|最高|最强)$/i.test(ef) ? "think" : /^(Standard|标准)$/i.test(ef) ? "fast" : null; // 中文 UI Max=「极致」（用户实证 2026-07-21）
      },
      think: async function () { if (this._model() !== "K3") await this._select("K3"); await this._setEffort(/^(Max|极致|最大|最高|最强)$/i); },
      fast: async function () { if (this._model() !== "K3") await this._select("K3"); await this._setEffort(/^(Standard|标准)$/i); },
      attach: async function (files, el, deadline) {
        let input = document.querySelector('input.hidden-input[type="file"]');
        if (!input) {
          const trigger = document.querySelector(".toolkit-trigger-btn");
          if (!trigger) return false;
          trigger.click(); // 打开工具菜单
          const ms = Number(deadline) ? Math.min(1500, Math.max(0, Number(deadline) - Date.now())) : 1500;
          input = await waitFor(() => document.querySelector('input.hidden-input[type="file"]'), ms);
          await this._close(); // 无论成败都收尾，别把菜单罩在输入框上带进后续 inject
        }
        return input ? S.setInputFiles(input, files, el, deadline) : false;
      },
      // 新编辑器（真机 2026-07-21）：合成 beforeinput 会 DOM/model 分叉并冻死编辑器（发送键失灵、
      // 可信键盘也不再接受）；execCommand insertText 反而正常入 model → 站点特调注入改道
      inject: function (el, text) {
        el.focus();
        // 新开页 focus 后选区未必落进编辑器（execCommand 无处可写）：显式设 Range 再插入
        const s = getSelection(); s.removeAllRanges();
        const rg = document.createRange(); rg.selectNodeContents(el); s.addRange(rg);
        // 失败必须抛（而非返回 false）：本站通用 beforeinput 回退会写死编辑器，宁可 inject_failed
        if (!document.execCommand("insertText", false, text)) throw new Error("Kimi: execCommand 注入失败");
      },
      // 发送键是无 role 的 div（真机审计 2026-07），Enter 只插换行 → clickEl（detail:1 拟真）点它
      sendSel: ".send-button-container", // 供 diag.js 巡检，与 submit 同步维护
      submit: function () {
        const b = document.querySelector(".send-button-container");
        if (!b) return false;
        clickEl(b);
      },
      // Kimi 发送后会重挂页面/隔离世界；后台据最后一条用户消息判断是否真的需要安全重试。
      submitted: function (text) {
        const els = document.querySelectorAll(".chat-content-item-user");
        if (!els.length) return false;
        const el = els[els.length - 1].querySelector(".user-content") || els[els.length - 1];
        const norm = (s) => this._zap(s).replace(/\s+/g, " ");
        return norm(el.textContent || "") === norm(text || "");
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

    // 智谱清言：思考已从「toggle」改为「触发器 + el-tooltip 弹层菜单」。弹层现在分两段（真机
    // 2026-08-31）：**模型段**（GLM-5.3 / GLM-Flash）+ **档位段**（快速 / 深度 / 极致），两段同为
    // .think-mode-item。映射 think→极致（全力推理，找不到退回深度）、fast→快速。
    // **适配器不选模型**：当前停在哪个模型就用哪个（模型项与档位项同类名，按名精确等值取项，
    // 现有六个名字互不重叠；站点若把模型改叫「快速」之类要立刻改这里）。
    // 选档序列（chrome-dbg 实测验证）：hover+click .think-mode-trigger 开弹层；档位项还需先 hover 父项
    //（.has-submenu，其名随当前档变故按 class 找）展开子菜单，再原生 click 目标 .item-name 项。
    // **脆弱点**：合成 hover 在真机上并不真的展开子菜单（档位项 rect 恒 0），只是靠 .click() 仍能
    // 触发 Vue handler 才碰巧能用 —— 收尾的 _selected() 复读是唯一防线，别把它删了。
    // state 只读：读 .think-mode-item 的 selected 类（弹层关闭时菜单项仍在 DOM，不开菜单）。
    "chatglm.cn": {
      attach: function (files, el, deadline) {
        // .img-input 是旧入口；头像也有 file input，只使用聊天区本地文件选择。
        if (Date.now() >= deadline) return false;
        const input = document.querySelector('.upload-demo input.el-upload__input[type="file"]');
        return input ? S.setInputFiles(input, files, el, deadline) : false;
      },
      _TIERS: ["极致", "深度"], // think 目标，由强到弱：站点撤掉「极致」时降级点「深度」
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
      // 弹层是否开着：档位/模型项在关闭态也留在 DOM，只能按几何判（rect 恒 0 = 关）
      _open: function () {
        return [...document.querySelectorAll(".think-mode-item")].some((el) => el.getBoundingClientRect().height > 0);
      },
      // 收尾：**escMenus 对本站无效**（真机 2026-08-31：Escape 关不掉 el-tooltip 弹层），只有再点一次
      // 触发器才收。弹层不关会罩住输入框，让随后的注入点空。
      _close: async function () {
        escMenus();
        if (!this._open()) return;
        await sleep(250);
        const tg = this._trigger();
        if (this._open() && tg) { this._hover(tg); tg.click(); await sleep(300); }
      },
      _pick: async function (name, viaSubmenu) {
        const tg = this._trigger();
        if (!tg) throw new Error("智谱: 思考触发器未找到");
        this._hover(tg); tg.click();                                          // 开 el-tooltip 弹层
        await sleep(350);
        if (viaSubmenu) { this._hover(document.querySelector(".think-mode-item.has-submenu")); await sleep(300); } // 展开子菜单
        const it = this._itemByName(name);
        if (!it) { await this._close(); throw new Error("智谱: 档位「" + name + "」未找到"); }
        it.click(); await sleep(500); await this._close();
        if (!this._selected(name)) throw new Error("智谱: 档位未生效"); // 点击被吞时不许静默成功
      },
      diagnose: function () {
        return [
          { name: t("diag_thinkButton"), ok: !!this._trigger(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      // 极致 / 深度 都算 think（深度是极致缺席时的降级目标）；标准若回归仍判 null，不猜。
      state: function () {
        if (this._TIERS.some((n) => this._selected(n))) return "think";
        return this._selected("快速") ? "fast" : null;
      },
      // 只读挑目标：档位项在弹层关闭时也在 DOM，所以这里不开菜单（契约要求 think 之前不得副作用）。
      think: async function () {
        await this._pick(this._TIERS.find((n) => this._itemByName(n)) || this._TIERS[this._TIERS.length - 1], true);
      },
      fast: async function () { await this._pick("快速", false); },
      // 智谱 input 忽略扩展派发的 input/change，且无可复用预览节点；留空明确报 unsupported。
      // 2026-09-21 真机：正文/代码分成多个 markdown-body，共用 answer-content-wrap。
      // 只返回正文容器；只有思考段时返回 null，不能回退到含思考的整条消息。
      answer: function () {
        const els = document.querySelectorAll(".answer-content");
        if (!els.length) return null;
        const el = els[els.length - 1];
        const mds = [...el.querySelectorAll(".markdown-body")]
          .filter((m) => !m.closest(".text-advance-thinking-content"));
        return mds[0]?.closest(".answer-content-wrap") || mds[0] || null;
      },
    },
  });
})();
