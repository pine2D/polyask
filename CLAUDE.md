# ai-model-switcher

Chrome MV3 扩展：在 9 个 AI 聊天站点**独立访问**时一键切换「深度思考/快速模型」。
姊妹仓库：`~/projects/simple-chat-hub-extension`（chatHub 聚合器 fork，覆盖 **iframe 内嵌**场景）。

## 双仓同步规约（重要）

两仓的站点适配器**同源**，修任何一边的适配器后必须同步另一边：

| 本仓 | 姊妹仓 |
|---|---|
| `content/adapters-intl.js` / `content/adapters-cn.js` | `src/extension/custom/adapters-intl.js` / `adapters-cn.js` |
| 注册表前缀 `window.__AMS` | `window.__SCH` |

同步命令（本仓 → 姊妹仓）：
```bash
cp content/adapters-{intl,cn}.js ~/projects/simple-chat-hub-extension/src/extension/custom/
perl -i -pe 's/window\.__AMS/window.__SCH/g; s/content\/adapters/custom\/adapters/g' \
  ~/projects/simple-chat-hub-extension/src/extension/custom/adapters-{intl,cn}.js
```
反向同步：替换方向相反（`__SCH`→`__AMS`、`custom/`→`content/`）。

**加新站点时的多处清单**（漏一处=该站静默不工作）：
- 本仓：`manifest.json matches` + 适配器
- 姊妹仓：`manifest.json matches` + 适配器 + **`panel.js` 的 `HOSTS` 数组**（双列表教训：只加 manifest 按钮不会广播到该站）

**快捷键约束**：`chrome.commands`（Alt+T/Alt+Y）只属于本仓。不要给姊妹仓加 commands——同一组合键 Chrome 只能绑给一个扩展。

## 架构

```
background.js        commands → tabs.sendMessage({source:"AMS", mode})
content/core.js      helpers + toast + __AMS 注册表 + runMode(重试1次+focusComposer) + onMessage(mode/getState/diagnose)
content/adapters-intl.js   Claude/ChatGPT/Gemini
content/adapters-cn.js     DeepSeek/豆包/千问/Kimi/元宝/智谱清言
content/pill.js      三态悬浮控件(handle默认/always/hidden, storage.sync displayMode, Shadow DOM)
popup/               🧠/⚡按钮 + 显示模式 + 快捷键展示 + 🩺诊断
```
- 权限最小化：仅 `storage`；无 tabs/host_permissions（tabs.sendMessage 只用 tab.id 不需权限）。
- 适配器契约：每站 `{think, fast, state(), diagnose()}`；state/diagnose **只读不开菜单**。

## 适配器编写原则（实战沉淀）

- **模型名匹配语言无关**（Opus/Qwen/K2/GLM…），**UI 词必须中英双写**（`/Expert|专家/`、`/^(high|高)$/i`）；zh/en 之外不承诺，靠诊断兜底。
- 优先**结构/语义锚点**（data-testid、稳定 class、aria-label、aria-checked/pressed），文本是次选。
- **国产站常拒绝合成事件**（isTrusted=false 被忽略）：菜单项/radio/toggle 用**原生 `el.click()`**；国际站 Radix/Material 菜单用 pointer 事件序列 `openMenu()`。
- 站点常有**宽窄两种布局**（独立页 vs ~639px iframe）：Claude 窄屏是 Adaptive thinking 开关、宽屏是 effort 子菜单；Gemini 窄屏模型按钮无 aria-haspopup。适配器须双布局兼容。
- 有状态控件**先读后点**（幂等）；嵌套子菜单（Gemini Thinking level）需"未展开才点 + 轮询重试 + Enter+click 提交"。
- 文案可能含**零宽字符**（Claude "Max" 实为 4 字符）：用 contains 匹配，别用 `^...$` 配长度。

## 测试与调试（chrome-dbg 实战）

- 重载扩展：在 `chrome://extensions` 标签页执行 `chrome.developerPrivate.reload("<本仓unpacked ID>",{failQuietly:false})`；**重载后旧标签的 content script 变孤儿**，需刷新页面重注入。
- 验证快捷键链路：MV3 SW 休眠，reload 唤醒后 30s 内 CDP `Target.attachToTarget` 执行 onCommand 等价代码；物理按键→onCommand 无法合成，留人工。
- 广播验证 9 站：以 tab 打开 `popup.html`（扩展页有 tabs API），`chrome.tabs.query({})` + 逐 tab sendMessage（不依赖 SW 存活）。
- 仿真 iframe 窄屏：`Emulation.setDeviceMetricsOverride {width:639}`。
- **断言用生产逻辑**（`__AMS.getState()`/`_isOn()`），不要在测试 lambda 里重写正则——shell/python 转义会把 `\s` 变 `\\s`，产生"幽灵失败"（实战吃过亏）。
- chatglm.cn 加载极重：水合期（~30s）连扩展消息都无响应，安定后正常；新开标签+长等待。

## Git

- 提交用 git-commit skill（Conventional Commits、无 AI 署名）；仓库无 user 配置，用内联身份提交。
- `docs/superpowers/` 与 `.codegraph/` 已 gitignore（本地工作文档不入库）。
- 单文件 ≤300 行（JS）；超了按 intl/cn 之类职责拆分。
