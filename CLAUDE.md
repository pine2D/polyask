# PolyAsk · AI 众答

Chrome MV3 扩展。两大能力：①**群发对比**——一个问题群发到多个 AI、真实窗口同屏平铺对比（核心）；②在 9 个 AI 站点**独立访问**时一键切换「深度思考/快速模型」。

## 加新站点

加站点改两处（漏一处=该站静默不工作）：`manifest.json` 的 `matches` + 对应适配器（intl 或 cn）。群发的发送/切档复用 `content/core.js` 的通用 `submitPrompt`/`runMode`，多数站点无需在适配器写 `submit`；仅当该站发送键不带 `send/发送` 标签、且 Enter 提交不灵时，才在适配器加可选 `submit(el)`（原生点其真实发送键）。`console/console.js` 的 `SITES` 列表与站点预设 `PRESETS` 也要同步加。

## 架构

```
background.js               快捷键转发(commands→tabs.sendMessage{source:AMS,mode}) + 群发控制台编排
content/core.js             helpers + toast + __AMS 注册表 + runMode/switchTier + submitPrompt + onMessage
content/adapters-intl.js    Claude/ChatGPT/Gemini
content/adapters-cn.js      DeepSeek/豆包/千问/Kimi/元宝/智谱清言
content/pill.js             三态悬浮控件(handle/always/hidden, storage.sync displayMode, Shadow DOM)
console/console.html|css|js 群发指挥台(暗色单行顶栏 popup 窗口；勾选/档位/历史/模板/发送/平铺/联动)
popup/                      🧠/⚡按钮 + 显示模式 + 快捷键展示 + 🩺诊断 + 打开控制台
```
- 权限：`storage`、`tabs`、`system.display`（群发要 tabs.sendMessage/query + 多显示器工作区；无 host_permissions）。
- 适配器契约：每站 `{think, fast, state(), diagnose()}`（可选 `submit(el)`）；state/diagnose **只读不开菜单**。

## 群发控制台（console）编排 —— 实战沉淀

控制台是贴顶、占满屏宽、高 96px(`STRIP_H`) 的独立 `type:"popup"` 窗口；下方平铺各 AI 站点窗口。编排全在 `background.js`。

- **popup-only 铁律（安全核心）**：所有「host→窗口」解析收敛到 `popupWindowForHost(host,wins)`，**只返回 `type:"popup"`，绝不碰用户日常浏览窗口(`type:"normal"`)**；关窗经 `removeIfPopup(id)`（get 校验 type 再 remove）。openTile/sendAll/focusAll/minimizeAll/newSession 全走它。曾因裸 `tabs.query({url})` 误把用户日常窗口收编进平铺/广播/新会话（清空对话），故铁律不可破。
- **登记表 `amsWindows` host→{id,owned}**：owned=true 仅 `windows.create(popup)` 新建（closeAll 可自动关）；复用/收编窗口 owned=false（不擅自关）。
- **sendAll（发送到全部 / Enter）**：有站点没窗口先 `openTile` 平铺开窗 → 各站**并行轮询**页面就绪再提交（content 未注入 /「输入框未找到」都视为还没好、继续等，~22s）。**初次使用无需先点平铺**（勾选→输入→Enter）。每站完成即 `pushSiteResult` 推单站结果（`{from:"AMS_BG",type:"siteResult"}`），圆点逐个变色、不等最慢站。
- **联动**（MV3 无最小化事件，事件驱动唤醒 SW）：`onRemoved`==console 窗口 → `closeAll`(仅 owned)；`onFocusChanged` 读 console `state==="minimized"` 精确判定（区分最小化 vs 失焦）→ `minimizeAllManaged`/`restoreAllManaged`。console 窗口 id 存 `amsConsoleWin`。
- **平铺保留高度**：`consoleReserveHeight(wa)` 用控制台**实际底边 `c.top+c.height`**（非硬编码 96）——WSL2/X410 给每个窗口套 ~30px 标题栏（Chrome 如实报告在 `top`），只用 height 会漏掉上移、致平铺压住控制台。
- **薄弹窗限制**：96px 窗口里的自定义 DOM 浮层会被裁切，只有 OS 原生菜单/键盘能逃出 → 历史用 ↑/↓ 键、分组用行内预设按钮、模板用原生 `<select>`，不靠拉高窗口。
- storage keys：`amsConsole{selected,tier,prompt}`、`amsWindows`、`amsHistory`(≤20 去重)、`amsTemplates`、`amsConsoleWin`。

## 注入与提交（submitPrompt / switchTier）—— 实战沉淀

- **受控编辑器**（Lexical/ProseMirror/Slate，如千问/Kimi）**无视 `execCommand` 的 DOM 写入**（写进 DOM 但编辑器 model 不注册 → 发送键禁用）：contenteditable 改用**合成 `beforeinput`**（`inputType:"insertText", data`）注入，编辑器才注册；没进去再退回 execCommand。textarea/input 仍用原生 value setter。
- **提交优先原生点击发送键**（`button[aria-label*=send/发送]`，国产站拒合成事件、且避免对受控编辑器发 Enter 产生多余换行），`!disabled` 防误触；无匹配按钮再退回合成 Enter。审计：千问/Claude/ChatGPT/Gemini 发送键带标签可原生点；**DeepSeek/豆包/Kimi/元宝/chatglm 发送键不带 send/发送 标签** → 退回 Enter（textarea 多半 OK，contenteditable 的 Kimi/元宝 存疑，按需在适配器加 `submit(el)`）。
- **切档位要验证**：`switchTier(mode)` 静默重试 `runMode` 直到 `state()` 确认切到目标档再提交（~10s 兜底）。新开页面切换器渲染晚于输入框，旧逻辑"没抛错就算切了"会"切换失败仍直接提交"。`runMode(mode, silent?)` 返回成功布尔供其重试。

## 适配器编写原则（实战沉淀）

- **模型名匹配语言无关**（Opus/Qwen/K2/GLM…），**UI 词必须中英双写**（`/Expert|专家/`、`/^(high|高)$/i`）；zh/en 之外不承诺，靠诊断兜底。
- 优先**结构/语义锚点**（data-testid、稳定 class、aria-label、aria-checked/pressed），文本是次选。
- **国产站常拒绝合成事件**（isTrusted=false 被忽略）：菜单项/radio/toggle 用**原生 `el.click()`**；国际站 Radix/Material 菜单用 pointer 事件序列 `openMenu()`。
- 站点常有**宽窄两种布局**（窗口宽窄不同）：Claude 窄屏是 Adaptive thinking 开关、宽屏是 effort 子菜单；Gemini 窄屏模型按钮无 aria-haspopup。适配器须双布局兼容。
- 有状态控件**先读后点**（幂等）；嵌套子菜单（Gemini Thinking level）需"未展开才点 + 轮询重试 + Enter+click 提交"。
- 文案可能含**零宽字符**（Claude "Max" 实为 4 字符）：用 contains 匹配，别用 `^...$` 配长度。

## 测试与调试（chrome-dbg 实战）

- 重载扩展：在 `chrome://extensions` 标签页执行 `chrome.developerPrivate.reload("<本仓unpacked ID>",{failQuietly:false})`；**重载后旧标签的 content script 变孤儿**，需刷新页面重注入。
- **直连 chrome-dbg 最灵活**：本机 chrome-dbg 在 `127.0.0.1:9222`。node(≥22 自带全局 `WebSocket`) + CDP 直跑：`/json/list` 取页面、`/json/new`(PUT) 开 blank tab、`Page.navigate`+`Runtime.evaluate(awaitPromise,returnByValue)` 在页面里跑探针（参考 scratchpad/cdp.js）。验证发送/切档需真站登录态；不发消息可只验"注入后发送键由禁用变启用"。
- **chrome-devtools-mcp 默认自启一个 `--disable-extensions` 的全新 Chrome**（about:blank、无登录态、无扩展）；要连本机 chrome-dbg 须给其 MCP server 配 `--browserUrl http://127.0.0.1:9222` 再重启。
- **claude-in-chrome** 进不了 `chrome://` / `chrome-extension://`（被拦），且需逐站授权、多浏览器要先 `select_browser`；适合驱动已授权的普通站点，但逐站授权慢。
- 验证快捷键链路：MV3 SW 休眠，reload 唤醒后 30s 内 CDP `Target.attachToTarget` 执行 onCommand 等价代码；物理按键→onCommand 无法合成，留人工。
- 平铺安全回归（核心）：日常 normal 窗口开某站 → 触发 openTile → 断言该 normal 窗口 bounds 不变、登记的是新 popup；污染登记为 normal id 后断言不被关、自愈为 popup。
- 仿真窄窗：`Emulation.setDeviceMetricsOverride {width:639}`。
- **断言用生产逻辑**（`__AMS.getState()`/`_isOn()`），不要在测试 lambda 里重写正则——shell/python 转义会把 `\s` 变 `\\s`，产生"幽灵失败"（实战吃过亏）。注意 `__AMS` 在 content script 隔离世界，主世界 DevTools 控制台默认看不到（要切上下文）。
- chatglm.cn 加载极重：水合期（~30s）连扩展消息都无响应，安定后正常；新开标签+长等待。

## Git

- 提交用 git-commit skill（Conventional Commits、可带 AI 署名 trailer）；仓库无 user 配置，用内联身份提交。
- `docs/superpowers/`、`.superpowers/`、`.spec-workflow/` 与 `.codegraph/` 已 gitignore（本地工作文档不入库）。
- 单文件 ≤300 行（JS）；超了按 intl/cn 之类职责拆分。
