---
name: PolyAsk · AI 众答
description: 经典 Mac OS 9 Platinum 机械工作台：立体、紧凑、利落的并排桌面界面
colors:
  accent: '#333399'
  on-accent: '#ffffff'
  accent-soft: '#ccccff'
  canvas: '#bfbfbf'
  surface-sunken: '#cccccc'
  panel: '#ffffff'
  surface-elevated: '#eeeeee'
  panel-muted: '#dddddd'
  field: '#ffffff'
  field-border: '#262626'
  border: '#8c8c8c'
  text: '#222222'
  muted: '#555555'
  success: '#15803d'
  warning: '#b45309'
  danger: '#b91c1c'
  success-ink: '#14532d'
  warning-ink: '#78350f'
  danger-ink: '#8f1818'
  success-soft: '#dcfce7'
  warning-soft: '#ffffcc'
  accent-dark: '#9e9eff'
  on-accent-dark: '#141428'
  accent-soft-dark: '#32325c'
  canvas-dark: '#18181c'
  surface-sunken-dark: '#141418'
  panel-dark: '#1f1f26'
  surface-elevated-dark: '#282831'
  panel-muted-dark: '#2d2d36'
  field-dark: '#17171d'
  field-border-dark: '#08080a'
  border-dark: '#484856'
  text-dark: '#ededf2'
  muted-dark: '#aaaab8'
  success-ink-dark: '#86efac'
  warning-ink-dark: '#fde047'
  danger-ink-dark: '#fca5a5'
  success-soft-dark: '#1a3628'
  warning-soft-dark: '#36331e'
typography:
  meta:
    fontFamily: '"Charcoal", "Lucida Grande", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: 11px
    fontWeight: 400
  control:
    fontFamily: '"Charcoal", "Lucida Grande", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: 12px
    fontWeight: 600
  body:
    fontFamily: '"Charcoal", "Lucida Grande", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: 13px
    fontWeight: 400
  reading:
    fontFamily: '"Charcoal", "Lucida Grande", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: 13.5px
    fontWeight: 400
    lineHeight: 1.56
  title:
    fontFamily: '"Charcoal", "Lucida Grande", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: 14.5px
    fontWeight: 700
  record-title:
    fontFamily: '"Charcoal", "Lucida Grande", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.42
  code:
    fontFamily: '"Monaco", "Cascadia Mono", "Consolas", ui-monospace, monospace'
    fontSize: 12px
    lineHeight: 1.5
rounded:
  control: 3px
  panel: 0px
  card: 0px
  toolbar: 3px
  inset: 2px
  chip: 0px
  popover: 0px
  overlay: 0px
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-5: 20px
  space-6: 24px
  space-8: 32px
  space-12: 48px
  space-16: 64px
components:
  button-send:
    backgroundColor: '{colors.panel-muted}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 0 9px
    height: 22px
  button-secondary:
    backgroundColor: '{colors.panel-muted}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 4px 10px
  button-ghost:
    backgroundColor: '{colors.panel-muted}'
    textColor: '{colors.text}'
    rounded: '{rounded.inset}'
    padding: '0'
    size: 22px
  field:
    backgroundColor: '{colors.field}'
    textColor: '{colors.text}'
    rounded: 0px
    typography: '{typography.body}'
  nav-segment:
    backgroundColor: '{colors.panel-muted}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 0 7px
  nav-segment-selected:
    backgroundColor: '#666666'
    textColor: '#ffffff'
    rounded: '{rounded.control}'
  status-badge:
    backgroundColor: '{colors.surface-elevated}'
    textColor: '{colors.muted}'
    rounded: '{rounded.chip}'
    padding: 0 4px
  status-badge-verify:
    backgroundColor: '{colors.warning-soft}'
    textColor: '{colors.warning-ink}'
    rounded: '{rounded.chip}'
    padding: 0 4px
  status-badge-final:
    backgroundColor: '{colors.success-soft}'
    textColor: '{colors.success-ink}'
    rounded: '{rounded.chip}'
    padding: 0 4px
  settings-card:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: '{rounded.panel}'
    padding: 16px 20px
  prompt-composer:
    backgroundColor: '{colors.field}'
    textColor: '{colors.text}'
    rounded: 0px
    height: 26px
  site-frame:
    backgroundColor: '{colors.surface-sunken}'
    textColor: '{colors.text}'
    rounded: 0px
  answer-section:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: 0px
    padding: 0 0 14px
    typography: '{typography.reading}'
---

# Design System: PolyAsk · AI 众答

## Overview

**Creative North Star: "Mac OS 9 Platinum 并排机械工作台"**

PolyAsk 采用原汁原味的 **Mac OS 9 Platinum** 桌面视觉体系（对标 `livid/exe-stats` 与 Apple Platinum HIG）：以 `1px` 利落黑框（`#262626`）、`2px` 硬投影、四层斜角凹凸按钮（凸起银灰常态 / `#666` 深炭压下选中态 / 下凹白底内容井）与 `2px` 水平细横纹标题条组织多站并排比较与高密度长文阅读。

**Key Characteristics:**

- **双模 Platinum 金属色阶**：亮色采用正宗 `#ccc/#ddd/#eee` 银灰桌面，暗色采用配套 Kaleidoscope / NeXT 风格深炭黑金属斜面，自动跟随系统 `prefers-color-scheme`。
- **克制的原生 Lavender 点缀**：经典蓝紫（`#333399` / `#ccccff` / `#9999ff`）严格限定在滚动条滑块、输入焦点外框、文本反白选区与列表/菜单当前选中项四处；所有按钮常态/悬停/按下与普通列表悬停一律保持纯粹中性银灰。
- **无边框自绘横纹主窗与独立站点小窗**：主窗口启用 `frame: false` 自绘 `22px` 横纹标题栏与 `13×13px` 立体窗口方块（`.tbox`，Win/Linux 居右、macOS 居左，窗口失焦时横纹退隐）；每个 AI 站点 `WebContentsView` 内缩 `3px` 嵌入带下凹内井的独立 `.tile-frame`，仅当前聚焦站点显示横纹。
- **干脆的 `0ms` 机械瞬切与高密度桌面排版**：按钮、分段页签与浮层全部采用 `0ms` 机械瞬切（仅工作台侧抽屉保留 `120ms` 推拉过渡）；结果库与历史详情收紧为 `13.5px / 1.56` 高密度技术文档排版。

本记录为当前单一主界面的权威规范（不维护双套并行主题）；原站网页拥有各自的视觉系统，不受外壳重新着色。

## Colors

中性银灰与立体高光/暗影斜面承担全部窗口、工具栏、按钮和表单结构；克制的经典 Lavender 承担焦点与当前选中定位；成功、警告和危险色各自表达运行状态。

### Primary

- **经典深靛蓝（`accent` / `accent-dark`）**：键盘焦点环、文本链接、菜单悬停反白底（配 `on-accent`）与列表选中左色轨。
- **薰衣草选中底（`accent-soft` / `accent-soft-dark`）**：文本 `::selection` 反白选区，以及结果库、历史记录、设置分类、命令面板的**当前选中行**。
- **三脊滚动条滑块（`--plat-scroll-thumb`）**：亮色 `#9999ff`、暗色 `#5c5c9e`，复刻 Mac OS 9 标志性三横脊立体滑块。
- **禁止泛紫规则**：普通按钮（含发送、采集并比较、重试、下一步）、未选中列表行悬停（`--hover-soft: #eeeeee` / `#2a2a33`）与站点档位徽标一律使用中性 Platinum 银灰/白底，不涂浅紫衬底。

### Neutral

| 语义 | 令牌 | 使用位置 |
| --- | --- | --- |
| 桌面画布 | `canvas` | 多站工作区灰桌面底面（亮 `#bfbfbf` / 暗 `#18181c`） |
| 窗体表面 | `surface-sunken` / `--plat-g400` | 窗口外框、侧抽屉、设置外围、对话框底板 |
| 工具条与按钮面 | `panel-muted` / `--plat-g300` | 命令栏、工具条、常态凸起按钮、表头与小窗顶栏 |
| 悬停提亮面 | `surface-elevated` / `--plat-g200` | 按钮悬停、代码块内底、内嵌提示卡 |
| 内容白井 | `panel` / `field` | 下凹列表井、正文阅读面板、文本输入框 |
| 墨线边框 | `field-border` / `--plat-ink` | 窗口、按钮、输入框与分隔条的 `1px` 实线边界 |
| 主文字与次级文字 | `text` / `muted` | 标题正文与来源、时间、辅助说明（保证 ≥4.5:1 对比度） |

高对比度偏好强化实线边界与状态标签轮廓；强制配色模式完整回退至系统 `Canvas`、`CanvasText`、`ButtonText`、`Highlight` 与 `HighlightText`。

### Status

`success`、`warning`、`danger` 用于方形状态指示点、流转微矩阵与危险按钮；文字使用各自的 `-ink` 令牌与明暗不透明柔和衬底（其中 `warning-soft` 采用经典 Mac 淡琥珀黄 `#ffffcc`）。决策状态在列表和详情共用三态方标：草稿为 `muted` 配 `--plat-g200`，待验证为 `warning-ink / warning-soft`，定稿为 `success-ink / success-soft`。

**The Paired Contrast Rule.** 菜单反白底色与文字色成对切换；主操作按钮（`.send`、`.primary`）采用银灰按钮面配高对比主文字色（对比度 >10:1），靠外圈双层黑框表达主次，不靠彩色填充区分。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/native-feel.css`。

## Typography

**UI and Body Font:** 优先 `"Charcoal", "Lucida Grande"` 并在各平台回退至 `"Segoe UI Variable"` / `-apple-system` / `system-ui` 与对应中日韩界面字体。

**Mono Font:** 代码小窗、快捷键 `<kbd>` 与原文核对区域使用 `"Monaco", "Cascadia Mono", "Consolas", ui-monospace`。

### Hierarchy

| 角色 | 前置令牌 | 适用位置 |
| --- | --- | --- |
| 辅助信息 | `meta` (`11px`) | 工具栏状态、时间戳、紧凑字数（设置页辅助说明保底 `12px`） |
| 控件文字 | `control` (`12px`) | 立体按钮、分段开关、菜单与表单标签 |
| 界面正文 | `body` (`13px`) | 提问输入框、列表标题与常规对话框说明 |
| 阅读正文 | `reading` (`13.5px / 1.56`) | 结果库与提问历史保存的长回答正文 |
| 区块标题 | `title` (`14.5px / 700`) | 设置分组卡标题与 Markdown 三级标题 |
| 记录标题 | `record-title` (`16px / 700`) | 结果库与历史详情问题主标题 |
| 代码 | `code` (`12px / 1.5`) | 1px 黑框等宽代码小窗与预格式化文本 |

Markdown 正文五、六级标题同为 `13px`，以 `700 / 600` 字重与颜色区分；首尾子块零额外外边距。表格采用 `1px` 硬黑框、单元格实线分隔与 `#ddd` 斜面高光表头；代码块包裹在带迷你 Platinum 顶栏与 `20px` 立体复制按钮的小窗中。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/markdown-reading.css`、`desktop/src/renderer/markdown-code.css`、`desktop/src/renderer/library-reading.css`。

## Layout

### Desktop Shell

最顶部常驻 `22px` 自绘横纹标题栏（`WINDOW_TITLEBAR_HEIGHT = 22`），其下为单行命令栏、多站桌面画布与 `26px` 底部状态栏（`WORKSPACE_FEEDBACK_HEIGHT = 26`）。所有几何常量集中在 `desktop/src/shared/display.ts` 单一真源：

| 指标 | 紧凑（`compact`） | 舒适（`comfortable`） |
| --- | --- | --- |
| 主窗口横纹标题栏 | `22px` | `22px` |
| 外壳命令栏高度 | `44px`（三行堆叠 `104px`） | `54px`（三行堆叠 `128px`） |
| 展开提问区的命令栏高度 | `112px`（堆叠 `176px`） | `132px`（堆叠 `212px`） |
| 站点小窗标题条高度 | `24px` | `30px` |
| 高频控件高度 | `26px` | `32px` |
| 图标操作最小目标尺寸 | `22px` | `26px` |
| 桌面外边距 / 站点窗间距 | `6px` / `8px` | `8px` / `10px` |
| `WebContentsView` 内缩（`TILE_FRAME_INSET`） | `3px` | `3px` |

命令栏按实际内容测量逐级收纳（`data-fit="1..4"`），始终保底提问输入框宽度 `>= 320px`，并保留「发送」与「结果库」可见文字。站点宫格维持单格最小 `380×210px` 自动聚焦保护，支持总览、对决（`50:50`）与聚焦三种排布。

### Library and Reading

结果库与历史详情共用 `820px` 阅读版心（内边距 `20px`）与顶部吸顶的立体分段切换 + 来源跳转条。结果库容器宽度 `>= 1320px` 时展示 `184px / 272px / 1fr` 三栏（文件夹井 / 记录列表井 / 详情阅读面），窄于 `1320px` 收起文件夹栏，窄于 `900px` 逐面切换。双列比较基于详情容器宽度响应，宽于 `1080px` 支持右侧同屏停靠证据槽。

### Settings and Overlays

设置工作区采用左侧 `204px` 白底列表导航井与右侧 `#cccccc` 桌面上的白底 `1px` 黑框分组卡（窄于 `760px` 切换为顶部 Platinum 双箭头下拉框）。分类标题 `18px`、卡片标题 `14.5px`、设置项 `13px`、说明与辅助信息不低于 `12px`。命令面板（最大宽 `700px`）、确认弹窗（最大宽 `420px`，带双外环模态框边）、准备任务（最大宽 `1060px`）与备份对照（最大宽 `1360px`）统一采用 `0px` 方角窗体与 `2px/4px` 硬投影。

来源：`desktop/src/shared/display.ts`、`desktop/src/main/workspace-layout.ts`、`desktop/src/renderer/styles.css`、`desktop/src/renderer/library.css`、`desktop/src/renderer/settings.css`。

## Elevation & Depth

**机械斜面凹凸 + 利落硬投影。** 摒弃现代高斯弥散阴影：容器层级靠 `1px solid #262626` 实框、内侧左上白高光 / 右下深灰暗角（`--plat-btn-bevel` / `--plat-sunken-bevel` / `--plat-window-bevel`）以及 `2px 2px 0 #262626` 硬边投影清晰表达“凸起按钮、下凹输入/列表井、浮动窗口”三层物理关系。

### Shadow Vocabulary

| 角色 | 令牌 | 用法 |
| --- | --- | --- |
| 四层凸起按钮斜面 | `--plat-btn-bevel` | 所有常态立体按钮、下拉触发器与分段未选中项 |
| 四层压下内凹斜面 | `--plat-btn-bevel-pressed` | `:active` 按下态与 `[aria-pressed="true"]` / `[aria-selected="true"]` 激活分段项 |
| 下凹内容井斜面 | `--plat-sunken-bevel` | 文本输入框、提问框、列表滚动井、代码与预览框 |
| 工具条上下切边 | `--plat-strip-bevel` | 命令栏、面板顶栏、设置顶栏与底部状态栏 |
| 窗口硬投影 | `--plat-window-shadow` | 站点小窗、命令面板、下拉菜单与各类模态对话框 |

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/platinum-widgets.css`。

## Shapes

- **窗口、面板、卡片、列表井、表格、代码块、状态方标与浮出菜单**：一律 `0px` 直角硬边。
- **独立立体按钮与下拉框**：`3px` 微切角（小号内嵌图标按钮 `2px`）；连体分段按钮组（`.mode-switch`、`.tier-switch`、`.page-tabs`、`.library-segments`）内部 `0px` 并以 `margin-left: -1px` 共用 `1px` 分隔黑边，仅首尾两端保留 `3px` 外角。
- **经典原生部件（`platinum-widgets.css`）**：`15px` 宽三横脊立体滚动条、右侧 `20px` 双箭头分隔井 `select`、`13×13px` 斜面方复选框 / 圆单选框，以及全局 `<details>/<summary>` 统一的 `11×11px` 金属立体折叠三角（禁用浏览器默认原始 `▶`）。
- **图标（`icons.tsx`）**：采用 `strokeLinecap="square"` 与 `strokeLinejoin="miter"` 利落折角线条；所有方形图标按钮显式声明 `padding: 0` 确保几何严格居中。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/platinum-widgets.css`、`desktop/src/renderer/composer.css`、`desktop/src/renderer/icons.tsx`。

## Components

### Buttons and Popup Menus

- **默认主按钮（Default Push Button，`.send` / `.primary`）**：复刻 Mac OS 9 HIG 默认按钮双层黑框外环（按钮自身 `1px` 黑框 + `2px` 灰槽 + `1px` 外黑环），面色维持银灰 `#ddd` 配高对比文字。
- **常规立体按钮**：`#ddd` 四层凸起斜面，仅在未激活且未按下的常态下悬停提亮至 `#eee`；按下或展开/激活（`:active`、`[aria-pressed="true"]`、`[aria-expanded="true"]`、`.active`）锁定为 `#666` 深炭内凹配白字，避免悬停覆盖激活底色；禁用态降不透明度并移除凹凸阴影。
- **跨视图 Platinum 弹出菜单（`platinum-popup-menu.ts`）**：顶栏自定义分组菜单、右上角「更多」菜单、跨站查找（`Ctrl+F`）溢出菜单与外壳输入框右键编辑菜单统一通过挂载在 `window.contentView` 最顶层的透明 `WebContentsView` 自绘（`#ddd` / `#353540` 斜面方框、双线凹槽分隔线、`#333399` / `#9e9eff` 悬停反白与纯等宽英文快捷键），既能盖住底层九个实时 AI `WebContentsView`，又不抢夺主窗口系统焦点导致标题栏横纹变灰。

### Inputs / Fields

下凹白底井（`1px` 黑框 + 左上 `#808080` 内阴影 + 右下外白边高光），同步覆盖 `#root` 与挂在 `document.body` 的全部 Portal 弹层（`.library-popover`、`.confirm-scrim`、`.backup-scrim`）。聚焦时边框与 `1px` 内环切换为 `--accent`；提问框由外层 `.prompt-composer` 统一承载下凹边框与聚焦环，右侧展开按钮 `padding: 0` 居中嵌套，鼠标点击提问框以外区域（含外壳工具栏及任意 AI 站点网页视图）自动收起并完整保留草稿、选区与滚动位置（框内拖选文字滑出边界或纯键盘切焦不误收）。

### Navigation

命令栏模式/档位/分页、工作台双页签、结果库分类及阅读模式切换统一采用连体 `.seg` 机械分段组，选中项以 `#666` 深底内凹白字表达。文件夹栏、记录列表与设置分类导航采用白底列表井内的薰衣草选中行 + `3px` 左侧强调色轨表达当前位置。

### Chips and Status

站点状态点、自动备份提示签、分页状态码与决策三态徽标统一采用 `1px` 黑框 `0px` 小方标；提示浮签（`.feedback-hint` / `.preview-badge`）采用经典 Mac 气球帮助淡黄底（`#ffffcc`）。

### Cards / Containers

设置分组、归档回答节、折叠帮助区与「旧版文字历史」（`.question-legacy`，在列表井内保持 `10px` 水平内缩与 `#ddd` 斜面折叠头）统一采用 `1px` 黑框直边容器。

### Site Frames and Reading Sections

每个打开的 AI 站点渲染为桌面上的独立 `.tile-frame` 窗口：仅当前聚焦站点（`data-focused="true"`）在标题栏展示 `2px` 水平细横纹，失焦站点退为纯银灰标题栏；容器窄于 `240px`（如 `960×680` 200% 缩放下的聚焦侧轨）自动隐藏次要徽标与横纹，保证操作按钮不裁切。

### Motion and Feedback

- **全面 `0ms` 机械瞬切**：按钮悬停/按下、分页切换（隐藏旧滑块指示器）、分段开关、下拉菜单、折叠三角旋转与提问框展开/收起均为 `0ms` 即时响应。
- **唯一保留过渡**：左侧 `.workspace-drawer` 指针开合保留 `120ms` 利落推拉；键盘触发及 `prefers-reduced-motion: reduce` 下同样为 `0ms`。

### Long Reading Layout

超长回答与多段比较列继续保留 `content-visibility: auto` 按需排版、会话高度记忆与吸顶导航精确锚点避让。

### Markdown Export Selection

导出选择弹窗采用 Platinum 模态框、白底下凹记录选择井与 `#666` 按下态站点筛选钮，保留部分选中（`mixed`）虚线短横语义、100 条 / 64 MiB 限额提示与失败就地恢复。

### Actions and State Copy

三语术语（保存 / 复制 / 导出）、空态指引与无障碍名称完全保留既有语义契约。

## Do's and Don'ts

### Do:

- **Do** 保持按钮与工具栏纯粹中性银灰，把 Lavender 严格留给滚动条、焦点环、文本选区与当前选中列表项。
- **Do** 方形图标按钮一律声明 `padding: 0`，折叠区域一律走 `platinum-widgets.css` 立体金属三角并留足内边距。
- **Do** 修改顶栏、底栏、标题栏或内缩尺寸时同步更新 `shared/display.ts` 与 `main/workspace-layout.ts`。

### Don't:

- **Don't** 向第三方 AI 站点 `WebContentsView` 注入外壳样式，或使用圆角胶囊/高斯模糊阴影破坏 Platinum 机械统一感。
- **Don't** 在高频按钮、分页切换或菜单上添加渐变缓动动画。
- **Don't** 裸露浏览器默认 `<summary>` 原始黑三角或未重置 `appearance` 的表单控件。

### Settings and Site Participation

八类设置分区、模型预设读写保护、站点参与勾选与页面关闭分离、`48px` 跨站查找条及阅读局部动作均完整保留既有键盘流、输入法合成态保护与无障碍树契约。
