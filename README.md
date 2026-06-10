# AI Model Switcher

一键在「深度思考」与「快速模型」之间切换的 Chrome 扩展（MV3）。访问支持的 AI 聊天站点时，页面顶部居中出现悬浮胶囊 `[🧠 思考 | ⚡ 快速]`，点击或按快捷键即可切换模型/思考档，无需在层层菜单中手动选择。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Opus + 思考最高档 | Sonnet |
| ChatGPT (chatgpt.com) | Intelligence: High | Intelligence: Medium |
| Gemini (gemini.google.com) | Pro + Thinking: Extended | Flash |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen Max + 思考开 | Qwen 快速档 + 思考关 |
| Kimi (kimi.com) | K2 Thinking | K2 Instant |

> 站点 UI 改版可能导致个别适配失效；适配逻辑集中在 `content/adapters.js`，按文本/语义属性匹配，便于修复。

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

扩展图标弹窗内含 🧠/⚡ 切换按钮（胶囊隐藏时的鼠标入口）、显示模式设置、当前快捷键与改键入口。

## 结构

```
manifest.json     MV3：content_scripts + commands + background
background.js     快捷键 → 活动标签消息转发
content/core.js   DOM 工具、toast、适配器注册表、runMode
content/adapters.js  各站点切换逻辑
content/pill.js   悬浮胶囊 UI
```

## License

MIT
