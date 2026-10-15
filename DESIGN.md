---
name: PolyAsk · AI 众答
description: 并排的工作台：克制、清晰、紧凑的桌面界面
colors:
  accent: '#4f46e5'
  on-accent: '#ffffff'
  accent-soft: '#eeedff'
  canvas: '#f4f5f8'
  panel: '#ffffff'
  panel-muted: '#edeef3'
  field: '#fafafd'
  border: '#d8dae2'
  text: '#20212b'
  muted: '#626575'
  success: '#16a34a'
  warning: '#ca8a04'
  danger: '#dc2626'
  success-ink: '#167039'
  warning-ink: '#875900'
  danger-ink: '#b91c1c'
  success-soft: '#e8f5ed'
  warning-soft: '#fff4dc'
  accent-dark: '#a5a0ff'
  on-accent-dark: '#201d41'
  accent-soft-dark: '#2d2a50'
  canvas-dark: '#17171c'
  panel-dark: '#222228'
  panel-muted-dark: '#2c2c35'
  field-dark: '#1b1b22'
  border-dark: '#3e3e4a'
  text-dark: '#f0f0f5'
  muted-dark: '#b0b0c0'
  success-ink-dark: '#86d9a3'
  warning-ink-dark: '#efc267'
  danger-ink-dark: '#fca5a5'
  success-soft-dark: '#1e392c'
  warning-soft-dark: '#3c3220'
typography:
  meta:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Sarasa
      UI SC", sans-serif
    fontSize: 12px
    fontWeight: 400
  control:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Sarasa
      UI SC", sans-serif
    fontSize: 13px
    fontWeight: 400
  body:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Sarasa
      UI SC", sans-serif
    fontSize: 14px
    fontWeight: 400
  reading:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Sarasa
      UI SC", sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.8
  title:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Sarasa
      UI SC", sans-serif
    fontSize: 16px
    fontWeight: 700
  record-title:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Sarasa
      UI SC", sans-serif
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.5
  code:
    fontFamily: ui-monospace, "Cascadia Code", monospace
    fontSize: 13px
    lineHeight: 1.7
rounded:
  control: 6px
  panel: 8px
  toolbar: 7px
  inset: 5px
  chip: 4px
  popover: 9px
  overlay: 12px
spacing:
  space-1: 4px
  space-2: 8px
  space-4: 16px
components:
  button-send:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.toolbar}'
    padding: 0 10px
    height: 32px
  button-secondary:
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    padding: 6px 12px
  button-ghost:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    rounded: '{rounded.control}'
    padding: '0'
    size: 24px
  field:
    backgroundColor: '{colors.field}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    typography: '{typography.body}'
  nav-segment:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    rounded: '{rounded.inset}'
    padding: 4px
  nav-segment-selected:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.accent}'
    rounded: '{rounded.inset}'
  status-badge:
    backgroundColor: '{colors.panel-muted}'
    textColor: '{colors.muted}'
    rounded: '{rounded.chip}'
    padding: 2px 6px
  status-badge-verify:
    backgroundColor: '{colors.warning-soft}'
    textColor: '{colors.warning-ink}'
    rounded: '{rounded.chip}'
    padding: 2px 6px
  status-badge-final:
    backgroundColor: '{colors.success-soft}'
    textColor: '{colors.success-ink}'
    rounded: '{rounded.chip}'
    padding: 2px 6px
  settings-card:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: '{rounded.panel}'
    padding: 20px 24px
  prompt-composer:
    backgroundColor: '{colors.field}'
    textColor: '{colors.text}'
    rounded: '{rounded.control}'
    height: 32px
  site-frame:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: 6px 6px 2px 2px
  answer-section:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: '0'
    padding: 16px 0 24px
    typography: '{typography.reading}'
---

# Design System: PolyAsk · AI 众答

## Overview

**Creative North Star: "并排的工作台"**

多个 AI 页面与整理工具各就其位。外壳保持克制、清晰、紧凑，为站点原网页和保存的回答留下主要阅读空间；高频操作集中在工具栏，站点管理按需展开，结果库为整理和长文阅读提供独立空间。

现有设计以靛紫强调色和冷灰底色建立一致性。系统字体、小幅圆角、细边界和轻微阴影让控件精确、轻巧，操作反馈清楚。工具区域紧凑，阅读区域以更大的字号和行距展开；两者共享同一套主题与状态语义。

**Key Characteristics:**

- 单一靛紫强调色，配合明暗两套冷灰表面。
- 工具控件紧凑，阅读正文舒展，按区域调整密度。
- 平整为主，轻微阴影辅助分层。
- 选中、焦点、禁用与异常各有明确表现，状态同时提供文字与可访问名称。
- 保留桌面系统字体和偏好，使用同一套跨平台界面语言。

本记录提取现有实现，描述用语经用户确认。令牌表是当前默认值的快照；修改实现时同步维护本文件，不将其视为第二套独立主题。具体源码来源在各节注明。原站网页拥有自己的视觉系统，不受本文件重新着色。

## Colors

靛紫承担操作和选择，冷灰承担表面与阅读层级，成功、警告和危险色各自表达状态。前置令牌保留源码名称；带 `-dark` 后缀的条目对应同一 CSS 变量在暗色主题下的值，不是需要新增到应用的变量。

### Primary

- **靛紫强调色**（`accent` / `accent-dark`）：发送、主要确认、活动导航、选中标记、链接和焦点。
- **强调色上的文字**（`on-accent` / `on-accent-dark`）：与强调色成对切换，尤其是暗色主题的浅紫按钮。
- **浅靛紫衬底**（`accent-soft` / `accent-soft-dark`）：悬停、收藏、选中导航和局部标记。
- 弱选中底由强调色与面板混合（5%）；通用悬停底由次级文字色与面板混合（7%）。沿用源码公式，不另建近似色。
- 结果库当前记录使用完整强调色轮廓与浅靛紫底，在悬停时保持选中反馈；可见轮廓与 `aria-current` 一同表达当前项。

### Neutral

| 语义 | 令牌 | 使用位置 |
| --- | --- | --- |
| 冷灰画布 | `canvas` | 工作区底面、设置页外围 |
| 阅读面板 | `panel` | 工具栏、侧栏、设置分组、记录正文 |
| 次级表面 | `panel-muted` | 只读内容、次级状态和层级区分 |
| 输入底色 | `field` | 搜索框、表单、统一提问框 |
| 细边界 | `border` | 分隔线、轮廓、表格与面板边缘 |
| 主文字 | `text` | 标题、正文、当前操作 |
| 次级文字 | `muted` | 来源、时间、说明和未选中动作 |

这些角色均有暗色对应值。高对比度偏好增强边界；强制配色使用系统 Canvas、CanvasText、Highlight 与 HighlightText 等角色。

### Status

`success`、`warning`、`danger` 用于圆点、进度和语义色块；正文使用各自的 `-ink` 令牌及暗色对应值。进度、异常与选中不能仅靠颜色区分，保留文字、图形或读屏播报。

决策状态在列表和阅读详情共用配色：草稿为中性文字与次级表面，待验证用 `warning-ink / warning-soft`，定稿用 `success-ink / success-soft`。柔和状态底为明暗主题分别定义的不透明色，只用于带文字的状态标签；颜色表示用户选择的工作流状态，保留人工整理与核实说明，不代表内容已经验证。系统增加对比度时补标签轮廓，强制配色使用系统文字与画布。

**The Paired Contrast Rule.** 强调底色与其文字色成对使用；状态圆点色与状态文字色分别取值。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/native-feel.css`。

## Typography

**UI and Body Font:** 使用源码的系统字体栈，由 Windows、macOS、Linux 覆盖为当地系统习惯；不加载品牌展示字体。

**Mono Font:** 代码与原文核对区域使用等宽字体，正文和界面标签继续使用系统 UI 字体。

**Character:** 工具区使用小字号和适度加粗，保持命令与状态容易扫描。阅读区通过字号、行距、段落和标题建立层级，不把工具栏的密度直接套到回答正文。

### Hierarchy

| 角色 | 前置令牌 | 适用位置 |
| --- | --- | --- |
| 辅助信息 | `meta` | 时间、来源、状态说明 |
| 控件文字 | `control` | 工具栏、表单控件和设置说明 |
| 界面正文 | `body` | 结果库列表、输入和普通内容 |
| 阅读正文 | `reading` | 保存回答，行高（1.8） |
| 区块标题 | `title` | 设置卡与回答来源标题；局部权重以组件为准 |
| 记录标题 | `record-title` | 结果库记录主标题，窄详情区使用较小变体 |
| 代码 | `code` | 等宽代码区域；原文核对编辑器另按所在组件定字号 |

这是按用途组织的字号集合，没有固定的等比缩放比例，也没有应用中不存在的超大展示层级。正文三级标题使用（20px / 1.5），四级标题使用（17px / 1.6）；五、六级标题同为（16px），以（700 / 500）字重区分，实际字形跟随系统字体可用字重。段落间距（12px），记录主标题在窄详情区降为（21px）。比较正文保留（15px / 1.8），决策结论保留（18px / 1.7）。

历史、结果库和决策卡共用的 Markdown 段落、列表、引用限制在（75ch）以内，随可用宽度缩小；不设最小行宽。`ch` 随当前字体与字号度量，中文仍按全角字自然换行。表格、代码、公式和图示可使用所在区域的完整宽度，保留局部滚动与完整内容。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/native-feel.css`、`desktop/src/renderer/markdown-reading.css`、`desktop/src/renderer/library-reading.css`。

## Layout

### Desktop Shell

顶部为单行命令栏，下方为原生站点视图及其窄标题条，侧栏按需展开。工作台宽度（320px）。布局与站点矩形由主进程和共享显示契约共同决定，不能仅用 CSS 改出另一套几何。

| 指标 | 紧凑 | 舒适 |
| --- | --- | --- |
| 外壳工具栏高度 | 52px | 64px |
| 展开提问区的外壳高度 | 120px | 144px |
| 站点标题条高度 | 24px | 32px |
| 高频控件高度 | 32px | 40px |
| 图标操作目标尺寸 | 24px | 32px |
| 站点外边距与间隔 | 4px | 8px |

前置间距令牌记录已有的（4px、8px、16px）；（12px、20px、24px、32px）等是相应组件的现有局部间距，不虚构为一套完整的全局比例尺。

命令栏依据实际内容测量逐级收纳，尽量为提问框保留（320px）；先收文字和快捷键提示，再改变次级动作的入口。不同语言、密度和缩放下的收纳时机不同，不用单个固定窗口宽度替代测量。

结果库在收纳级别 0–1 保留图标与文字，级别 2–3 改为图标，级别 4 由“更多”菜单的具名动作承接。布局按钮的无障碍名称独立于可见文字，自动聚焦原因只作辅助提示。

站点宫格以每格最小宽（380px）、最小高（210px）判断是否自动转入聚焦布局；页容量和排列以共享站点分页契约为准。站点原网页的缩放与外壳密度独立。

### Library and Reading

结果库宽窗为“任务文件夹 / 内容列表 / 详情”的三栏结构，默认列宽（200px / 300px / 剩余宽度）。窗口不超过（1200px）时收起文件夹栏，常规列表列宽改为（280px）；不超过（760px）时按列表或详情逐面显示，并保留返回路径。专注阅读可以隐藏前两栏。

详情正文最大宽度（820px），常规内边距（24px 32px 64px）。双列比较基于详情容器宽度收纳，不只看窗口：容器不超过（820px）时减小间距，不超过（760px）时改为单列，不超过（480px）时来源导航改为横向滚动。

阅读面切换与来源导航作为一组吸顶，换行时自然增加高度，避免互相覆盖；来源跳转与键盘滚动按该组的实际高度避让。每份回答的来源标题与“标为最佳 / 追问”同行，空间不足时动作组换行，组内间距（8px），与正文间距（16px）。正文首尾不叠加块级外边距，内部段落（12px）和章节（24px）的节奏保留；比较段落由外层留白组织，避免每块重新带入段前段后间距。

进入比较时，详情容器不超过（760px）则复用专注阅读展开，保留“返回浏览”；来源、筛选和阅读位置沿用当前会话。返回浏览后及单纯调整窗口大小时不再次自动展开。未保存的备注仍经过导航确认。

比较标题与返回动作并排，说明留在标题下方；详情容器不超过（480px）时回到单列顺序，保留动作文字与完整说明。

### Settings and Overlays

设置正文围绕（1040px）的内容宽度居中，常规外围与组间距（24px），卡片内边距（20px 24px）。不超过（760px）时外围和卡片改为（16px），行内操作移到说明下方；不超过（560px）时事实列表等进一步堆叠。分区导航保持单行滚动与吸顶。

命令面板最大宽（720px），确认框最大宽（440px），均受当前窗口约束。页面根区域固定到窗口，滚动归各内容区域负责。

来源：`desktop/src/shared/display.ts`、`desktop/src/main/layout.ts`、`desktop/src/renderer/styles.css`、`desktop/src/renderer/toolbar-fit.ts`、`desktop/src/renderer/library.css`、`desktop/src/renderer/library-reading.css`、`desktop/src/renderer/settings.css`。

## Elevation & Depth

**平整为主，轻微阴影辅助分层。** 日常区域靠底色、细边界和留白分开；输入框用紧贴边缘的阴影和聚焦底线提示可编辑性，分段控件的选中项略微抬起。较大的阴影用于命令面板、确认框和结果库浮出菜单。长文、来源段落与比较列保持平整，避免每段再套一张浮起的卡片。

### Shadow Vocabulary

| 角色 | 规范位置 | 用法 |
| --- | --- | --- |
| 控件轻影 | sidecar `shadow-control` | 分段控件的当前项，明暗主题各有值 |
| 输入常态影 | sidecar `field-shadow` | 文字输入及提问框容器 |
| 输入聚焦影 | sidecar `field-focus-shadow` | 与输入内底线组合，明暗主题分别取值 |
| 命令面板影 | sidecar `command-palette` | 独立命令面板 |
| 确认框影 | sidecar `confirm-dialog` | 遮罩上的确认内容 |
| 菜单影 | sidecar `library-popover` | 结果库浮出菜单和选择列表 |

精确阴影值放在 `.impeccable/design.json`，不扩展前置令牌的格式。原生站点视图的层序不是 CSS 阴影或 z-index 能解决的问题，覆盖面须沿用已有视图隐藏与恢复流程。

**The Flat Reading Rule.** 回答、摘录和比较段落主要用间距与分隔线组织，延续结果库已有的平整阅读面。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/styles.css`、`desktop/src/renderer/library.css`、`desktop/src/renderer/library-reading.css`。

## Shapes

小幅圆角、规整矩形和细边界构成基础语言。前置圆角令牌分别记录源码中重复出现的控件、面板、工具栏组、组内项、标记、浮出菜单和覆盖层形状，不能把它们合并成一个全局圆角。

普通控件沿用 `control`，设置分组沿用 `panel`；发送与分段外框使用 `toolbar`，分段内项使用 `inset`。命令面板和确认框使用 `overlay`。站点框另有上圆下小圆的组合（6px 6px 2px 2px），保留与原网页视图的衔接。

状态圆点和圆形勾选标记保留圆形。结果库标签通常是小矩形标记；不将标签、按钮和容器统一改成胶囊。图标沿用当前（16px）、线宽（1.8）的 SVG 体系，继承文字色；局部紧凑图标使用所在组件的既有尺寸。

来源：`desktop/src/renderer/theme.css`、`desktop/src/renderer/command-bar.css`、`desktop/src/renderer/site-frames.css`、`desktop/src/renderer/icons.tsx`。

## Components

### Buttons

精确、轻巧，操作反馈清楚。

- **发送：** 强调色底配成对文字色，工具栏组圆角；常规横向内边距（10px）、字重（650），高度跟随密度，禁用时降低不透明度。收纳态可以只保留图形和站点数。
- **设置次级动作：** 浅灰填充、透明细边界、控件圆角，内边距（6px 12px），最小高度取（34px）与密度控件高度较大值；悬停略加深背景。
- **轻量动作与关闭：** 透明背景，悬停使用弱灰底；关闭按钮采用统一轮廓、（16px）图标和密度目标尺寸。
- **资料沉淀下一步：** 可采集回答时，既有底栏使用强调色文字与浅强调底显示“采集并比较”，与普通状态摘要并列；错误恢复动作与撤销优先，只在明确点击后启动现有采集流程。
- **焦点与禁用：** 通常用（2px）强调色轮廓，边距依组件边界调整；禁用态保留所在组件的具体规则。仅 `aria-disabled` 的动作仍可聚焦解释原因，不能绘制成已接受点击。
- **危险确认：** 使用危险色与准确动词，沿用既有确认框规则。

来源：`desktop/src/renderer/command-bar.css`、`desktop/src/renderer/settings.css`、`desktop/src/renderer/panel-controls.css`、`desktop/src/renderer/styles.css`。

### Inputs / Fields

输入底色、控件圆角和紧阴影构成常态；聚焦后底色混入少量强调色，内侧底线（2px）与聚焦阴影共同提供反馈。错误态用危险文字色的边界和底线，只读使用次级表面，禁用降低不透明度并去影。

统一提问框由容器承载这套反馈，内部 textarea 不再叠加第二个焦点框；右侧为展开按钮保留独立空间。强制配色下回到系统边界与焦点轮廓。

来源：`desktop/src/renderer/fields.css`、`desktop/src/renderer/composer.css`。

### Navigation

工具栏的模式和档位、工作台页签、结果库内容类型均使用分段选择，但各自保留尺寸和选中处理。工作台选中项为面板底、强调色文字和轻影；工具栏选中项用主文字、面板底和细内边界。结果库的“阅读回答 / 对比 / 综合结果”使用底线式切换，不能用同一个分段外观覆盖这些不同层级。

设置分区导航是可横向滚动的按钮行，当前分区使用浅强调底、强调色边界和字重，并通过 `aria-current="location"` 表达。手动滚动更新当前位置且不抢焦点，当前项在横向导航中保持可见。选中、按下与展开状态沿用相应 ARIA 属性和现有键盘路径。

来源：`desktop/src/renderer/command-bar.css`、`desktop/src/renderer/workspace.css`、`desktop/src/renderer/library.css`、`desktop/src/renderer/library-reading.css`、`desktop/src/renderer/settings.css`。

### Chips and Status

结果库标签与状态标记使用小矩形、辅助字号和轻底色；“已定稿”使用强调色文字与浅靛紫底。标签不默认具备按钮行为。分页发送状态徽标保留各语义的文字或数字，窄栏收纳后仍通过可访问名称表达完整状态。

### Cards / Containers

设置分组用面板底、面板圆角和细边界，组内卡片通过分隔线衔接，保留各自的标题、说明与操作。结果列表行以背景和轮廓表达当前项；回答、摘录、比较段落主要是平整分节，不复制设置卡的容器外观。

结果列表先显示来源总数，再以较弱文字预览前两个站点；完整名单保留在提示与读屏文本中，详情继续提供全部来源。

### Site Frames and Reading Sections

站点标题条将选择、站名、进度文字与少量局部动作放在一行，焦点向内绘制以免裁切；站点网页在下方保留原样。结果库阅读节使用来源标题、局部动作、正文及分隔线，并维持正文的选择和复制能力。

### Motion and Feedback

高频动作主要用颜色、背景、明暗变化即时反馈。面板进入（180ms）、退出（140ms），位移仅（6px）；外壳页面切换为（160ms）淡入；字段反馈（120ms）。提问区展开使用（180ms）高度过渡，收起（140ms）；原生站点矩形只在相应边界更新，不逐帧追随 DOM 动画。

结果库菜单沿真实触发按钮的中心与展开侧进入：指针打开使用 160ms 透明度和轻微缩放（0.97→1），选择器箭头用 140ms 旋转说明开合。键盘打开、输入或接管后立即呈现最终状态；关闭立即生效，正文和列表保持稳定。

键盘打开工作台不播放位移过渡。减少动态效果时取消面板、提问框与控件过渡；加载指示保留静态可见状态。精确曲线和时长位于 sidecar 扩展。

来源：`desktop/src/renderer/panel-motion.css`、`desktop/src/renderer/composer.css`、`desktop/src/renderer/library-motion.css`、`desktop/src/renderer/native-feel.css`、`desktop/src/renderer/site-frames.css`、`desktop/src/renderer/styles.css`。

## Do's and Don'ts

### Do:

- **Do** 延用现有语义变量，并同步核对明暗主题、两种密度、三语长度与缩放。
- **Do** 保持工具区紧凑、阅读区舒展，沿用当前区域的控件与导航样式。
- **Do** 成对使用强调底色与文字色，分别使用状态图形色和状态文字色。
- **Do** 保留可见焦点、中文输入法合成态、键盘路径、读屏反馈和系统辅助偏好。
- **Do** 依据实际内容测量收纳工具栏，并让详情比较响应自身容器宽度。

### Don't:

- **Don't** 用外壳主题重新着色第三方 AI 网页。
- **Don't** 为每个阅读段落增加独立浮卡，或将所有控件改成同一种圆角。
- **Don't** 只用颜色说明状态，或在提问框内部与容器上叠加两套焦点反馈。
- **Don't** 用固定窗口断点替代工具栏实际测量，或只改 CSS 而使原生站点几何失配。
- **Don't** 将 sidecar 预览色阶当成应用已采用的新增配色；这些色阶只用于预览。
