# PolyAsk 项目级 Interface Polish

`make-interfaces-feel-better` 安装在 `.agents/skills/make-interfaces-feel-better/`，仅用于本项目开发，不是 Desktop 运行依赖；没有全局安装或新增 npm 依赖。固定来源见 `installation.json`，上游根目录 MIT LICENSE 随安装保留。

恢复安装：使用 Codex `skill-installer` 的 `install-skill-from-github.py`，指定 `--repo jakubkrehel/make-interfaces-feel-better --ref 35545ea1512ad59fa463e6b1f95ca9c052981fe6 --path skills/make-interfaces-feel-better --dest <仓库根>/.agents/skills --method download`，并从同一 revision 复制根目录 `LICENSE` 到技能目录。已有安装先核对，不覆盖。技能载荷由 Git 忽略，来源与恢复说明入库。

后续会话可自动发现；当前会话可直接读取 `SKILL.md`。按问题加载 typography、surfaces、animations、icons、performance 参考。

## 本项目取舍

- 沿用 React 与普通 CSS，保留现有主题令牌、系统字体、三语和原生平台规则。
- 高频操作采用即时静态反馈；不为发送/取消、切档或选站添加缩放、错峰进入、模糊图标或额外等待。鼠标分页已有的可中断底板过渡保留，键盘及减少动态效果即时切换。
- 上游 40/44px 点击区建议不覆盖本项目紧凑/舒适密度的 24/32px 标题栏契约；不得以重叠伪元素扩大热区或侵占 WebContentsView。
- 保留表示结构、选中与焦点的边框；缩略图可使用不占布局的中性内描边。现有统一 SVG 图标使用 currentColor，不引入第二套图标。
- 数字对齐用于动态计数；排版优化只作用于短说明，不给 AI 长回答与代码统一添加平衡换行。
- macOS 字体平滑效果须原生实机比较后再调整；Linux 媒体模拟不算 macOS 观感验收。

检查按 full 模式覆盖上述外壳范围，包含实际鼠标/键盘状态、10% 速度回放及减少动态效果；九站网页内容不属于本技能的 CSS 修改范围。一次性审查记录与截图只放忽略目录或临时目录。
