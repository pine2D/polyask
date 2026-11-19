---
name: polyask-electron
description: 在 PolyAsk 仓库升级 Electron、实现桌面原生功能，或验证多 WebContentsView 的生命周期、性能与跨平台行为时使用。
---

# PolyAsk Electron 开发

先确认当前目录是 PolyAsk，读取仓库 `CLAUDE.md`（或优先存在的 `AGENTS.md`）和 `desktop/AGENTS.md`。依据任务选择下列路径，不要求每次执行全部流程。

## 契约入口

- 视图、IPC、数据、同步与错误码：`docs/desktop.md`。
- 注入、提交、切档、图片或站点改版：`docs/adapters.md`。
- 原生检查、测试资源边界、真实档案与平台限制：`docs/verify.md`。
- 打包、Fuse、三语词条、签名与发布条件：`docs/release.md`。

文档和实际代码共同决定行为；不要把旧实测结论套用于新的 Electron 版本。群发 deadline、取消 epoch、提交不确定时不自动重发、墓碑删除和诊断内容边界以仓库契约为准。

## 升级 Electron

1. 从 `desktop/package.json` 和 lock 取得基线，查看对应版本的官方发布说明与 breaking changes。优先评估当前主版本的维护版本；尊重本机包管理器的发布冷静期，不擅自清除配置。
2. 核对 `desktop/forge.config.ts` 的 Fuse 与打包平台，特别是 Cookie 加密。裸开发版 Electron 和发行版的 Fuse 可能不同；验证前禁止直接打开原有用户档案。
3. 检查 lock 的实际差异，仅保留任务需要的升级。按改动执行 `npm test`、`npm run typecheck`、根目录 `bash scripts/verify.sh`，再做打包和原生检查。
4. 把升级包的验证结果与 Windows/macOS、真实站点、睡眠/唤醒、通知中心的未测项分开报告。升级依赖不等于完成发行包验收，也不授权推送或发布。

## 原生功能与生命周期

- IPC 只暴露意图和有限结构，经过已有 `trustedShell`；不从 renderer 接收任意 HTML、路径或 Electron API。
- 对窗口关闭、本机重置、记录删除、取消和迟到回调使用已有生命周期失效机制；每个资源都要有清理责任方。
- 全局快捷键只注销本功能持有的注册；通知 API 支持、调用成功和操作系统确认显示是不同状态；PDF 临时视图不得访问网络或复用登录 session。
- 新设置先决定本机/同步/备份边界，再核对 repository、同步投影、重置和新增 fixture。沿用已存在的文案与三语资源，不在系统错误字符串上做产品判断。
- 从 `desktop/` 运行专项：`npm run test:unit -- test/<name>.test.ts`；原生 `.check.ts` 同样经 `test:unit`。其它原生脚本使用 `node scripts/test-safe.mjs command ...`。Linux 必须有整组 cgroup 限额，不能用裸 Electron 绕过。
- 使用新建临时档案和本地合成页面起步。只有已获授权且 Cookie Fuse 匹配时才用既有测试档案。真实站点发送属于外部动作，不能从“做回归”推断许可。

## 跨层 UI 与 WebContentsView 同步不变量

PolyAsk 主界面横跨「Renderer CSS → Renderer TS 状态/Portal → Main `WebContentsView` 原生几何/弹出层」三层，改任一层必须同步闭合其余两层（由 `desktop/test/ui-guidelines.test.ts` 自动守卫）：

- **动效时长双端锁死**：`src/renderer/composer.css` 与 `panel-motion.css` 的过渡时长必须与 `src/renderer/motion.ts`（`COMPOSER_EXIT_MS`、`PANEL_EXIT_MS`）1:1 相等，严禁一端改 `0ms` 另一端留旧毫秒数导致原生视口延后释放。
- **顶栏/内缩单真源与同帧提交**：主窗自绘标题栏（`WINDOW_TITLEBAR_HEIGHT`）、命令栏开合（`shellHeightForComposer`）与站点窗框内缩（`TILE_FRAME_INSET`）统一取自 `src/shared/display.ts`；展开与收起均经 `useLayoutEffect` 预提交 IPC 并与主进程 `polyask:layout` 同帧切换（`use-workspace-motion.ts`），消除 DOM 与 `WebContentsView` 之间的空隙帧或遮挡帧。
- **跨视图浮层与 Portal 全覆盖**：外壳 DOM `z-index` 盖不住子 `WebContentsView`，跨视图菜单一律走 `src/main/platinum-popup-menu.ts`（禁调系统原生 `Menu.popup()`）；基础表单与滚动条样式统一用 `:is(#root, body)` 作用域，自动覆盖全部 `createPortal(..., document.body)` 弹层；带激活态的按钮 `:hover` 必须显式排除 `[aria-expanded="true"]`、`[aria-pressed="true"]`、`[aria-selected="true"]` 与 `.active`。
- **按需原生 `.check.ts` 必跑映射**（`npm test` 不自动收集 `*.check.ts`，触及对应模块必须显式补跑）：
  - 动提问框开合、外部点击收起或工作台几何：`test/workspace-motion-native.check.ts`、`test/composer-session-native.check.ts`、`test/composer-activation-native.check.ts`。
  - 动跨站查找或跨视图弹出菜单：`test/site-find-native.check.ts`。
  - 动表单控件、任务准备、星标或多段证据：`test/form-surface-native.check.ts`、`test/task-setup-native.check.ts`、`test/stars-native.check.ts`、`test/multi-evidence-native.check.ts`。
- **跨视图截图核验**：Electron `BrowserWindow.capturePage()` 仅截取 `win.webContents`，不包含子 `WebContentsView` 或顶层透明菜单视图；核验跨视图菜单或原生视口贴合度时须截取合成画面（如 Linux Xvfb 下 `import -window root`）。

## 性能与自动化

- 先记录九站、当前分页、后台生成、最小化/遮挡的基线，再判断问题在主进程、renderer 或站点。没有稳定收益证据，不默认启用后台节流或引入 worker/utilityProcess。
- 保留现有绘制恢复机制，测量时注明 Electron 版本、平台、缩放、页面状态和样本时长。区分“窗口能恢复显示”与“后台仍能可靠提交”。
- 如环境已有 `agent-browser`，先核对版本及 `agent-browser skills get electron`，仅连接本机开发实例的临时 CDP 端口。Playwright Electron 支持情况须核对当前文档及启动 Fuse；不得为自动化降低生产 Fuse。
- 优先复用仓库原生夹具、生产组件及真实 IPC，不让仅有桩的测试冒充操作系统投递、物理热键或睡眠验收。测试结束核对所观察进程退出、临时档案清理和调试端口关闭。

## 交付

报告实际变更、执行过的检查、适用平台与未验证项。涉及用户可见行为时维护 `CHANGELOG.md` 未发布段及对应契约；本地提交按仓库约定，发布另依用户授权。
