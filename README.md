# PolyAsk · AI 众答

一个问题，群发给多个 AI，**真实窗口同屏并排**对比答案；并能在每个站点一键切换「深度思考 / 快速模型」。Chrome 扩展（MV3）。

> 不是 iframe 聚合：每个 AI 都在你**已登录的真实标签页/窗口**里运行，不受站点反内嵌限制、不丢登录态、不被降级模型。

## 两大功能

### 🗂 统一对话多个 AI（广播控制台）

点扩展图标 →「🗂 打开广播控制台」，弹出顶部细条控制台：

- **勾选**要参与的 AI 站点（默认 Claude / ChatGPT / Gemini）
- **开启并平铺**：为每个选中站点开（或复用）真实窗口，同屏等分并排（≤4 站单排、≥5 站网格），控制台条始终置顶
- **发送到全部**：输入框打一个问题，群发到所有选中站点，自动填入并提交
- **发送前统一设档**：🧠 深度思考 / ⚡ 快速 / 不变
- **批量窗口管理**：全部新会话、全部恢复并置顶、全部最小化、关闭全部
- 每站一个状态点（绿=成功 / 红=失败 / 灰=进行中）

> 窗口按 id 绑定：从平铺窗口点链接另开到主浏览器窗口时，不会被误纳入平铺/置顶。「全部新会话」对已在新会话入口的窗口跳过重载（不闪、不丢草稿）。

### 🧠⚡ 模型档位切换

访问支持的 AI 站点时，页面顶部居中出现悬浮胶囊 `[🧠 思考 | ⚡ 快速]`，点击或按快捷键即可切换模型/思考档，无需在层层菜单中手动选择。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Opus 4.8（Thinking 开 + Effort Max） | Opus 4.8（Thinking 关 + Effort Low） |
| ChatGPT (chatgpt.com) | Intelligence 最高档（超高 / Pro 扩展） | Intelligence 最低档（极速 Instant） |
| Gemini (gemini.google.com) | 3.1 Pro + Thinking: Extended | 3.5 Flash |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen Max + 思考开 | Qwen 快速档 + 思考关 |
| Kimi (kimi.com) | K2 Thinking | K2 Instant |
| 元宝 (yuanbao.tencent.com) | Deep Thinking 开 | Deep Thinking 关 |
| 智谱清言 (chatglm.cn) | 思考开 | 思考关 |

> 站点 UI 改版可能导致个别适配失效；适配逻辑集中在 `content/adapters-intl.js`（国际站）与 `content/adapters-cn.js`（国内站），按文本/语义属性匹配，UI 词支持中英双语界面（其他语言不保证）。
> 怀疑失效时：扩展图标 →「🩺 诊断当前站点」，逐项检查控件是否仍能找到（只读、零副作用）。

## 安装

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 点「加载已解压的扩展程序」，选择本仓库目录

## 快捷键

| 默认键 | 功能 |
|---|---|
| `Alt+T` | 切换到深度思考 |
| `Alt+Y` | 切换到快速模型 |

焦点在输入框时同样生效。改键：`chrome://extensions/shortcuts`。

## 悬浮控件（三种显示模式）

点扩展图标打开 popup 可切换，实时生效：

| 模式 | 行为 |
|---|---|
| 贴边把手（默认） | 顶部中央一条细把手，悬停/点击展开胶囊，4 秒后自动收回 |
| 始终显示 | 胶囊常显，闲置 4 秒半透明 |
| 隐藏 | 页面零渲染，仅快捷键与 popup 按钮可用 |

- 展开时高亮当前站点所处档位（🧠 或 ⚡）
- 切换失败自动重试一次；成功后焦点自动回到输入框
- Shadow DOM 隔离，不受站点样式影响；结果以顶部 toast 提示

## popup

扩展图标弹窗：🧠/⚡ 切换按钮、**🗂 打开广播控制台**、悬浮控件显示模式、🩺 诊断当前站点、当前快捷键与改键入口。

## 结构

```
manifest.json            MV3：content_scripts + commands + background
background.js            快捷键转发 + 广播控制台编排（开窗/平铺/群发/窗口管理）
content/core.js          DOM 工具、toast、适配器注册表、runMode、群发注入
content/adapters-intl.js 国际站切换逻辑（Claude / ChatGPT / Gemini）
content/adapters-cn.js   国内站切换逻辑（DeepSeek / 豆包 / 千问 / Kimi / 元宝 / 智谱）
content/pill.js          悬浮胶囊 UI
console/                 广播控制台（细条窗口 UI）
popup/                   扩展弹窗
```

## License

MIT
