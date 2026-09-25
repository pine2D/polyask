# PolyAsk 项目级 Native Feel

技能安装在 `.agents/skills/native-feel-cross-platform-desktop/`，仅用于本仓库开发，不是 Desktop 运行依赖。上游 MIT LICENSE 随安装保留。固定来源见 `installation.json`；安装载荷可重建并由 Git 忽略。

恢复安装：使用 Codex `skill-installer` 的 `install-skill-from-github.py`，指定 `--repo yetone/native-feel-skill --ref 9bd88c6378e1a80a4da165f3ee7bebb761a74945 --path . --name native-feel-cross-platform-desktop --dest <仓库根>/.agents/skills --method download`。不要使用默认全局路径或默认分支；确认 `SKILL.md`、`references/`、`checklists/`、`LICENSE` 均在。已有安装先核对，不覆盖。

后续会话可自动发现；当前会话可直接读取 `SKILL.md`。按问题加载相关 reference。

## 本项目适用边界

- 采用 T3（遵循平台习惯）、T7（保留操作记忆）：原生窗口、系统菜单、编辑右键菜单、系统字体、键盘操作与系统辅助偏好优先。
- 保留 Electron、九站 WebContentsView、靛蓝品牌、应用内设置与确认层、底部反馈和无自动更新的发布承诺。此技能不是迁移四运行时架构或新增遥测的授权。
- 上游是观点与经验集合，不是操作系统规范。例如其关于 Electron 无法使用 vibrancy/acrylic 的断言与 Electron 官方 API 不符；绿按钮行为、性能预算、通知形式也需按产品与平台核实。
- 不将九个真实 AI 页面套用启动器的 500 MB 内存目标；不将上游 75 项中不适用的项目算作缺陷，也不降低辅助功能验收要求。

## 调研依据与取舍（2026-09-25）

- [Electron application menu](https://www.electronjs.org/docs/latest/tutorial/application-menu)：macOS 使用应用菜单的 services/hide/hideOthers/unhide，设置只放应用菜单，窗口菜单保留 zoom/front；Windows/Linux 保留现有菜单与绑定。
- [Electron context menu](https://www.electronjs.org/docs/latest/tutorial/context-menu)：Electron 默认没有右键菜单。仅为本地外壳添加基于编辑能力的原生角色菜单，远程站点保持自身行为。
- [Electron nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)：建窗及主题变更时同步背景，关闭窗口移除监听；不是启动耗时或零闪烁的性能承诺。
- [Microsoft 对话框规范](https://learn.microsoft.com/en-us/windows/win32/uxguide/win-dialog-box)、[GNOME 对话框规范](https://developer.gnome.org/hig/patterns/feedback/dialogs.html)：Windows 确认在取消之前，macOS/Linux 保留确认在右；直接调整 DOM 顺序，使 Tab 与视觉顺序一致，破坏性操作仍默认聚焦取消。
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)：确实支持 vibrancy 和 Windows 11 22H2+ 的系统材质。本轮不引入透明视图，避免改变多站原生视图合成及既有可读性。

原生字体、输入法候选窗、系统菜单角色、Snap/Spaces、多屏与屏幕阅读器仍需在对应系统实机验收。Linux 下的平台分支和合成界面测试不能替代 Windows/macOS 原生验收。
