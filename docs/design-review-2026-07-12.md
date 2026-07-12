# PolyAsk 设计审查（2026-07-12，v0.7.1+，资深设计师视角）

> 方法：chrome-dbg 真机截图逐表面目审（console 明/暗/状态/命名/窄屏、popup 上下屏、
> compose、archive、pill 展开态）+ 全量 CSS 代码维度核查。每条附证据与最小修法。
> 状态标记：☐ 待处理 ☑ 已处理

## P0 · 布局崩坏（bug 级，建议立即修）

- ☑ **D1 窄屏下站点芯片整体消失**（截图 console-narrow-1200.png）——1200px 窗宽时
  9 个芯片一个都不可见，连溢出箭头都没有；核心控件（选站）在半屏使用场景彻底不可达。
  根因：`#hist` 漏设限宽（`#tpl` 有 `width:110px`，历史下拉没有），被最长历史 option
  撑到 ~180px；连同其他 `flex:0 0 auto` 控件把可收缩的 `#siteswrap` 压到 0。
  修：`#tpl,#hist{width:110px;text-overflow:ellipsis}`（一行）；并给 `#siteswrap` 设
  `min-width` 下限（如 120px，保证任何宽度下至少可见 1-2 个芯片+溢出箭头）。
- ☑ **D2 `#bar` 溢出时裸露系统横向滚动条**（同截图底部灰色大条）——96px 细条被系统
  滚动条吃掉 ~15px，观感崩坏。修：`#bar{scrollbar-width:none}` + `::-webkit-scrollbar{display:none}`
  （溢出兜底仍在：拖动/滚轮可滚，右缘内容渐隐提示更佳但可后置）。
- ☑ **D3 命名/确认条展开时芯片被裁一半且无溢出指示**（截图 console-light-naming.png，
  「智谱」剩半个字）——updateArrows 只挂在 scroll/resize，`#sites` 因兄弟元素显隐被挤压
  时不触发。修：用 `ResizeObserver(elSites)` 替代/补充 resize 监听（3 行）。

## P1 · 交互与语义缺陷（体验级）

- ☑ **D4 popup「当前页面不是受支持的 AI 站点」用警告红呈现常态**（截图 popup.png）——
  从任意页面打开 popup 是常态而非错误，红色制造无谓的负面情绪；且 🧠/⚡ 两个按钮
  在不支持页面上视觉可点（点击才失败）。修：文案降级中性色（--muted）、语义翻转
  （"档位切换在 AI 站点内可用"），unsupported 时禁用两按钮。
- ☑ **D5 popup 的 🗂 图标在无 emoji 字体环境渲染为豆腐块**（截图 popup.png 实拍）——
  🧠⚡🗂🩺 属"历史遗留 emoji"搁置项，但搁置理由（`<option>` 放不了 SVG）只适用于
  tier 下拉；popup 按钮完全可换 SVG。修：四个按钮 emoji 换内联 SVG（与全站图标语言
  统一），`<option>` 里的 🧠⚡▾ 维持搁置。
- ☑ **D6 archive 删除无二次确认**——console 删一个模板都有内联确认条，归档删一条
  完整对比现场（不可恢复）却直接删，破坏性操作保护不一致。修：Delete 首次点击变
  「确认删除？」态（按钮内文字置换 + 危险色，3s 未确认复原），无需浮层。
- ☑ **D7 archive 详情裸显 Markdown 源码**（截图 archive.png，`#`/`**`/`>` 字符直出）——
  "回看对比"场景读的是内容不是源码。修：archive.js 加 ~30 行极简行级渲染（#→标题字号、
  **…**→粗体、>→左边条引用、```→代码底色；textContent 组装无 XSS 面），或至少
  标题行加粗+分隔线的纯排版增强。
- ☑ **D8 failsum 失败汇总条位置切断按钮语义组且 240px 截断**（截图 console-light-states.png）
  ——它插在「重试」与「平铺」之间，把动作区拦腰截断；长文案省略后关键信息（站名）
  可能不可见。修：移到 retry 左侧紧贴（失败信息与重试动作相邻成组），max-width 放宽到
  320px；悬停已有完整 title ✓。
- ☑ **D9 快捷键提示排版**（截图 popup-bottom.png）——三条快捷键用全角空格连成一段流
  文本，扫读性差。修：`#keys` 每条一行（div 而非文本节点拼接），快捷键本体用
  `<kbd>` 样式（等宽+浅底描边），Rebind 链接单独一行。

## P2 · 视觉系统与打磨（一致性级）

- ☑ **D10 右侧 8 个无文字图标按钮均匀排布、无视觉分组**——认知负担高（用户需逐个悬停
  辨认）。修：按语义分三组（编辑/发送/重试 · 平铺/汇总/导出/归档 · 巡检/新会话/关闭），
  组间用 1px 分隔线（`<span class="vsep">`）或 6px 额外间距；「关闭全部」为破坏性操作，
  hover 态加红色提示（`#closeall:hover{color:#ef4444}`）。
- ☑ **D11 状态切换无过渡动效**——芯片琥珀→绿/红瞬变、按钮 hover 瞬变，质感生硬。
  修：`.chip{transition:border-color .18s,box-shadow .18s}`、
  `button{transition:background .12s,color .12s}`（两行，克制不加多余动画）。
- ☑ **D12 无自定义 `:focus-visible`**——键盘导航靠浏览器默认焦点环，与主题违和且暗色下
  一致性差。修：全局 `:focus-visible{outline:2px solid var(--accent);outline-offset:1px}`。
- ☑ **D13 圆角三档并存**（7px chip/select、8px popup、9px 按钮/输入框）——无系统性理由的
  微差。修：收敛为两档（小件 7px/容器 9px），改 popup 的 8px 即可。
- ☑ **D14 archive 的时间格式跟系统 locale 不跟界面语言**——界面切中文而浏览器 locale 为
  en 时显示 "7/11/2026, 8:04:26 PM"。修：`toLocaleString()` 传扩展当前语言
  （i18n 层暴露 lang，zh_CN→'zh-CN'）；console 汇总标题的 `new Date().toLocaleString()` 同。
- ☑ **D15 archive 滚动条未定制**——compose 有主题化 thin 滚动条，archive 的 pre 用系统
  默认，同产品双标准。修：把 compose 的 scrollbar 规则改成共享选择器带上 `#ar-detail`。
- ☑ **D16 compose 窄窗底栏溢出风险**——compose 宽度=console 输入框宽（窄屏可低至
  ~200px），底栏 scope 文本+两按钮无换行策略。修：`#ch-foot{flex-wrap:wrap}` 一行。
- ☐ **D17（有意搁置）失败汇总/failsum 红色硬编码 #ef4444**——状态色（琥珀/绿/红）系统性硬编码可
  接受（跨主题恒定语义色），但建议提为 `--ok/--warn/--err` 变量集中管理（纯整洁项）。

## 观察（不建议动）

- 96px 细条的信息密度已在物理极限上做到了合理取舍（原生 select、内联确认条、隐藏滚动
  条+箭头指示都是正确决策）；不建议为"美观"引入任何浮层。
- pill 展开态形态（胶囊、active 高亮、Think/Fast 双词）成立；站点页 emoji 依赖宿主字体，
  Linux 站点页会豆腐，但 pill 属站点叠加层、随宿主环境，可接受。
- Send to all 渐变主按钮与 accent 体系协调，视觉锚点明确，不动。

## 优先级建议

1. **立即修**（P0 三条 + D4/D5/D6）：窄屏崩坏是真实半屏使用场景的功能性故障；
   popup 红色警告与豆腐块是第一印象损伤；归档删除保护是数据安全一致性。
2. **下版做**（D7/D8/D9/D10/D11/D12）：archive 轻渲染与图标分组是感知提升最大的两项。
3. **顺手做**（D13-D17）：一致性打磨，任意批次顺带。

---

## 处置记录（2026-07-12）

三批落地，每批经 codex（gpt-5.6-sol）对抗审查后综合修正、真机回归：
批 A（8ca836e，D1-D6 + codex 三条全收：删除确认绑定条目 ts/删除前重读最新库/#bar 补滚轮通道）、
批 B（11be721，D7-D12 + codex 围栏状态机修正：闭栏须 ≥ 开栏长度，嵌套围栏回归通过）、
批 C（D13/D14/D16 + codex 指出 compose 80px 宽度下界裁切按钮——根因修在 bg 侧：下界提至 320、
贴右缘左移不压缩、#ch-text 保底 120px，压力场景真机验证）。D15 随批 B 顺带完成；
D17 有意搁置（SVG data-URI 内联色无法 var()，变量化只能做一半反而制造两处真相）。
