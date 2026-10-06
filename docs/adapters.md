# 站点适配（`desktop/src/site-runtime/`）

改 `desktop/src/site-runtime/core.js` 或任一 `adapters-*.js` 前读这份。**适配器契约全表、加新站点步骤、图片载荷限额、注入/提交/切档/汇总机理、九张站点卡都在这里**；`CLAUDE.md` 只留一句协议摘要（必需成员、只读不开菜单、`false` vs `throw`）。两边说法冲突时以 `CLAUDE.md` 的硬约束为准，然后回来把这份改对。站点运行时之外的边界——进程与视图、注入链在外壳侧的接法、错误码全表与超时预算——在 `docs/desktop.md`。

选择子、模型正则、档位标签随站点改版失效，**代码是唯一权威**；本文记的是「上次真机确认的形态 + 致命坑」。2026-09-20 本轮仅核对本地源码与测试，模型/菜单的真实页面状态仍以各条取证日期为准，未重新真机验证。

## 加新站点

1. **站点登记三处**：`desktop/src/main/sites.ts` 的 `SITES`（`{key,host,label,url,authHosts,transitHosts?,image,intl}`——`image` 决定图片群发可用性，**必须与适配器是否实现 `attach` 一致**；`intl` 决定「国外/国内」的分组语义）、`desktop/src/shared/contracts.ts` 的 `SITE_KEYS`（**两者顺序必须一致**，否则 `desktop/src/main/diagnostics.ts` 判 `site_order`——它要求上报的站点序列仍是 `SITE_KEYS` 的子序列）、`desktop/src/site-runtime/generation.js` 的停止键表（键就是**适配器注册键**；不补 = 永远观测不到该站的「生成中/已完成」，卡片停在「已提交」）。
2. 适配器：`desktop/src/site-runtime/adapters-intl.js` / `adapters-intl2.js`（国际）或 `adapters-cn.js` / `adapters-cn2.js` / `adapters-cn3.js` / `adapters-cn4.js`（国内）。**分卷只因 300 行上限而存在，按站切，不按职责切**：当前 `intl` = Claude + Gemini、`intl2` = ChatGPT、`cn` = DeepSeek + 豆包、`cn2` = Kimi + 智谱、`cn3` = 元宝、`cn4` = 千问。
   **新开一卷要登记三处**（漏哪处都是静默失效）：① 分卷文件本身；② `desktop/src/preload/site.ts` 的 `require` 列表——**排在其它适配器之后、`generation.js` 与 `diag.js` 之前**（这两份按「已填充的注册表」统一包装，注册晚于包装就静默拿不到通用检查与生成态）；③ `desktop/scripts/desktop-shared-runtime.test.js` 的 `PRELOAD_CHAIN`（与 require 列表逐项等值对账，只改一边就红），顺手在文末补一行 `adapterMustResolveTranslation(<新卷>, <某 host>, <某 diag key>)`。**`scripts/test-site-selection.js` 的适配器清单是从 `site.ts` 的 require 列表派生的**：新开一卷只写文件、不 require 进 preload，九站对账当场红——没有「挂上就自动纳入」的旁路。
3. `.github/ISSUE_TEMPLATE/site-breakage.yml` 的「哪个站点」下拉：`标签 (host)` 两项都要与站点表对上，站点名不一致也红。
4. 按下方契约表补可选钩子。不补 = 该能力静默降级，不是报错。
5. 测试：
   - **不用再补断言，要会读它的红**：`scripts/test-site-selection.js`（`verify.sh` 已调）双向对账**两处登记**（`desktop/src/main/sites.ts` 的站点表 + `desktop/src/preload/site.ts` 的 require 列表）——正向查每个 `SITES[].host` 能否被某个 `S.adapters` 键以 `includes` 命中（`pickAdapter` 的真实语义，键是 host 子串不必相等），并逐站校验 `{think, fast, state, diagnose}` 四个必需钩子都在；反向查僵尸适配器键。同一份测试还守 issue 模板的站点下拉与 `scripts/watch-releases.js` 里 `SOURCES.adapter` 引用的分卷路径——**重命名或搬动分卷要一起改**，否则它指向不存在的文件。
   - 站点实现了 `submit` / `inject` / `attach` 时，才另加 `desktop/scripts/site-send-runtime.test.js`（`adapters-cn.js` 各站）或 `cn2-send-runtime.test.js`（Kimi / 元宝）用例。两份共用 `scripts/lib/site-send-harness.js`，只用 `vm` 执行对应分卷，针对 DeepSeek / 豆包 / Kimi / 元宝 验注入、发送与附件语义，**不是站点登记表**，加站点不改它不会红。**档位切换的回归不放这里**：国际站在 `desktop/scripts/intl-runtime.test.js`（Claude/Gemini）与 `intl2-runtime.test.js`（ChatGPT 滑块），国内站在 `cn-tier-runtime.test.js`（智谱/元宝/Kimi），模型正则另有 `claude-model.test.js` 与 `qwen-adapter.test.js` 专项，Claude effort 还有 `claude-effort-runtime.test.js`；各测试按职责分工，部分契约覆盖会重叠。

**适配器注册键是 hostname 子串**：`pickAdapter()` 用 `location.hostname.includes(key)` 匹配，所以 `S.adapters` 的键是 `deepseek.com` / `doubao.com` / `qianwen.com` / `kimi.com`，与 `sites.ts` 的完整 host（`chat.deepseek.com` / `www.doubao.com` / `www.qianwen.com` / `www.kimi.com`）**故意不同**（9 站里有 4 站如此）。使用完整 host 作为键能匹配该 host，但会收窄子域覆盖范围；维护时沿用现有注册键，避免改变匹配语义。子串匹配也意味着同域新子域会被同一适配器接管（如 `platform.deepseek.com`），加子域前先想清楚。

## 适配器契约（全表）

**绝大多数站只要 `think` / `fast` / `state` / `diagnose` 四个必需项，其余都不用写。** `state`/`selection`/`diagnose`/`answer`/`submitted` 一律**只读同步，不得开菜单**。

| 成员 | 必需 | 签名 | 返回值与异常语义 |
| --- | --- | --- | --- |
| `think` / `fast` | ✓ | `async (deadline?)` | 切到目标档。**关键控件缺失一律 `throw`**；返回后仍须由 `tier.js` 读取证据确认，不能用静默 `return` 掩盖缺失步骤（例外见下一节） |
| `state()` | ✓ | 同步 | `"think"` / `"fast"` / `null`。只表示粗档位，不能证明模型版本/强度/开关精确 |
| `selection(mode)` | | 同步只读 | 返回 `{outcome, observed?, model?}`；`preferred`/`alternative` 需精确模型及目标模式证据，`mode_only` 只证明模式，其他为 `unconfirmed`。不得开菜单或复用上轮缓存；未实现时由 `state()` 提供模式证据 |
| `diagnose()` | ✓ | 同步 | 锚点命中报告，供巡检标芯片。只列**常驻**控件，会随对话阶段消失的控件不许列（否则巡检恒红误报）。**每条检查必须带 `kind`**，见下方「检查项的 `kind`」 |
| `submit(el, deadline)` | | `async` | `false` = 发送键此刻不可用 → 落回通用链；**抛异常 = core 直接终止、不回退**（输入在等待中回滚时报 `inject_failed`，其余异常报 `error`），所以内部必须自行判空返回 false。点击成功也要过 `confirmSubmitted` 才算成功 |
| `inject(el, text)` | | 同步 | `false` = 交回通用注入链（beforeinput→execCommand→textContent）；**抛异常 = 通用链对本站不安全**（Kimi），core 直接报 `inject_failed` 不回退 |
| `answer()` | | 同步 | 最后一条 AI 回答的**根节点**（或字符串）或 null；core 用 `desktop/src/site-runtime/md.js` 统一序列化为 Markdown，**逐站不维护 markdown 规则** |
| `submitted(text)` | | 同步 | 「末条用户消息是不是我刚发的」。页面侧回包在 `read-commands.js` 的 `wasSubmitted`：适配器抛错或返回非布尔、页面不出帧（≤300ms 内 rAF 不回调）、`document.activeViewTransition` 非空时一律回 `supported:false`（fail-closed），只有「同步返回 false + 在出帧 + 无视图过渡」才回 `{supported:true, ok:false}`。消费端是 `desktop/src/main/broadcast.ts` 的 `confirmSubmitted`（只读确认，页面重挂期间最多探 1.5s）；确认「未提交」后是否自动重发一次由模块常量 `POLYASK_KIMI_RESUBMIT` 决定，**当前为 `false`** |
| `attach(files, el, deadline)` | | `async` | 真值 = 已确认附件；`false` = 失败（按是否已过 deadline 归 `attachment_timeout` / `attachment_failed`）；**返回字符串 = 直接当错误码用**；抛异常 = `attachment_failed`。不实现就整个不写（core 如实报 `attachment_unsupported`），不要写半吊子上传 |
| `generation()` | | 同步 | **仅 Desktop 消费**（`desktop/src/preload/site.ts` 的 `readGeneration`）。返回 `"generating"` / `"complete"` / `"idle"` / `null`。九站都不自己写：`desktop/src/site-runtime/generation.js` 在注册表填好后，按 host→停止键选择子表**统一挂上默认实现**（停止键可见且挨着 composer → generating，否则看 `answer()` 有无内容）；适配器若已自带同名方法则跳过不覆盖。外壳读的是 `S.generationProbe()`：`core.js` 提交前调 `S.armGeneration()` 武装停止键锁存（MutationObserver 100ms 节流补采样，提交时已在的停止键须先见它消失；窗口与 15 分钟观察期同长），并记下当时 `answer()` 的节点作基线；探测读到 `complete` 时，只有本次见过停止键**且** `answer()` 是基线之外的已连接新节点才改报 `complete_observed`（短回答整段落在两次 900ms 探测之间时的正向证据），否则原样 `complete`。不以文本静止推断完成。加站点要补那张表，否则 Desktop 卡片永远停在「已提交」 |
| `thinkImage()` / `fastImage()` | | `async` | 有图时替代 `think`/`fast`（仅 DeepSeek，走 Vision 模式） |
| `stop()` | | `async` | 仅 ChatGPT。**全仓无调用方，当前是死代码**——要么外壳补 UI（如「停止全部」），要么删 |
| `sendSel` | | 字符串 | 发送键选择子，**仅 DeepSeek/Kimi/元宝 3 站声明**（都需要站点级点击且锚点常驻），供 `desktop/src/site-runtime/diag.js` 巡检做只读存在性检查。**与本站 `submit` 的选择子同步维护**——`desktop/scripts/diag-runtime.test.js` 按字面量对账，脱钩会红。豆包**有意不声明**：其发送键空输入框时不在 DOM（非常驻，真机 2026-08-18），列进巡检会恒红 |

**能力由钩子决定，不由清单决定**：`answer()` 决定该站能否进「汇总复制」（九站全实现）；`attach()` 决定能否收图（九站均实现，与 `main/sites.ts` 的 `image: true` 对账）。各站使用聊天附件专用 input 和 `S.setInputFiles` 的只读完成判据；元宝保留旧版拖放回退。2026-09-22 复核 Gemini / 千问 / 智谱：之前“拒绝合成事件”的结论已过时，根因分别是菜单延迟创建图片输入、Radix 要求 PointerEvent、误用失效的旧图片输入。

**巡检通用检查（`desktop/src/site-runtime/diag.js`）**：在全部适配器分卷之后注入，按已填充的注册表统一包装每站 `diagnose()`，前置两条只读检查——「输入框」（`findComposer()`，九站全部）与「发送键」（仅声明了 `sendSel` 的站）。新站/新分卷自动获得，无需自己写这两条；**有意不做全站发送键检查**：ChatGPT 等站空输入框时发送键被语音键替换，通用检查会在巡检（输入框常为空）时恒红误报。新开适配器分卷（如 `adapters-cn3.js`）在 `desktop/src/preload/site.ts` 里 require 时**必须排在 `desktop/src/site-runtime/diag.js` 之前**，否则该卷站点拿不到通用检查（注册晚于包装，静默缺席不报错）。

### 检查项的 `kind`（机器字段，不产用户可见文案）

每条 `{ name, ok }` 都要再带一个 `kind`。**不能按 `name` 分类**——`name` 在源头就已本地化（`desktop/src/site-runtime/i18n.js` 的 `diag_*` 词条），按显示名匹配在非英文界面下必然失效，也撞 CLAUDE.md「绝不正则匹配文案」。

| `kind` | 含义 | 红了意味着 |
| --- | --- | --- |
| `reach` | 站点可达性（输入框在不在）。`desktop/src/site-runtime/diag.js` 统一前置，每站**恰有一条** | 整条群发链必然 `composer_not_found` |
| `control` | 切档控件在不在 | 多半是站点改版，要修适配器 |
| `tier` | 当前档位读不读得出（`state() != null`） | **不代表站点坏了**，见下 |
| `probe` | 探测本身出错（适配器缺席 / `diagnose` 抛异常） | 适配器层面出问题 |
| `capture` | 回答采集的第 ① 级逐站选择器能否定位末条提问（`diag_captureUser`）与其回答根（`diag_captureAnswer`）。`diag.js` 统一追加，**只在会话路由产出**（复用 `history.js` 的 `route()`，首页/新会话天然零命中不产出） | **不代表站点坏了**：群发照常可用，只说明提问历史副本的选择器已漂移；第 ②③ 级兜底接得住也照样记红 |

**为什么 `tier` 单独一档**：各站 `state()` 是**刻意的偏函数**，按各站可只读获取的证据映射粗档位；用户手动停在非预设组合时可能返回 `null`——千问「Qwen3.7-Max + 快速」（非预设模型）、Kimi「Instant」（非 K3）、当前元宝「Thinking/思考」均如此；也有粗判无法区分的组合，详见各站卡。真机 2026-08-31 曾因这类合法档位**常态**被判「发现异常」，反而把真正的改版信号淹掉了。元宝当时的 Expert 非预设例子已随 2026-09 的映射调整过时，当前 Expert 判 think。现在 Desktop 的 `buildSiteHealth` 只让 `tier`、`capture` 之外的红项决定可用性（`shared/site-health.ts` 的 `isAdvisoryCheck`），这两类红项在详情页显示成「提示」而不是故障，照常进诊断报告与哨兵比对。

**标签集真漂移时靠九站巡检的 `tier` 红项兜底**：`tier` 被降为「提示」只是不再决定站点可用性，检查项本身照常产出——九站一起把「档位读不出」亮起来，就不是用户手动停档能解释的了。这是自动信号退役后唯一还在的漂移线索，所以详情页不许把 `tier` 项整个藏掉。

**`capture` 只看第 ① 级**：探针调用 `historyTurn({ method: "selector" })`，不走语义信号与原文锚点；不开菜单、不序列化正文。会话页上它红了 = 该站副本正在靠兜底或已经抓空，按「页面改版剧本」重采 DOM fixture、修选择器。

**漏标的后果**：`normalizeDiagnosticChecks` 把缺省与未知值一律归成 `control`——方向是安全的（保留「红即告警」的现状，绝不制造假绿），但等于没修。`desktop/scripts/diag-runtime.test.js` 有一条九站不变量断言守着：每条检查必须带合法 `kind`，且每站恰有一条 `reach`。

### 通用发送键定位（`desktop/src/site-runtime/send.js`）

`submitPromptNow` 的按钮路径不自己找发送键，统一走 `__AMS.sendBtn(el)`。**该文件必须排在 `desktop/src/site-runtime/core.js` 之后**（它读 `window.__AMS`），登记只有一处：`desktop/src/preload/site.ts` 的 `require` 列表。漏登记是**静默**的——九站按钮路径全部退化成纯 Enter 兜底，没有任何报错；`desktop/scripts/desktop-shared-runtime.test.js` 的顺序断言（`PRELOAD_CHAIN`）与运行期断言（真的选出发送键）守着。

两个真机坑决定了它的写法（改之前先读源码注释）：

- **纵向锚点取输入框的裁剪祖先，不取编辑节点本身**。Claude 的 ProseMirror 随行数无限长高并溢出裁剪容器，而发送键贴的是容器下沿。按编辑节点 `top` 作锚，`|send.top − composer.top|` 随行数线性增长（真机 2026-08-31：空框 57 / 8 行 189 / **15 行 343**），越过 240 带后整条按钮路径失效。Desktop 的三宫格 tile 只有全宽的约 1/3，同样字数折行多 2~3 倍，比浏览器里早得多就触发。
- **横向按「离输入区最近」择优，不设绝对像素阈值**。`claude.ai` 侧栏每条会话一个 `More options for <会话标题>` 按钮，标题含 send/发送 时就匹配同一选择器，且文档序在输入框之前、纵向也落在带内（真机 2026-08-31 带内 9 个）。它在另一列、差着整个栏宽。**不写死远近阈值**——窗口越窄各列挨得越近，任何固定像素数都会在某个宽度上翻车。
- 簇内优先可用项（`disabled` 与 `aria-disabled` 都算不可用）；全簇不可用时仍返回首个，由调用点的 `btn && !btn.disabled` 拦下并落到 Enter 兜底。

**什么时候才写 `submit`**：群发的发送/切档复用 `desktop/src/site-runtime/core.js` 的通用 `submitPrompt`/`runMode`，多数站点无需写 `submit`；**仅当通用 button 选择子或 Enter 提交覆盖不了本站时**才加。当前实现分布：`submit` 4 站（DeepSeek / 豆包 / Kimi / 元宝）、`inject` 1 站（Kimi）、`submitted` 1 站（Kimi）、`stop` 1 站（ChatGPT）、`thinkImage`/`fastImage` 1 站（DeepSeek）。

## 九站发送路径

| 站点 | 路径 | 关键选择子 / 说明 |
| --- | --- | --- |
| Claude | core 通用链 | 无 `submit`；发送键锚点是 `button[data-testid="chat-input-send"]`（同族 `chat-input` / `chat-input-attach` 一并核实，真机 2026-08-31），原生 `btn.click()` 一点就发。其 `aria-label="Send message"` 由 react-intl 产出、随界面语言变，**只作现象描述，不可当锚点**。注入后约 80ms 解禁（core 等 250ms，余量充足）|
| ChatGPT | core 通用链 | 无 `submit`（优先 `send`/`发送` 标签按钮，无可用按钮才用 Enter） |
| Gemini | core 通用链 | 无 `submit` |
| DeepSeek | `submit(el, deadline)` | `[role="button"].ds-button--primary.ds-button--circle` 取最后一个，`waitFor` 到既无 `ds-button--disabled` 类也无 `aria-disabled="true"` 才原生 `click()`；超时（deadline 剩余，无 deadline 则 10s）返回 false |
| 豆包 | `submit()` | `#flow-end-msg-send`；缺失或 disabled/aria-disabled/data-disabled 为真时返回 false 落回通用链（textarea Enter 可发） |
| 千问 | core 通用链 | 无 `submit`；受控编辑器靠合成 `beforeinput` 注入 |
| Kimi | `submit()` | `.send-button-container`（无 role 的 div，Enter 只插换行）；用 `clickEl(b)` 合成 pointer 序列 + `detail:1` 拟真，**不是原生 `click()`** |
| 元宝 | `submit()` | `[aria-label="Send"], [aria-label="发送"]`（非 button），排除 disabled 后用 `clickEl()` |
| 智谱 | core 通用链 / Enter | 无 `submit`；通用链优先 `send`/`发送` 标签按钮，无可用按钮才发 Enter（textarea 可发） |

Claude / ChatGPT / Gemini / 千问 究竟命中通用链的哪一步（原生点按钮 vs 合成 Enter），只有 Claude 有真机结论；其余三站代码里没有站点级证据，别断言。

## 「控件缺失一律 throw」的 4 处例外（3 个站）

例外全部在 `adapters-*.js` 里。`core.js` 没有这条规则，它只负责把适配器抛出的异常转成 `runMode` 返回 false 或 `submitPrompt` 的 `code:"error"`。

1. **DeepSeek `_selectMode`** 找不到模式 radio → 静默跳过。radio 仅空对话首屏存在，聊天中缺失属正常态，档位真值由 DeepThink 开关兜底。
2. **Gemini `_setThinking`** 没有直达开关且 `on === false` → 静默 return（关思考时没有开关可关）。
3. **Gemini `_setThinking`** 找不到「thinking level / 思考等级」子菜单入口 → 静默 return（窄屏或该模型无此项，属合法缺席）。反例：**子菜单在但目标等级缺失必须 throw**，静默会漏设等级。
4. **千问 `_selectModel`** 无模型入口，且可见的已选中日常标签、输入框、快速/思考研究菜单按钮同时存在 → 跳过选模型，继续 `_setThink` 并复读。只承诺模式、不承诺底层模型；工作页、未就绪页、模式按钮缺失仍抛错，目标选项缺失或点击未生效也仍抛错。

**已撤销的例外**：原第 2 条「Claude `_setThinking` 连裸 Thinking 开关也缺失 → 静默结束」于 2026-08-31 删除。当时的理由是「思考控件整个缺席在旧布局属合法态」，但真机复核发现控件一直在、只是 `effort-menu-trigger` / `effort-option-*` 两个 testid 改没了；静默让 `think()` 一路假成功、上报绿而档位纹丝不动（本次事故里最难发现的一站）。现在 Claude 的 effort 入口缺失、档位为空一律 throw。**加新例外前先想清楚：它是「站点本就没有这个能力」，还是「我们的选择子过期了」——后者永远不该静默。**

**智谱 `think()` 的「极致找不到就点深度」不是例外**：那是有序降级表 `_TIERS` 的正常取值（同 ChatGPT `_pickEdge` 的「取在场端点」、Claude `_setEffort` 的「取在场最高档」），点完照样复读校验、不生效照样 throw。

另有 5 处「先读后点」的幂等 `return`，**不属于例外，别混为一谈**：豆包 `_select` 已是目标模式、千问 `_selectModel` 已是目标模型、千问 `_setThink` 状态已对、Kimi `_setEffort` 强度已对、ChatGPT `_selectModel` 目标模型已 `aria-checked`。

## 切档（`runMode` / `resolveTier`）

- `tier.js` 将动作与只读确认分开：沿用适配器最多两次动作尝试（仅首次抛错时重试），动作结束后最多等 800ms 读取证据。不因 `state()==null` 再次点击，连续 null 永远不能证明成功。`runMode(mode, silent?, deadline?)` 仅在已确认目标模式时返回 true。
- `selection-match.js` 只匹配站点限定语义的可见、启用候选，支持显式别名、空白/零宽/连字符归一；同名歧义直接拒绝。首版由千问与 ChatGPT 使用，不凭版本号、Pro/Max 等名字推断能力，也不自动选择未登记模型。
- 切档结果独立于发送结果：`selection.requested` 记录目标，`outcome` 区分 `preferred` / `alternative` / `mode_only` / `unconfirmed`。精确结果须有受限单行模型名和一致的 `observed`；畸形证据降为未确认。旧七站仅凭 `state()` 产出 `mode_only`，不声称精确模型；`alternative` 预留契约，首版没有启用自动备选模型。
- **先等输入框出现再切档**：未就绪返回 `composer_not_found`——`desktop/src/main/broadcast.ts` 把它与 `not_ready` 一起列进 `RETRIABLE`，在同一 deadline 内轮询重试（其它任何码，含新增的，默认不可重试）；提交成功但档位未确认时回 `tier_unconfirmed`（绿点带警示，不谎报全绿）。
- `state()` 只表示粗档位，不能证明模型版本/强度/开关精确，所以每次群发至少跑一次幂等适配器。
- **站内 toast 已是 no-op**（`core.js` 的 `toast()` 函数体早退，调用点保留）：用户可见反馈的所有权全在 Desktop 外壳（状态通道 + live region）。九个视图各弹一条硬编码配色、与外壳主题/语言/进度脱节的提示条只会制造噪音。**判断「切档是否成功」一律看返回值与 `state()`，别指望页面上出现什么。**
- **切档透传绝对 `deadline`**：`runMode(mode, silent?, deadline?)` 在排队前确定默认 10s 截止时间；群发采用 `min(群发 deadline, now + 10000)`。`think`/`fast`/图片切档及其私有菜单方法传递同一时间戳，轮询和 sleep 夹取剩余时间，交互动作前检查到期。到期允许菜单关闭收尾，不再选择模型或档位；切档预算耗尽但群发仍有余量时继续提交，保留 `tier_unconfirmed`。

## 汇总复制（`answer` + `desktop/src/site-runtime/md.js`）

序列化入口是 `desktop/src/site-runtime/md.js` 挂在 `__AMS.toMarkdown(root)` 上的函数，由 `desktop/src/site-runtime/read-commands.js` 的 `collectAnswer` 调用（只读命令从 `core.js` 拆出，监听器仍只在 `core.js` 注册一次）——grep 这个符号名找真入口。

- `answer()` 返回最后一条回答的根节点；快照**以点击时刻为准（不等流式）**，档位标注取收集时刻 `state()`；无回答的站如实标出，别让用户把错误占位贴给别人而不自知。
- **可见文本必须用 `innerText` 不用 `textContent`**（`visText`）：`textContent` 会把站内/第三方脚本注入的隐藏节点（水印 UUID、翻译克隆）一并带出，所见即所得只能靠 `innerText`（`textContent` 仅兜底）。
- **`answer` 必须排除思考段**，否则思考全文淹没正文。七站显式过滤后取最后一个，逐站排除锚点见站点卡。**例外两站待取证**：ChatGPT 与 Gemini 目前是「末条回答容器 → 第一个 `.markdown`」，没有任何思考段过滤——依赖「思考段不带 `.markdown`」这个未经真机确认的假设（F098）。改这两站的 `answer()` 前先真机看一眼开了思考的那轮回答里有几个 `.markdown`。
- `md.js` 是**一个串行器通吃九站**（九站回答都是 md 渲染的标准 HTML），逐站不维护 markdown 规则；剔除规则 `drop()` 与代码块头部条（语言名 / 复制键）的判定按 300 行上限拆在前置卷 `md-head.js`（preload 先于 `md.js` 注入）。无语言名的头部条要同时满足「确有操作件（按钮/svg/role=button、从该层起才 pointer 的非链接节点、copy 类名、带 lang 类名的 p）」和「连操作件文字在内只剩操作件字样或空白」才整条剔除，div 段落「运行」与只含链接的段落照常保留。它的**四条输出契约**（下游依赖，改前先想清楚谁在用）：
  1. 表格 → GFM 管道表。
  2. 链接保留为 `[文本](href)`——引用 chip 因此带回来源 URL，去掉链接等于丢掉出处。href 里的圆括号做 `%28`/`%29` 百分号编码（只编码链接目标，可见文本保持原样）：CommonMark 的括号配平会把带右括号的 URL（查询参数里很常见）截断。实现同 `desktop/src/main/archive-service.ts` 的 `markdownUrl`。引用角标按整体输出（2026-10-04 Windows 真机，智谱 `span.source-item` 内为 `.source-item-num-name`「cma.gov.cn」+ `.source-item-num-count`「+2」，旧输出 `…现象。**cma.gov.cn+2` 粘在前文）：只认完整类名词元 `source-item`，与前后文以空格隔开、内部各段以空格分开；href 或 `data-url` 是绝对 http(s) 地址时写成 `[cma.gov.cn +2](href)`（括号同样编码），否则写成 `[cma.gov.cn +2]`。fixture 里智谱的 `data-url` 已脱敏，真实格式与副本外观待真机看一眼。回归 `desktop/scripts/md-citation-chip.test.js`。
  3. `IMG` 节点保留 alt 文本占位（`[alt文本]`，无 alt 用 `[图片]` 兜底），**不贴 src**——九站生图的 src 多是签名/临时短效 URL，还原成 `![alt](src)` 只会产出死链或过期图。保留占位是为了让纯图回答的序列化结果非空，否则一次成功作答会被上报成 `no_answer`。例外只有一条且按容器认、不按尺寸：位于引用/来源容器（祖先类名词元含 `ref-list`/`citation(s)`/`cite`，只查到本次序列化的根为止）里的**无 alt** 图片不输出占位（元宝 `.hyc-common-markdown__ref-list` 的 13×13 来源图标曾在副本里成一串「[image]」，2026-10-04 真机）；有 alt 的图照常留占位。
  4. SKIP 集剔除 `BUTTON` / `SVG` / `STYLE` / `SCRIPT` / `NOSCRIPT` / `SELECT` / `TEXTAREA` / `AUDIO` / `VIDEO`，以及 `aria-hidden="true"`、`role="button"` 与带 `data-card-highlight-target` 的节点。最后一项是千问可点卡片外壳（长文写作卡 aiWritingCard：图标 + 标题 + `sub-title > description`「创建于 MM-DD HH:mm」，类名 `card-container-narrow/wide-<hash>`，取自 qianwen-web 4.9.1 前端包）：2026-10-04 Windows 第 4 轮 `u4-cancel-after-seal` 的副本以「森林火灾的成因与预防\n\n创建于 10-04 20:50」收尾。卡前后的正文（leadingText / tailText）在外壳之外，照常保留。当时现场页面已换会话、结构按前端包源码推定；2026-10-05 Windows 第 5 轮 V4 直接看到外壳 `card-container-wide`（`data-card-highlight-target=true`，「标题 / 创建于 MM-DD HH:mm」），与推定一致，副本不再带卡片。「在对话中输出」按钮与只有卡片时保留标题两条仍无真机样本。
- 五条实现硬规则：① 文本节点必须转义 `\` `` ` `` `*` `_` `[` `]`（同段的 `a_i` 与 `b_j` 会被下游渲染成强调/链接）；② 代码块语言名前瞻绝不吸收语义标签（ChatGPT 的 `h3` 直邻 `pre`，旧逻辑把「### Example」吞成语言名）；③ `firstTextNode` 要跳过空白垫片文本节点（Kimi 头部条首个文本节点是纯空白）；且语言头只能是「整块就是那个词」——有块级语义后代（UL/OL/LI/P/TABLE/PRE/BLOCKQUOTE/H1-6）一律不吸收，唯一例外是带 lang 类名、文本恰为该词的 `<p>`（智谱头部条 `p.language`）（智谱 `div > [div(markdown-body > ul), div(pre)]` 的列表曾被首个文本「Red」整段吞掉，2026-10-04 Windows 真机）；自身文本（剔除 drop 件与从该层起才 cursor:pointer 的操作件）须等于该词，或词后只剩已知操作件字样（复制/Copy/下载…，cursor 认不出操作件时兜底），别的文字不吸收；没有语言名的头部条（智谱 `p.language` 为空、后面只有复制键，2026-10-04 Windows 第 4 轮 `u6-all9`）在剔除操作件后只剩空白或操作件字样、且不带图片时整条丢弃，旧输出把「复制」和围栏粘成一行「复制  ```」，围栏失效；行内位置拼接块级结果时，围栏前若已有行内文字先补换行，块前空白文本节点（Vue 模板缩进）留下的行首空格一并去掉（旧副本里代码块后的段落成了「  输出结果：」）；④ `PRE` 常被再包一层透明 `DIV`（Claude `overflow-x-auto` / Kimi syntax-highlighter）；⑤ 内容含反引号用双反引号 + 空格包裹，围栏代码含三个反引号时升级为四反引号；⑥ 代码块不一定是 `PRE`：ChatGPT 新版是 `div[data-markdown-copy="code-block"]`，头部条 `data-markdown-copy="exclude"` 放语言名与按钮，正文或为 `display:block` 的 `code`、或为 CodeMirror 逐行 `div.cm-line`（`data-language` 带语言），旧序列化把它拆成「Python」段落加行内代码/逐行段落（2026-10-04 真机）；代码正文逐文本节点拼接，跳过行号栏（类名词元 `line-number`/`linenumber`/`gutter`、user-select:none）与头部条，块级行之间补换行但不与行尾 `\n` 重复（`innerText` 会给千问每行多一空行）。副本与「页面正文」都用同一个 `toMarkdown`，二者相等不能证明转换忠实，代码块要对照页面 DOM 核对。
- 站点用 `div` 当段落、自绘列表符号时（元宝 `.ybc-p`、`•`/`4.` 圆点，2026-10-03 真机）：只含行内内容且有文字的块级 `div` 按段落断行，包裹块级子树的 `div` 仍透明；列表总另起一行，并去掉项首与本序列化器重复的 `•` 类符号或同号序号（有序列表认 `start`）。
- 嵌套列表按层缩进：子项内容以父项标记宽度为前缀（无序 2 空格、有序 3 空格，模块级 `pad` 在 `list()` 进出时累加/还原，`toMarkdown` 入口复位），多段落续行补同样缩进。列表项里的围栏代码块（含围栏行）逐字保留：续行缩进不进围栏、围栏内空行不压，收尾把围栏行剥回第 0 列，代码正文与围栏同列、相对缩进不变（曾给代码行补父项缩进，Python 缩进被改写）。KaTeX 还原为 TeX：`.katex-display` 输出 `$$…$$` 块、`.katex` 输出 `$…$`，取值先 `data-latex`、再 `annotation[encoding="application/x-tex"]`（annotation 是 `display:none`，只能直接读不能遍历，所以 `.katex` 节点在常规遍历之前整体处理；`.katex` 本身不是隐藏节点、不会被 `drop()` 剔掉，但若某站把它包进 `aria-hidden` 容器，整棵子树仍先被 `drop()` 跳过）；两者都没有则退回常规遍历，渲染层 `.katex-html` 因 `aria-hidden` 仍被跳过。TeX 原样输出不做转义。

逐次提问副本的 `history.snapshot()` 在用户轮次尚未渲染、但停止控件已确认生成时，可返回 `owned:false, generation:"generating"`，仅作为生成过程信号；主进程观察预算已固定，不再据此顺延。此分支不返回正文或地址；已结束、路由改变和手动操作（生成中除外，见下文「逐次提问的只读副本」）仍终止采集，正文必须经 `bind()` 正向归属后才能保存。

## 图片载荷（`desktop/src/site-runtime/upload.js`）

最多 **4 张**、仅 `image/png` 与 `image/jpeg`、单批总计 **≤10 MiB**（`MAX_BYTES`）。`dataUrl` 要过严格 base64 正则 + 解码后长度必须等于声明 `size` + PNG/JPEG 魔数校验 + `createImageBitmap` 真解码，任一不过报 `image_invalid`；`desktop/src/shared/images.ts` 的 `validateImageFiles` / `validateImages` 在**选图当下**先做一轮张数 / 类型 / 总大小 + base64 + 魔数校验（早于 `upload.js`，让用户当场知道选错了），**但不做 `createImageBitmap` 真解码**——那一层只在注入侧，两处数值必须一致。附件就绪靠「composer 锚点附近可见节点快照 diff + 400ms 稳定 + `role=alert` 错误文案检测」判定，**不是 sleep 等**；未给 deadline 时默认 15s 上限。

2026-09-22 修正：独立预览按叶节点计数，保留相同图片 URL 的重数，不将父容器算作额外附件。检查祖先透明度，移除旧的 5 秒忙碌放行规则；DeepSeek 的残留 spinner 实际位于透明祖先内。千问和 Kimi 横向附件条按条带锚定，计入滚动区内的附件。重试仅复用同批、同节点、内容未变且已确认的附件；Kimi/千问/Gemini 附件区和表单内检测到刷新后保留的原生附件时同样拦截；残留的不完整或不同附件返回 `attachment_conflict`，由用户清除后重试。提交确认后丢弃运行期凭据，不持久保存图片。

通用发送链一旦发出按钮或 Enter 动作，只读等待提交确认，不再交替点击/Enter 补发；无法确认原样返回 `submit_unconfirmed`。没有可用按钮时才选择 Enter。

提交回包附 `submissionEvidence`：本轮 history token 在动作前尚未绑定、动作后出现新的同轮用户消息为 `message`；只观察到输入框清空或变化为 `composer`。前者表示页面已出现本轮消息，不保证服务端持久化；后者保留兼容但明确消息尚未确认。旧同文消息、旧 token、已结束历史均不能提供新消息证据。`history.submitted(token)` 只读且不序列化正文，和可参与 Kimi 恢复的 `adapter.submitted(text)` 是不同能力，绝不据此自动补发。

**这三个数字有七处落点，改一个就要全改**（`scripts/test-image-limits.js` 逐处按锚点对账，抠不到锚点即红，不静默跳过）：

1. `desktop/src/site-runtime/upload.js` 的 `MAX_COUNT` / `MAX_BYTES` / `TYPES`（注入侧校验层）；
2. `desktop/src/shared/images.ts` 的 `MAX_IMAGE_COUNT` / `MAX_IMAGE_BYTES` / `IMAGE_TYPES`（桌面端权威校验层）；
3. `desktop/src/renderer/image-picker.tsx` 的 `accept="image/png,image/jpeg"`；
4. `desktop/src/shared/copy.ts` 的三语 `imageCountError` / `imageSizeError` / `imageTypeError`（各恰好三条，多一条说明有人复制粘贴出了第四份）；
5. `README.md` 两句（核心功能段与桌面段，各自要同时含「4 张」「PNG」「JPEG」「10 MiB」）；
6. **本节上面那两个加粗字面量**（`**4 张**` 与 `**≤10 MiB**`）——它们是数值真源，测试直接读这份文档；
7. `docs/desktop.md` 的一句叙述（含 `4 张 PNG/JPEG` 与 `10 MiB`）。

## 通用编写原则

- **模型名匹配语言无关**（Fable / Qwen / K3 / GLM…），**UI 词必须中英双写**（`/Expert|专家/`、`/^(high|高)$/i`）；zh/en 之外不承诺，靠诊断兜底。
- 锚点优先级：`data-testid` / 稳定 `data-*` > `aria-*` 语义（role、aria-label、aria-checked/pressed）> 中英双写文本 > 结构位置。**禁止**用生成类名、`nth-child`、父子链。CSS-module 类名（元宝 `ThinkSelector_selected`、千问 `thinkingContent`）只能用 `[class*=]` 前缀匹配。
- **国产站常拒绝合成事件**（`isTrusted=false` 被忽略）：菜单项/radio/toggle 用**原生 `el.click()`**；国际站 Radix/Material 菜单用 pointer 事件序列 `openMenu()`。
- **`clickEl` 用 `detail:1` 拟真**：真实点击 `detail=1`，`el.click()` 与裸构造是 0——Kimi 新首页按 `detail===0` 过滤机器人点击（真机 2026-07-21）。
- **控件正在下沉到二级子菜单**（2026-08 两轮改版的共同形态）：顶层只留当前值，完整列表进子菜单。写新逻辑默认「顶层找不到 → 找子菜单入口 → 展开 → 再找」，别假设一层列表。
- **同一页面里不同语义的列表可能共用同一个 role**：ChatGPT 的 Model 与 Effort 子菜单都是 `[role=menuitemradio]`。取档位必须校验文本属于**档位标签集**，且整份列表只要带模型名就判定为模型菜单并拒绝使用——否则「最高档」会被点成末位模型。
- **每个菜单动作自己收尾**：菜单不关会罩住输入框，也会让后续动作点空（选完模型再点 Effort 只是把它关掉）。**但 `escMenus()` 不是万能的**——2026-08-31 真机实测：Claude(Base UI) / ChatGPT(Radix) / 元宝 / 豆包 的菜单 Escape 有效；**Gemini、智谱、Kimi 三站 Escape 关不掉**（Gemini 连点 backdrop 都没用；Kimi 只收得掉 effort 子菜单、收不掉根菜单），这三站各自实现了 `_close()`：先 `escMenus()`，仍开着就**再点一次触发器/入口**。给新站写收尾时先真机验一次「Escape 到底关不关得掉」，别默认。
- **档位控件不一定是列表**：ChatGPT 2026-08-31 把 radio 列表换成了滑块（键盘左右方向键驱动，`End`/`Home` 无效）。遇到「菜单开着但一个可选项都找不到」，先找 `[role=slider]` / `aria-keyshortcuts` / `data-*-slider`，再断定控件消失。
- **有状态控件先读后点**（幂等）；菜单可能一次打不开，`openMenu` 要允许重试第二次；开关切换会重渲染，重渲染后的选项必须 `waitFor` 重取。
- **站点常有宽窄两种布局**：Claude 窄屏是 Adaptive thinking 开关、宽屏是 effort 子菜单；Gemini 窄屏模型按钮无 `aria-haspopup`。适配器须双布局兼容。
- **文案可能含零宽字符**（Claude 的 "Max" 实为 4 字符）：用 contains 匹配，别用 `^...$` 配长度。Kimi 适配器专门有 `_zap()` 去零宽字符。

## 站点卡（改某站只读这一张）

### Claude（`claude.ai`，`desktop/src/site-runtime/adapters-intl.js`）

- 档位：think = `_selectModel(/fable\s*5/i)` + `_setEffort("top")`（**取在场最高档**，当前是 Max，复读 `_THINK`）；fast = `_selectModel(/opus\s*5\.5(?![\d.])/i)` + `_setEffort("default")`（**Medium，即站点默认档**，`_EFFORT` 词表里 rank 1；不在场则抛错，不退到 Low/Max；复读点中那一项的首词）。**effort 是站点级记忆，换模型不重置**：1.0.1 之前 fast 只换模型不压档，think 过一次后快档会以「Sonnet 5 · Max」发出去（用户真机 2026-09-16）。`state()`：sonnet/haiku 带 `_THINK` 命中的高档 effort 判 null（不是预设档），否则 fast；Opus 5.5 的 Medium / 中判 fast（不扩展到旧 Opus 或 Fable 的 Medium）；Fable/Opus 其余按 effort 后缀判。
- **2026-09-23 菜单实测**：模型项文本为 `Opus 5.5For complex tasks`，版本后不用词边界，改用负向数字/小数点检查，兼容紧连说明且不误选 5.50。Effort 已平铺为 `[role="group"][aria-labelledby]`，关联标题为 `Effort`；标题必须在该 group 内，档位最近的带标签 group / menu 必须指回该标题 id，再按 `_EFFORT` 过滤。旧版子菜单仍兼容；两种结构都不放宽为仅按档位文本选择。
- **effort 的两个 testid 已消失（2026-08-31 真机）**：`effort-menu-trigger` / `effort-option-*` 全没了，Base UI 菜单只剩自动生成 id（`base-ui-_r_*`），全菜单只剩 `chat-input` 一个 data-testid。入口退化成文本为 **`EffortMax`**（`Effort` + 当前档）的 `[role=menuitem][aria-haspopup=menu]`，按 `/^(effort|强度|思考强度|努力)/i` 找；档位项是子菜单里的 `menuitemradio`，精确文本 **`Low` / `MediumDefault` / `High` / `Extra` / `Max`**（Extra、Max 是本次新增的两档）。
- **档位项与模型项同为 `menuitemradio` 且同时在 DOM**（顶层 4 个模型 + 子菜单 5 个档位），`_effortItems()` 做**两层语义校验**：① 最近的带标签 `[role=group]` 或 `[role=menu]` 的 `aria-labelledby` 必须指回 effort 标题/入口的 `id`；② 文本须命中 `_EFFORT` 档位标签集（由低到高的有序表）。少一层都会把「最高档」点成模型——一个叫「Max Preview」的模型就能骗过纯文本校验。**入口自身没有 `id` 时直接抛「Claude: Effort 入口缺少 id，无法校验档位归属」**：Base UI 哪天不再自动生成 id，第 ① 层校验就失去判据，此时宁可红也不许退回纯文本校验（fail-closed）。`_setEffort()` 取 rank 最高的一项（撤掉 Max 自动退 Extra，再撤退 High），点完 `waitFor` 复读 `_label()` 命中 `_THINK` 才算成功，否则抛「Claude: 目标 effort 未生效」。
- **「无 effort 入口静默 return」的例外已撤销（2026-08-31）**：控件仍在，只是选择子变了；入口缺失 / 档位为空一律 throw。旧的 `_thinkSwitch()` 裸开关分支同时删除（真机已无该开关）。
- **模型菜单已下沉（2026-08）**：顶层保留 Fable 5 / Opus 5 / Sonnet 5 / Haiku 4.5，其余进「more models / 更多模型」子菜单，`_selectModel` 顶层等 900ms 找不到才展开子菜单；选中后 `sleep(700)` + **`escMenus()`**（子菜单不关会罩住输入框并让后续动作点空；Base UI 菜单 Escape 有效，与 Gemini/智谱/Kimi 三站不同）。
- 发送键 `button[data-testid="chat-input-send"]`（真机 2026-08-31；`aria-label="Send message"` 随界面语言变，只当兜底），原生 click 有效；此前「拒绝合成点击」的结论是误判——当时点的是侧栏同名假按钮（见发送路径表）。**两个已知坑**：侧栏每条会话的 `More options for <标题>` 按钮标题含 send/发送 时会匹配同一选择器且纵向落在带内（真机带内 9 个）；长提示词把 ProseMirror 撑高后发送键会跌出旧的 240 纵向带（15 行即失效）。两者都由 `desktop/src/site-runtime/send.js` 处理。停止键 testid 是 `chat-input-stop`（`stop-button` 是 ChatGPT 的形状，Claude 上零命中）。`answer()` 新版取末条 `[data-testid="assistant-message"]` 内最后一个 `[data-perf-reply-text]` 正文块（2026-10-02 真机：旧 `.font-claude-response` 已零命中）；只有思考/工具时返回 null，不回退旧回答。历史归属锁定助手容器及其 `data-turn-key`，允许正文块重绘。旧版仍取 `.font-claude-response` → `.row-start-2`（折叠的思考头在 `.row-start-1`），取不到回退旧容器。`attach` 走 `input[data-testid="file-upload"]` + `S.setInputFiles`。

### ChatGPT（`chatgpt.com`，**`desktop/src/site-runtime/adapters-intl2.js`**）

- **本站单独一卷**：`adapters-intl.js` 触及 300 行上限后按站分卷，ChatGPT 移到 `adapters-intl2.js`（Claude / Gemini 留在 `adapters-intl.js`）。分卷登记见本文「加新站点」。
- 档位：think = `_selectModel()`（维护候选 GPT-5.6 Sol） + `_pickEdge(true)`（滑块推到**最右端** = 最高档）；fast = 同模型 + `_pickEdge(false)`（推到最左端）。**不写死档位标签**，站点加减档自适应。`state()`：pill 为空或命中 `_OPEN_PILL`（`thinking effort|思考(强度|力度)?`）→ null（**菜单开着时 pill 显示的是控件名，不是档位，属非终态**）；`_tier()`（先剥版本前缀 `/^(?:gpt-?)?5\.[3456](?:\s*sol)?/i`）命中 `instant|medium|极速|即时|均衡|中` → fast；原始文本命中旧模型 `(?:gpt-?)?5\.[345](?!\d)|\bo3\b` → null（不许冒充 5.6 的 think）；命中 `high|pro|高` → think；其余 null。
- **2026-08-31 改版：档位从 radio 列表换成一根滑块**。菜单是 Radix popper `[data-testid="composer-intelligence-picker-content"]`，里面**没有任何 `aria-haspopup` 子菜单入口**——旧的 `_openEffort()`/`_tiers()` 因此永远找不到档位列表，think/fast 双双抛错而 `diagnose()` 全绿（本次事故的表象）。现结构：① `[role=menuitem][aria-label="Select model"]`（文本是当前档名）；② `[role=menuitem][aria-label="Power"]`，`aria-keyshortcuts="ArrowLeft ArrowRight"`，内含 `[data-model-reasoning-effort-slider]` 与一个 `[role=slider]`（`aria-valuenow/min/max` = 当前位次 / 0 / 4）。
- **档位真值只认位次「X of N」，不认档名**：0–3 档的档名不在任何可选中节点上，只出现在 Power 项 `aria-describedby` 指向的朗读文本里（`Pro, 5 of 5.` / `Use Left and Right arrow keys to adjust power.`）。`_level()` 先读 `[role=slider]` 的三个 aria 数值，读不出才回退正则解析那句朗读文本。位次映射（真机实测全表）：0=Instant / 1=Medium / 2=High / 3=Extra High / 4=Pro。
- **切档靠键盘，且只有左右方向键有效**：`_pickEdge` 聚焦 Power 项后逐格发 `ArrowRight`/`ArrowLeft`（`KeyboardEvent` 必须 `bubbles:true`），每格 220ms、循环上界 = 档位数，端点会饱和不越界。**`End` / `Home` 真机实测无效**（值纹丝不动），不要拿它们省循环。收尾比对 `lv.now === goal`，不等就抛「ChatGPT: 档位未到端点」。
- **模型 radio 常驻菜单**：Advanced 视图（`composer-model-picker-slider-advanced-view`）不必展开也在 DOM，`GPT-5.6 Sol`(checked) / `GPT-5.5` 两项随时可取。`_selectModel` 先直接找，找不到才点 `aria-label="Select model"` 入口；**已 `aria-checked=true` 就直接返回不点**（点了会连带把菜单收掉）。
- 档位锚点 `_anchor()` 使用**纯选择子**：优先 `button[data-codex-intelligence-trigger="true"][aria-haspopup="menu"]`，旧版 `button.__composer-pill[aria-haspopup="menu"]` 兜底。2026-09-28 开发态复现：新版移除了 `__composer-pill`，原选择子导致入口项红、档位未知；菜单仍有 Power 滑块与模型 radio，但 `composer-intelligence-picker-content` testid 已缺失，由 `_power()` 兜底识别。按钮含 `visibility:hidden` 的测量文字，`state()` 改读 `innerText`（不支持时回退 `textContent`），且 `aria-expanded=true` 时返回 null。**不许做文本前置校验**：菜单展开时按钮是控件名。入口项反映锚点是否命中，档位项反映标签是否可读；不凭诊断红项断言按钮真的消失。
- `answer()` 优先取 `[data-content-search-unit-key]` 内具有 `[data-conversation-role="assistant"]` 标记的 `[data-markdown-text-style="assistant-message"]`，旧 `[data-turn="assistant"]` 末条 → `.markdown` 及 `[data-message-author-role="assistant"]` 保留兜底。2026-09-29 新版真机已移除旧标记；历史用户正文认 `[data-user-message-bubble]`，同轮新旧标记嵌套只计一次；回答根及身份取 `[data-chatgpt-selection-message-id]`，仍用文档顺序拒绝新用户之前的旧回答。`attach` 走 `#upload-photos`。唯一实现 `stop()` 的站（`[data-testid="stop-button"]`，回退 aria-label 含 stop answering/streaming/generating 的按钮）——**目前无调用方**。
- **中文界面（用户截图 2026-09-15）**：菜单打开时 pill 显示「思考强度」，命中 `_OPEN_PILL`；模型 radio 三项 **「最新」（默认勾选，GPT-6 Astra 别名）/ `GPT-5.6 Sol` / `GPT-5.5`（10 月 14 日下线）**。适配器仍显式选 `GPT-5.6 Sol`，不跟「最新」——它指向谁由 OpenAI 随时改，think/fast 两档要落在同一个已知模型上。`_power()` 里的其余中文候选（强度 / 力度）仍是直译未验证。

- **2026-09-29 切档证据**：现代菜单的 Power 最近 `role=menu` 包含模型 radio，匹配范围限定此菜单（兼容旧 testid）。实际选中 GPT-5.6 Sol 并复读后，把滑块推到 4/4 或 0/4；`selection()` 在菜单仍可读时返回 `preferred`，关闭后仅凭标签返回 `mode_only`，不复用缓存模型。缺字段、隐藏滑块、模型未选中均不能宣称精确确认。
- **2026-09-30 副本实测**：首轮先出现 `/c/local-chatgpt%3A<id>`，再变为 `/c/<server-id>`；旧规则只识别 `WEB:<id>`，会误判用户切会话并封存空副本。`history.js` 只把 `WEB` / `local-chatgpt` 加 `:` 或 `%3A` 的明确临时格式视为尚未确定路由，正式地址仍锁定；未知前缀、浏览器前后退、其它正式会话不能沿用归属。流式正文还会在首 token 后新增 `[data-chatgpt-selection-message-id]` 包装；历史回答根优先用生成前后都存在的 `[data-content-search-unit-key]` 及其 key，旧布局仍回退原根。不要用延迟插入的 selection 包装锁定首 token，否则下一次读取就误判替换，仅保存开头。

### Gemini（`gemini.google.com`，`desktop/src/site-runtime/adapters-intl.js`）

- 档位：think = `_selectModel(/\b\d+(?:\.\d+)?\s*pro\b/i)` + `_setThinking(/^(extended|扩展)/i)`（开）；fast = `_selectModel(/\b\d+(?:\.\d+)?\s*flash\b(?!\s*-?\s*lite)/i)` + 同项**关**。**两侧模型正则现在都版本无关**：2026-08-31 事故当天只修了 fast 一半，深档写死 `3.1 Pro` 同样会在 Google 升版号那天整站抛「未找到模型」。Pro 侧没有 Flash-Lite 式的更弱同名档，因此不需要后瞻。
- **快档模型正则必须版本无关**（2026-08-31 事故）：菜单从 `3.6 Flash` 换成 `3.7 Flash`，写死版本号的旧正则当天让整站 `fast()` 抛「未找到模型」。现按「任意版本号 + Flash、且不是 Flash-Lite」匹配，后瞻同时挡住 `Flash-Lite` 与 `Flash Lite` 两种写法——**Lite 是更弱的另一档，绝不能被当成快档选中**。think 侧已对称改成「任意版本号 + Pro」，Extended thinking 开关不动。
- 菜单项实测（2026-08-31）：`3.5 Flash-Lite Fastest answers` / `3.7 Flash All-around helpNew` / `3.1 Pro Advanced reasoning`(selected) / `Extended thinking Complex problem solving`。当前选中项带 `.selected` 类，鼠标高亮项带 `.active` 类——**判选中只能看 `.selected`**。
- **`escMenus()` 对本站无效**（2026-08-31 真机：Escape 与点 `.cdk-overlay-backdrop` 都关不掉，`aria-expanded` 一直是 `true`），**只有再点一次触发器才收**。所有收尾一律走 `_close()`：先 `escMenus()`，仍开着就 `clickEl(_modelBtn())`。菜单不关会罩住输入框、让随后的注入点空。`_selectModel` / `_setThinking` 的每条出口（含 throw 前）都已改走它。
- 模型按钮 `_modelBtn()`：先找 aria-label 含 `mode picker` 的 button，回退 `button[class*="input-area-swi"]`（窄屏模型按钮无 `aria-haspopup`）。菜单项选择子常量 `_MI = "button.mat-mdc-menu-item, [role=menuitem]"`；菜单可能要 `openMenu` 两次。
- **`_MI` 必须过 `_items()` 只取可见项**（2026-08-14 真机）：页面常驻一个隐藏的导出菜单（`gv-pm-saved-export-menu gv-hidden`，含 JSON / Markdown 两个 `[role=menuitem]`）。老写法 `if (!document.querySelector(this._MI)) openMenu(btn)` 因此恒判「菜单已展开」，**模型按钮从来没被点开过**，随后在 `[JSON, Markdown]` 里找 Flash 自然抛「未找到模型」。开菜单改用 `aria-expanded !== "true" || !this._items().length` 判定，找项一律走 `this._find(re)`。
- **`state()` 按模式名判粗档位，不是复合条件**：aria-label 现为 `Open mode picker, currently <Mode>`（切到深度思考后是 `currently Pro Extended`）。判定顺序是 `flash` → fast，否则 `\bpro\b|extended|扩展` → think，其余 null——aria-label 不报 Extended thinking 开关状态，所以不能拿它证明思考已开；`think()` 仍会幂等地把 Extended thinking 一并打开。
- `_setThinking` 双布局：当前布局是模型菜单里的直达开关（按 `.selected` 类或 `aria-checked` 幂等点击）；旧布局走 `/thinking level|思考(等级|程度)?/i` 嵌套子菜单，最多重开子菜单（`openMenu(trig)` 指针序列，**不是 hover**——重发 hover 那招是 Kimi 的，两站机理不同别互抄）并重取目标项 6 轮，命中后先 `focus()` + Enter keydown 再 `clickEl`。**子菜单在但目标等级缺失必须抛「Gemini: 思考等级选项未找到」**；整段子菜单缺席才算合法静默跳过。
- `attach` 先展开 Upload & tools，再取无 capture 的 `image/*` 输入并等待附件确认，finally 关菜单。`answer()` 取末个 `message-content` → `.markdown`，回退整块。
- 中文界面报「切不动」时，先真机核对「扩展」这个标签再改正则——英文 Extended 已真机确认，中文是直译候选。真机探测坑（同 URL 双 page target；**批量重载站点视图可能触发 Google「unusual traffic」验证码插页**）见 `docs/verify.md`「探测坑」。

### DeepSeek（`chat.deepseek.com` / 适配器键 `deepseek.com`，`desktop/src/site-runtime/adapters-cn.js`）

- 档位：think = `_selectMode(/Expert|专家/)` + `_setDeepThink(true)`；fast = `_selectMode(/Instant|快速/)` + `_setDeepThink(false)`；另有图片专用档 `thinkImage`/`fastImage` = `_selectMode(/Vision|视觉/)` + DeepThink 开/关（九站唯一实现图片档的站）。
- **首屏模式 tab 已撤（用户截图 2026-09-15，随 V4.1-Flash 合并）**：空对话 composer 只剩「深度思考」「智能搜索」两个 `.ds-toggle-button`，`_selectMode` 对 radio 缺失本就静默跳过，`thinkImage`/`fastImage` 的 Vision 选择同样落空、只剩 DeepThink 开关生效——radio 分支保留为旧版回退，别删也别扩。
- **`state()` 优先读常驻 composer 的 DeepThink 开关**（`aria-pressed` true→think / false→fast），开关不在时才回退首屏 radio（`aria-checked` 的那项，`Expert|专家`→think、`Instant|快速`→fast、其余 null）。radio 在首条消息后从 DOM 消失（真机 2026-07-11），只读 radio 会整个对话期恒 null——外壳里的档位标注读不出、巡检误报红、二轮切档失去真实确认。**`diagnose()` 也有意不列这个 radio**，否则聊天中恒红误报。
- DeepThink 开关锚点：文本含 `deepthink|深度思考` 的 `.ds-toggle-button`，按 `aria-pressed` 幂等；**开关缺失即抛异常**（常驻 composer，静默 return 会让 runMode 误报成功）。点击后**复读 `aria-pressed`**，未生效抛「DeepSeek: DeepThink 未生效」。模式 radio 用 `findByText('[role="radio"]', re)` 且**只能用原生 `el.click()`**（开关走的仍是 `clickEl` 合成序列；「站点拒绝 `isTrusted=false`」这条旧论据其实不成立——`el.click()` 同样是 `isTrusted=false`，要换成原生 click 得先真机验证）。
- 发送键见发送路径表：图片处理期间只加 `ds-button--disabled` 不设 `aria-disabled`，必须等真正可用（`submit(el, deadline)` 的 deadline 就是为此）。
- `answer()` **从后往前遍历** `.ds-message`，直到找到第一条含非思考 `.ds-markdown` 的消息才返回（用户消息容器也是 `.ds-message`，靠这个回退跳过）。**别简化成 `msgs[msgs.length-1]`**。`attach` 走常驻 `input[type="file"][accept*=".png"]`（2026-07-23 真机：接受合成 change，上传后预览 `img.alt` 保留文件名）。

### 豆包（`www.doubao.com` / 键 `doubao.com`，`desktop/src/site-runtime/adapters-cn.js`）

- 档位：think = `_select(/专家$/, "think")`、fast = `_select(/快速$/, "fast")`。**锚定的是后缀不是前缀**——菜单项实测带品牌与版本前缀（`豆包 2.1 Turbo 专家`），写成 `/^专家/` 会一项都匹配不上。**只切 composer 模式按钮的菜单项，无独立思考开关、无模型选择。**
- `state()` 读模式按钮文本：`/专家$/` 或 `/^豆包\s+[\d.]/`→think、`/快速$/`→fast、**其余 → null**。「超能模式」是**历史档位**（2026-08-31 真机复核菜单只剩 `豆包 快速` / `豆包 2.1 Turbo专家` 两项），`state()` 里**没有它的判定分支**：它若回归会落进「其余 → null」，表现为档位读不出，统一编排保留未确认提示后继续发送。`^豆包\s+版本号` 这条分支是因为选中专家档后按钮只回显 `豆包 2.1 Turbo`、后缀被吃掉（真机 2026-08-26）。
- `_select(re, expected)` 的第二参是**幂等短路的判据**：先 `state() === expected` 就直接返回，不开菜单。改档位正则时两个参数要一起对，只改正则会让短路永久失效（每次群发都白开一次菜单）。`_modeBtn()` 从候选中取离 composer 最近者，避免撞到侧栏标题；`_select` 最多 3 轮，`openMenu` 展开后对 `[role="menuitem"]` 用**原生 `item.click()`**，每轮 `escMenus()`；按钮缺失或 3 轮未选中都抛异常。
- `answer()` 从 `[data-message-id]` 中过滤掉自身或子节点带 `justify-end` 的用户消息（AI 消息无右对齐），取末条 → 不在思考块里的第一个 `.md-box-root`。思考块认三种标记（只在本条消息内）：插件节点 `data-plugin-identifier="block_type:10040 | thinking_block.scene:N"`（正文块是 `block_type:10000`）、思考进度区 `data-message-selection-module="thinking_progress"`、类名含 think（`think-collapse-block-<hash>` 等）。思考中展开的步骤标题同样用 MdBox 渲染成 `.md-box-root`，2026-10-04 第 4 轮快照里中途的副本是「正在思考\n\n规划说明结构」。现在没有正文、只有思考块时返回 null（同千问/Kimi），空占位消息仍返回消息本身；思考块折叠常驻而终态不是 MdBox（繁忙/违规提示、卡片、图片）时，取最后一个最外层思考块之后（逐层向上到消息为止）第一个自身不含思考块、有字或有图的兄弟，副本不带思考步骤（回归 `capture-chrome-regress.test.js`）。标记取自豆包前端包与真机 `data-plugin-identifier` 属性；思考中的真机 DOM 尚未直接采到。`attach` 走 `input[type="file"][accept*="png"]`。
- 渲染会**在中英文与数字之间插空格**——marker 匹配先去空白再比。

### 千问（`www.qianwen.com` / 键 `qianwen.com`，`desktop/src/site-runtime/adapters-cn4.js`）

- 有模型入口的日常聊天预设：快速 = Qwen3.7-千问 + 快速，思考 = Qwen3.7-千问 + 思考研究；不自动切换到工作模式寻找 Qwen3.8-Max。无模型入口且确认日常页面就绪时，只切快速/思考研究，不承诺底层模型。
- 有模型入口时，两档共用 `_MODELS` 的明确名称/别名，通过 `matchSelection` 幂等选中 Qwen3.7-千问，再分别 `_setThink(true)` / `_setThink(false)`。`state()` 共用同一匹配规则：模型命中且思考开启 → think，关闭 → fast；缺少模式按钮或非预设模型 → null。`selection(mode)` 仅在当前精确模型与目标模式均可读时返回 `preferred`，入口消失后仅返回 `mode_only`，不缓存上轮结果。
- 模型触发器 `_trigger()`：先找 `[aria-haspopup="dialog"]` 且文本含 `Qwen3` 的节点；找不到回退在顶部 `.desktop-no-drag` 控件区按文本找最内层（文本以 Qwen3 开头、长度 ≤25、子节点 ≤3 的 div/button/span 取最后一个），排除正文同名模型——**`aria-haspopup` 由前端延迟水合**，新加载页一段时间内只有纯文本节点。
- **无模型入口的页面（2026-09-28）**：用户 Windows 截图为宽版日常首页，左上没有模型选择，快速按钮仍在；该环境报告模型下拉 `control=false`、思考开关 `control=true`、档位 `tier=false`。本机已登录页正常宽度仍有入口，临时收窄至实测 `innerWidth=267` 时入口从 DOM 消失，可复现相同诊断及 `runMode=false`；恢复宽度后切档正常。这只是同类失败路径，不能据此断言远端由宽度导致，也不能确认灰度改版。旧实现先选模型再切模式，入口缺失会抛错；不得用缓存模型或仅凭快速按钮把未知模型冒充预设。经用户同意，无模型入口时新增 `_modeOnly()`：可见且已选中的 `[role="tab"]` 文本为日常/Daily、`findComposer()` 成功、可见快速/思考研究菜单按钮三者同时成立，才跳过模型选择，后续 `_setThink` 仍执行并复读确认。该分支 `state()` 仅按模式返回 think/fast；模型下拉检查保留 `ok:false`，但 `kind:tier` 只作提示。入口恢复后立即恢复模型约束，无缓存；其它缺失仍为 control 故障。远端版本仍需 Windows 真机验收。
- **2026-09-29 真机模型卡**：模型对话框用触发器 `aria-controls` 定位；旧布局回退只接受唯一可见且有“模型/Models”标题的 `role=dialog`。模型项是普通 `div.group.cursor-pointer` 卡，精确名称在 `div.truncate` 叶节点，另有“设为默认”按钮。匹配只在该对话框内取语义选项或已证实的标签与卡片，过滤隐藏/禁用/歧义项，点击卡片后复读触发器；正文不能充当候选，不点击默认设置按钮。当前原生 `click` 或单独 PointerEvent 不打开模型菜单，改用生产 `openMenu` 的完整事件序列；先收菜单并夹取等待 500ms，避免旧关闭动画吞掉展开事件。
- 思考按钮 `_thinkBtn()`：优先可见的 `button[aria-haspopup="menu"]` 且 aria-label/文本命中 `/^(快速|思考研究|Fast|Thinking Research)$/i`；回退到内部 span 或自身文本为 `/^(思考|Thinking)$/i` 的旧版裸按钮。`_setThink(on)` 先读后点，新版派发 pointerdown 后在可见 `[role="menuitemcheckbox"]` 里原生 click 目标项，收尾复读校验，未生效抛「千问: 思考开关未生效」；按钮缺失即抛（常驻 composer）。**三条路径（选项未找到 / 成功点击后 / 复读失败前）都各自 `escMenus()` 收尾**，残留菜单会罩住输入框让随后的注入点空。
- 受控编辑器，走 core 的 `beforeinput` 注入。`answer()` 取末个 `.answer-common-card` 内、排除祖先 `[class*="thinkingContent"]` 后的最后一个 `.qk-markdown`（思考段与正文同为 `.qk-markdown`，祖先类名带 CSS-module 哈希后缀）；只有思考段时返回 null，空占位卡仍返回卡本身。长文写作卡（「创建于 …」卡片）挂在正文之后，由 `md.js` 按外壳 `data-card-highlight-target` 剔除，见上文「汇总复制」第 4 条。代码块是 react-syntax-highlighter：每行一个块级 span、行首 `span.linenumber`（user-select:none）、行尾自带 `\n` 文本，`md.js` 逐文本节点取代码并跳过行号栏（2026-10-03 真机曾把行号和空行带进围栏）。`attach` 使用 PointerEvent 展开附件菜单，再选上传图片创建动态 input；不使用 drop/paste，finally 关菜单。

### Kimi（`www.kimi.com` / 键 `kimi.com`，`desktop/src/site-runtime/adapters-cn2.js`）

- 档位（2026-07-21 用户定案）：**think = K3 + Max、fast = K3 + Standard**。模型非 K3 时先 `_select("K3")` 再 `_setEffort`：think 用 `/^(Max|极致|最大|最高|最强)$/i`，fast 用 `/^(Standard|标准)$/i`。**`state()` 要求 `_model()` 严格等于 "K3"**，否则直接 null（K2.6 只有 Standard / High，无 Max 档——这是判断「用户停在 K2.6 时 state() 为何恒 null」的唯一依据）；再看 effort 映射两档，其余 null。中文 UI 的 Max 标签是「极致」（用户实证；chrome-dbg 里站点跟账号语言恒英文，中文标签只能靠用户回报）。effort 切换不导航。
- 锚点：模型入口 `.current-model`（`.name` 读模型名、`.current-effort` 读强度），菜单项 `.model-item`（按 `.name` 精确等值），强度行 `.effort-item`（`.effort-title` 命中 `Thinking|思考|推理`），子菜单项 `.effort-option`（`.effort-name`）。**读到的每一处文本都先过 `_zap()` 剥零宽字符再比**——`_model()` 与 `.model-item` 的比对同样要过（此前只有 effort 两处过，`.name` 带零宽时 `state()` 恒 null、`_select` 抛「目标选项未找到」并把排障误指到 effort）。
- 换模型会 SPA 路由跳 `/agent?chat_enter_method=change_model`（含会话内切换，会离开会话视图）；该面发送**偶发**对真人也失效（真机连可信打字/点击/Enter 都发不出，判断为站点高峰限流禁用对话）。发送失败诚实报 `submit_unconfirmed` 可 retry，**不要因此改掉 K3 映射**。
- **`inject` 必须用 `el.focus()` + 显式 Range 全选 + `execCommand("insertText")`，失败抛异常禁回退**：合成 `beforeinput` 会让 Lexical 的 DOM 与 model 分叉并冻死编辑器（发送键失灵，可信键盘也不再接受）。新开页 focus 后选区未必落进编辑器，要显式设 Range。
- **effort 子菜单的 hover 会丢**：菜单开启动画期间合成 hover 丢失，effort 行节点还会被重挂 → **每轮重新取行、重发 hover（循环 4 次）**，不是单次 hover 后干等；点击被吞时末尾复读 `_effort()` 校验，不许静默成功。
- **K3 档位真机复核（2026-08-31，新开标签验完即关）**：模型项为 `Instant`(checked) / `K3` / `K3 Swarm`；切到 K3 后 `.effort-option` 三项 `Standard` / `High` / `Max`（Max 带「Consumes more credits」）——**现有词表无需改**。K3 下还多出第二个 `.effort-item` 行「Context Length」，合成 hover 打不开它的子菜单、未观察到 `.effort-option` 撞名；即便撞上，末尾复读 `_effort()` 也会拦住错选。
- **`escMenus()` 只收得掉 effort 子菜单，收不掉模型根菜单**（2026-08-31 真机：Escape 后 `.model-item` 仍可见、入口仍带 `.active`），**再点一次入口才整体关掉**。收尾统一走 `_close()`：`escMenus()` → 入口仍带 `.active` → 再 `click()` 一次入口。`_select` / `_setEffort` / `attach` 的每条出口（含 throw 前）都已改走它。
- 唯一实现 `submitted(text)` 的站（比对末条 `.chat-content-item-user` 的 `.user-content`，去零宽 + 折叠空白后与原文等值）——Kimi 发送后会重挂页面并断开消息端口。消费端是 `desktop/src/main/broadcast.ts`：`submit_unconfirmed` 时只读探 `wasSubmitted`（固定 1.5s 窗口、独立于群发 deadline——deadline 到点才收到不确定是常态；单次探测 ≤300ms，无应答再问，连续 5 次明确没见到才判「未提交」），**确认「未提交」后是否自动重发一次由模块常量 `POLYASK_KIMI_RESUBMIT` 决定，当前 `false`**——它是模块常量不是设置项，两条真机硬用例（新会话空态、末条是上一轮内容）通过前一律保持关闭，届时也随同一次发版改。`answer()` 取末个 `.chat-content-item-assistant` 内、排除 `.thinking-container` 后的最后一个 `.markdown`；只有思考段、正文 `.markdown` 还没出现时返回 null（曾退回整条消息，思考阶段的推理文本被当正文写进副本，2026-10-03 真机）。后台视图不出帧时（2026-10-04 Linux 开发态实测 rAF=0），发送后输入框已清空、路由与消息却要等首次绘制才出现；服务端记录显示问题在提交当时就已送达（会话 createTime 与群发同秒），只是渲染被推迟，故 `composer` 证据在这种情况下是真的。此时 `submitted(text)` 读不到末条用户消息、会判「未提交」。已处理的部分：`read-commands.js` 的 `wasSubmitted` 在页面不出帧或视图过渡未结束（Windows 真机 Kimi 过渡挂 3 分钟以上、服务端已建会话）时回「不支持」，不再给出可触发重发的否定；主进程 `paint-recovery.ts` 在主帧提交与窗口恢复/显示时重申 `setBackgroundThrottling(false)` 把停帧视图救回。剩余前提：**`POLYASK_KIMI_RESUBMIT` 打开前仍须过 F067 两条真机硬用例**，且须真机确认「出帧 + 无过渡 + 末条不是本次」不会在已送达时出现。`attach` 用 `input.hidden-input[type="file"]`，没有就先点 `.toolkit-trigger-btn`，再按 deadline 剩余预算夹取等待（`Math.min(1500, deadline-now)`），**无论取到与否都经 `_close()` 收尾（含 `escMenus()` 和根菜单关闭）**。**动 Kimi 图片路径前先真机跑一次 `attach`**——最近一次验证时间未记录，别默认它还能用。

### 元宝（`yuanbao.tencent.com`，**`desktop/src/site-runtime/adapters-cn3.js`**）

- **本站单独一卷**：`adapters-cn2.js` 当时贴着 300 行上限，2026-09-15 加模型子菜单逻辑时把元宝拆到 `adapters-cn3.js`（Kimi / 智谱留在 `cn2`）。
- 档位（用户截图 2026-09-15，中英文界面各一）：composer 的 `button[aria-label="Switch model"]`（中文 `切换模型`）菜单 = **「Models / 模型」子菜单入口 + 模式项**。模式项在 Hy3 下是 Instant / Thinking / Expert（中文「快速回答 / 深度思考 / 专家模式」），**选中 Hy4 preview 时只剩 Expert**（模型描述写明 "Expert mode only"）。**新会话默认模型是 Hy4 preview**。映射 **think = 模型 Hy4 preview**（站点强制专家，无独立思考项；`_set(true)` 选完模型复读按钮到 Expert 才算成功）、**fast = 模型 Hy3 + Instant**（默认态菜单里没有 Instant，`_set(false)` 必须先 `_selectModel(Hy3)` 再 `_selectMode(Instant)`；按钮已是 Instant 时直接返回，不开菜单）。
- **模型子菜单**：入口是 `[role=menuitem]`，文本 = `Models`/`模型` + 当前模型名（如 `ModelsHy3`），**只在模式菜单开着时存在**，所以 `_model()` 是打开菜单后才可读；子菜单靠悬停展开：入口 `button[role=menuitem][aria-label="Select model"]` 的 React 处理器只有 `onMouseMove` / `onMouseLeave` / `onClick`（CDP 真机 2026-09-16），**只有合成 `mousemove`（带 clientX/Y）能打开**，`mouseover` / `pointermove` / `click` / 方向键 / Enter 都打不开；`_openModels` 先 `mousemove`，没开再 `click` 兜底，一次不成重来一次。选中模型后**根菜单留着、子菜单收起、按钮立即回显**（Hy4 preview → Expert；切回 Hy3 会恢复上一次的模式）。模型项与模式项同为 `[role=menuitemradio]`、同时在 DOM，靠容器 `aria-label="Model list"`（中文候选 `模型列表`，未验证）区分：`_isMode()` 排除该容器、`_modelItems()` 只取该容器，**两层语义校验缺一不可**（只做文本校验挡不住「模型取名叫深度思考版」，只做容器校验挡不住站点把模型塞进同一层）。选完模型后**重开一次菜单复读入口尾缀**确认，不猜菜单收没收。
- **`state()` 是粗判**：菜单关着读不到模型，只按模式判——Expert/专家 → think（Hy4 preview 强制专家；Hy3+Expert 也会读成 think，那是用户自己停的档）、Instant/即时/快速 → fast、**Thinking/思考 → null**（不再是预设档，同 Kimi Instant / 千问 Qwen3.7+快速）。`resolveTier` 每次仍跑一遍幂等适配器，粗判只影响圆点与巡检。
- 旧版 `[class*="ThinkSelector"]` 深度思考 toggle 仍作为 A/B 回退（只有新版模式按钮整个不存在时才走），开态判据为 className 含 `ThinkSelector_selected`；点击后**同样复读 `_isOn()`**，未生效抛「元宝: 深度思考未生效」——新版分支本就有复读，旧版此前是全站唯一遗漏的静默成功路径。新版发送键是非 button 的 `[aria-label="Send"]`（中文回退 `[aria-label="发送"]`），disabled 时返回 false；旧 `.icon-send` 已下线。
- `inject` 无（真机实证 `beforeinput` 不生效、`execCommand` 生效，由 core 既有回退链覆盖）。`answer()` 取末个 `.agent-chat__conv--ai__speech_show` 内的最后一个正文 `.hyc-common-markdown`：排除带 `-style-cot` 修饰的思考块，以及位于 `.agent-process-timeline`、`[data-agent-group-think-content]`、`[class*="__think"]`、`[class*="cot__think"]` 内的同类节点（**不排除就把思考全文混进汇总复制**；新版思考段在时间线里、旧过滤器命中 0，2026-10-04 真机）。没有正文、但思考正文/时间线里有文字时返回 null；只剩回复完成后常驻的 `deep-search-agent__think__header` 头部条时仍退回整个回答容器（非 markdown 的繁忙提示、卡片类终态要读得到）。**A/B 对比界面（「您更喜欢哪个回答 / 回答 1 / 回答 2」，偶发、未复现）**：2026-10-05 一次真机样本里两份回答是同一个 speech_show 里先后流出的两个正文块，`answer()` 取 DOM 末块（推断为「回答 2」）；重新打开该会话有翻页「1 / 2」、默认第 1 页，副本可能与重新打开时默认看到的不是同一份（两份内容相同，未坐实）。`data-conv-multi-answer` 不能当识别信号。用户决定先观察、暂不改（docs/verify.md 2026-10-05/06 后续核对）；测试时不点偏好按钮（会以用户账号提交反馈）。`attach` 新版每次都打开 Add/添加 → Upload Image/上传图片，临时阻止 input.click 的系统选择窗，再经 `S.setInputFiles` 上传已有文件。旧 input 虽仍连接，第二次直接上传不会进入站点附件区；重新打开菜单会激活其处理器。等待菜单与 input 各最多 1.5s，轮询与最终上传均受绝对 deadline 约束；finally 移除监听并关菜单。旧版没有 Add 按钮时复用 input，无 input 才回退 `S.dropFiles`。2026-09-21 登录开发态生产群发已确认完整菜单创建、关菜单、上传链成功。

### 智谱（`chatglm.cn`，UI 标签「智谱」，站点全名智谱清言，`desktop/src/site-runtime/adapters-cn2.js`）

- 档位：think = `_pick("极致", true)`、fast = `_pick("快速", false)`。**「极致」是 2026-08-31 新增的最强档**（描述「全力推理，耗时更长」），think 从「深度」升到它；`_TIERS = ["极致","深度"]` 由强到弱，站点撤掉极致时 `think()` 自动降级点「深度」（不是抛错——深度仍是可用的思考档）。
- **弹层现在分两段**（真机 2026-08-31）：**模型段**（`GLM-5.3` / `GLM-Flash`，后者描述「5.3-Flash，回复速度快」，当前选中）+ **档位段**（`快速` / `深度` / `极致`），两段**同为 `.think-mode-item`**。`.has-submenu` 那一项是档位段的父项，其名随当前档变。
- **适配器不选模型**：当前停在哪个模型就用哪个。`_itemByName` 排除 `.has-submenu` 后按 `.item-name` **精确等值**取项，现有六个名字互不重叠——站点若把某个模型改叫「快速」之类，这里会当场错位，要立刻改。
- `state()` **只读不开菜单**（弹层关闭时菜单项仍在 DOM，只是 rect 归零）：`_TIERS` 里任一项带 `selected` → think（**极致 / 深度都算**）、「快速」带 selected → fast，**其余（含「标准」若回归）→ null**。
- 选档序列（chrome-dbg 实测）：hover + click `.think-mode-trigger` 开弹层 → `sleep 350` →（档位档）hover `.think-mode-item.has-submenu` → `sleep 300` → 原生 click 目标项 → `sleep 500` + `_close()` → **复读只读判据 `_selected(name)`**，未命中抛「智谱: 档位未生效」。触发器缺失直接抛；目标项未找到时先 `_close()` 再抛。`_hover()` 需连发 pointerenter/mouseenter/pointerover/mouseover 四种事件。
- **脆弱点（必读）**：合成 hover 在真机上**并不真的展开子菜单**（档位项 rect 恒 0），只是靠 `.click()` 仍能触发 Vue handler 才碰巧能用。收尾的 `_selected()` 复读是唯一防线，**别把它删了**；哪天站点改成「不可见就不响应点击」，这里会立刻整档失效。
- **`escMenus()` 对本站无效**（2026-08-31 真机：Escape 关不掉 el-tooltip 弹层），**再点一次触发器才收**。收尾走 `_close()`：`escMenus()` → 仍开（按 `.think-mode-item` 的 rect 判）→ hover + click 触发器。弹层不关会罩住输入框让注入点空。
- 无 `submit`，靠通用链（先试标签按钮，实际靠 Enter，textarea 可发）。`answer()` 取末个 `.answer-content` 内、排除 `.text-advance-thinking-content` 后的最后一个 `.markdown-body`。`attach` 使用 `.upload-demo input.el-upload__input[type="file"]` 的聊天区本地文件入口；不使用旧 `.img-input` 或头像 input，支持整批图片并沿用绝对 deadline。
- **加载极重**：水合期（~30s）连站点命令都无响应，安定后正常。真机验证要新开站点视图 + 长等待。

## 站点改版应对剧本（修复流水线）

触发源按可信度排序：用户诊断报告（`Alt+H` 站点状态 →「复制诊断报告」，自带版本、环境与逐项检查结果）＞ 巡检红 ＞ 哨兵 issue（label `release-watch`——只代表官方发了公告，不代表 UI 已变）。

1. **定层**：真机复现，记下现象与 `code`，先确认坏在哪一层——未注入 / composer / inject / submit / state / answer（用户报障按「四问」问齐）。
2. **提案**（可交给 LLM 生成，人审兜底）：按现场 DOM 证据改锚点——自动取证已退役，证据靠手工在目标站点视图里读 DOM（环境与坑见 `docs/verify.md`）。硬性护栏逐条过——判定阈值留 ≥20% 余量；锚点优先级 data-testid ＞ aria/role ＞ 中英双写文本（见「通用编写原则」）；同 role 列表先校验语义；缺控件 throw 不静默（例外只有上文 3 处）；不碰 `submitted()`/自动重发铁律；**只改锚点，不动错误码协议与编排契约**——协议稳定性是这个仓库最贵的资产。
3. **离线回归**：补/改对应 `desktop/scripts/*.test.js`（改模型正则按惯例配专项测试），`cd desktop && npm test && npm run typecheck` 全绿；跨端的 5 个仍在 `bash scripts/verify.sh`，**两条都要跑**——适配器测试全在 `desktop/scripts/` 下，只跑 `verify.sh` 对适配器改动几乎零覆盖。
4. **人审 diff → 真机回归**：重启开发态 Electron（`cd desktop && npm start`）让改动生效，在目标站点视图里用 `__AMS` 复现，九站巡检（`diagnose` 就是现成的 canary；「入口项」与「档位可读」是两个独立信号，只红后者 = 标签集漂移，别去找按钮）。
5. **收尾**：更新本文件对应站点卡 + `CHANGELOG.md` 未发布段；模型正则改了同时检查 `state()` 的判定分支。

## 逐次提问的只读副本

`history.js` 保存提交前的用户消息基线与本轮 token；`history-adapters.js` 为九站注册只读 `historyTurn()`。DOM 插入时绑定唯一新增且文本匹配的用户轮次，只有其后的回答才能进入快照。空基线要求观察到新用户节点插入，新增节点证据用 WeakSet 保存，避免页面初始化前 500 次无关插入耗尽容量；出现多个新轮次即停止。首次非空回答前允许已脱离文档的乐观用户节点重挂。绑定正文后以回答所属容器跟踪 Markdown 子节点重绘，不接纳另一个回答容器。

历史副本不再把 `generation()` 的「无停止键但存在回答节点」当成完成证据，也不根据文字静止时长宣称完成；快照里的 `generation` 只用于「生成中」，不能自称完成。**完整回答只认外壳正向证据**（2026-10-04 用户拍板）：`GenerationMonitor` 对本轮（同 runId、本次尝试已回包）确认收口——见过 generating 或页面侧 `complete_observed`，再连续三次完成读数——后经 `onComplete` → `QuestionCaptureService.complete` → `QuestionHistoryService.complete` 记下确认时的读序号并立即补读一次；**确认之后才开始读**、归属、未结束、非生成中、未截断且带正文的快照先记为封存候选，**另一次在候选回包 ≥3s（`SEAL_QUIET_MS`）后才开始的读读到逐字相同的正文**才封存为 `capture:"complete"`（采集服务按候选到期提前排复读，不等 5s 轮询）。这是正向确认之上的增长否决，不是完成证据：元宝输入框有草稿时停止键隐藏、回答仍在流，监视会误收口，续长的正文否决封存；停止键消失后正文仍可能续长 1.79s（ChatGPT 实测），3s 留足余量。若元宝流式中途停顿超过 3s 仍可能误封，属已知残余风险。确认前在途的读、没带读序号的快照、冻结快照（`ended:true`，冻结时刻未知，含无 key 锚点根的一次性读）、确认后又见生成中，都不据此封存，照旧走完成状态未知/保存已停止。已封存的完整副本不再被追问、取消或迟到快照改写；未确认完成的副本遇追问仍按原规则标「保存已停止」。提交结果就绪后，主进程固定观察 15 分钟；生成信号与用户节点均可能迟到，不以 45 秒内缺席提前封存，后续进度不顺延。真实页面控件激活/直接输入前尽力读取最后安全正文并冻结，但已绑定的本轮仍在生成时不冻结：停止键可见，或回答容器 2 秒内有子节点增删（元宝输入框有草稿时会隐藏停止键）。生成中的滚到底部、复制、草稿输入曾把副本停在半句话（2026-10-03 元宝）；新增轮次、换回答容器、用户文本改变和路由变化照旧终止。绑定前的激活仍立即终止。popstate/hashchange 或已绑定会话路由变化终止归属。监听随终止解除。按钮识别覆盖 button/a/role=button/menuitem，以及计算样式为 cursor:pointer 的自定义控件；普通正文选择不冻结。元宝、Kimi、千问、智谱、DeepSeek 的自定义控件须用可信鼠标/键盘事件验收，不得据离线通过宣称全覆盖。

### 定位分级（`history-adapters.js` ① → `history-locate.js` ②③）

`historyTurn(ctx)` 先跑第 ① 级逐站选择器；找不到用户轮次时才轮到 `history-locate.js`：② 语义信号（`data-message-author-role` 等 `*-author-role`/`data-role`/`data-turn`、`data-testid="user-message"` 一类、`user-query`/`model-response` 组件标签名；aria 文案随界面语言变，不作角色依据），③ 问题原文锚点。三级结果都必须再过 `bind()`；注入顺序为 `history.js → history-locate.js → history-adapters.js`。

- **方法冻结**：`begin()` 建立 `ctx` 并用它取基线——基线命中哪一级（`ctx.method`），本轮 begin、MutationObserver 回调、快照、`submitted()` 都只用那一级；基线为空时每次按 ①②③ 顺序试，**只在 `bind()` 首次确立本轮用户时**冻结为当次命中的级别，绑定后不换方法（否则基线与快照的 userCount 不同源，「多出新轮次即停止」失效）。**唯一例外是 ②→① 单向让位一次**（`history.js` 的 `promote()`，2026-10-04）：豆包新会话首问绑定时第 ① 级的 `[data-message-id]` 还没补上，只能冻结为 ②，而 ② 的回答根是整条 receive_message、会带进思考头等杂项。只有同时满足才换级：begin 时各级基线都为空（① 的基线也是 0）；已冻结为 semantic 且已绑定用户；① 返回 `locate=selector`、恰好 1 条用户，且这条落在已绑定的用户节点内、原文相同；已锁过回答时，① 的回答也须在已锁回答根内。换级后回答从 ① 重新锁定；observer、snapshot、`submitted()` 三个入口都走这一步。`historyTurn` 自己从不冻结：曾经「任一级首次返回用户即冻结」，用户气泡出现前一处未排除的同文回显（类名不带 sidebar 的最近记录、首页建议卡片）会被 ③ 抢先命中并冻结为锚点，① 从此出局——bind 不收时整轮丢副本，回显恰好被插入时还会把其后的旧会话标题存成回答。无 `ctx` 的调用（采集脚本、回放用例）跑 ① 后 ②，不跑 ③。
- **③ 的硬约束**：只给空会话首轮——`begin()` 时在首页路由、①② 都没有任何用户轮次、无附件，此时 expected=1 且仍要 `wasInserted`；豆包、元宝、DeepSeek（虚拟列表）一律禁用。整页 TreeWalker 跳过 `nav`/`aside`/`header`/`footer`/`form`/弹窗/`textarea`/`contenteditable`/隐藏与 `aria-hidden` 子树（弹窗库打了 `data-aria-hidden` 标记、且包住输入框的那层除外）、输入框祖先上的直挂文本，以及不包住输入框、且位于输入框列左右两侧（量不到布局时照旧排除）的 `sidebar`/会话列表类名容器——智谱真会话区就叫 `conversation-list-outer`，与输入框同列——和读屏专用副本（类名词元 `sr-only`/`visually-hidden`/`cdk-visually-hidden`，Gemini 用户气泡里有一份「You said + 原文」；②③ 取用户文本时也去掉它）；整段问题只有一处同文才算命中，多处一律 null（retry 会合法地产生同文提问）；多行问题若无整段同文的文本节点，要求每行命中次数与问题中一致，取包含全部行的最小公共祖先，整段与分行同时出现也算歧义。同文只在与输入框同处主内容区时计数：输入框在 `main`/`[role=main]` 里时同文须在其内；量得到布局时还须与输入框水平重叠（侧栏、最近记录在输入框左右两侧）。只按反证剔除——站点视图未挂载时视口 0×0、量不到宽度，不能因此丢锚点。回答根取「自用户节点上溯、不越过与输入框同属那层」的最低一层其后第一个有实质内容的兄弟（「实质内容」不含按钮、`role=toolbar` 和类名以 `-action`/`-actions`/`-action-row|bar|…` 收尾的操作条——Kimi 用户气泡下的「Edit / Copy / Share」是 div 拼的，曾被当成回答根）；正文就是问题原文的兄弟是回显不算（智谱顶栏标题旁的测量副本 `span.measure-span`）。其后或更高层还有实质内容，记 userCount=2 交给 `bind()` 停止。根内恰好一个不在思考段（类名含 think/reason、`details`）里的 markdown 块时取它；只有思考段里有 markdown 时不给正文；否则取整个根。
- **根要稳定**：③ 的回答根带实例 key（`data-*-id`/`data-*-key`，不含 `data-testid`）才像 ① 一样锁定；没有 key 就不锁根，只读一次、随即结束本轮（完成状态仍记未知）。读的时机只认正向证据：本轮见过停止键（MutationObserver 回调里补采样，主进程 5 秒才拉一次）、之后它消失，回答容器**被观察到变动过**且最近 3 秒无变动（`history.js` 的 `QUIET_MS`；停止键消失后正文续长的实测最大间隔 1.79s，ChatGPT 2026-10-04，留 ≥20% 余量；含原地改写文本的 characterData、回答根与用户气泡同批插入；回答根身份变化时静止期从头算）——从没变动过的静止根多半是回显或测量副本，不读；或用户交互冻结；都没有时在主进程观察窗收口前（begin 起约 12 分钟）降级读一次。单凭「静止」不读——锚点只在改版后启用，停止键选择器多半一起失效，思考/检索时数秒没有变动很常见，曾把首个 token「Par」当最终回答封存。
- **性能与复核**：`historyTurn` 每批 DOM 变更都会调用。MutationObserver 回调里 ③ 绑定后只用缓存节点（仍连接且 `textContent` 未变），节点脱离文档才重新走整页；未命中时整页遍历最少间隔 500ms（插入证据在 WeakSet 里，节流不丢归属）。**读正文的那次定位**（`snapshot()`/交互冻结，`ctx.fresh`）不用缓存、不节流，重新确认同文仍唯一：缓存只证明节点还在。2026-10-03 智谱改版模拟中，顶栏标题 `p.conversation-name` 先于真气泡唯一命中被绑定，约 2 ms 后测量副本成为第二处同文，靠缓存撑着的错绑把测量副本当回答根，按旧读取条件可在生成结束到标题改名之间把问题原文当回答封存。
- **证据与汇总**：③ 命中不得产生 `submissionEvidence=message`（`submitted()` 对锚点返回 false——按原文找节点再比原文是循环论证）。汇总复制（`read-commands.js` `collectAnswer` → `answer()` + `toMarkdown`）没有 `bind()` 保护，不接 ②③。
- **记账**：快照带 `locate: "selector" | "semantic" | "anchor"`，经 `shared/question-capture.ts` 的 `normalizeHistorySnapshot` 白名单放行；主进程 `main/capture-locate-diagnostics.ts` 按站点、每轮一次做内存计数，经 `polyask:capture-locate-counts` 进 `Alt+H` 诊断报告的 `capture-locate selector=… semantic=… anchor=…` 白名单行。不落库、不同步、不走 `SITE_CODES`、不产用户可见文案。
- **离线回归**：`desktop/scripts/history-locate-replay.test.js` 与 `capture-audit-regress.test.js`（jsdom 整链回放；后者是 2026-10-03 真机审计缺陷：智谱顶栏标题回显、静止根、Kimi 路由迁移与节点同批替换、思考段；唯一命中、同文多处、已有会话、附件、虚拟列表站、排除区、主内容区、多行、方法冻结与「未被采纳的锚点命中不冻结」、无 key 根的读取时机、模拟选择器改名、归属保护）与 `question-history-locate.test.js`（ctx 契约）；`scripts/fixtures-dom/kimi-semantic-drift` 是第 ② 级的合成 fixture；九站真站脱敏 fixture `<站>-single-turn` 由 `dom-fixture-drift.test.js` 在 jsdom 内存里把两张选择器表换成不存在的名字，逐站断言漂移后接上的级别与正文（期望表与 2026-10-03 真机 spike 一致，见 docs/verify.md）。流式过程中根身份是否漂移、同文与 retry 归属仍须真发送核对。
- **逐站现状（2026-10-03 真机 spike，各一条已完成的单轮会话）**：漂移后 Claude、Gemini 由 ② 接上，豆包由 ② 接上但多带搜索卡与时间戳；千问、Kimi 由 ③ 接上且正文与 ① 一致（DeepSeek 当时也由 ③ 接上，此后因虚拟列表列入 ③ 禁用名单）；ChatGPT 的 ③ 节点正确但其后有页面免责声明等实质内容，记 userCount=2 不归属；元宝（禁用 ③）、智谱（jsdom 量不到布局，会话区类名 `conversation-list-outer` 仍按会话列表排除）为 null。不一致为 0。真站上智谱会话区与输入框同列，已不再排除；发送验证见 docs/verify.md。DeepSeek 会话区也是虚拟列表（`ds-virtual-list`），已与豆包、元宝一并禁用 ③。

豆包用户气泡会在汉字与 ASCII 字母、数字之间插入排版空格（2026-10-02 深度思考首问实测），汉字与引号等标点之间同样插入（`有没有 "x" 的`，2026-10-03 实测）；仅本站对汉字与任一非空白字符之间的空格，在提交原文与显示文字两侧作相同归一化，保留非汉字之间的英文词间、数字间空格与实质字符。新增用户轮次、节点插入、前驱消息与路由的归属保护不变，不以全量去空格匹配问题。

2026-09-21 登录开发态确认：DeepSeek 用户 `.ds-message` 还需含 `.ds-collapsible-text`，否则空 AI 节点被误算用户；千问用户正文为 `.question-text-card`；智谱为 `.conversation.question .question-txt`；Gemini 只拼接 `.query-text-line`，排除重复读屏文案。ChatGPT/Kimi 等允许同一回答容器内的 Markdown 节点替换，千问空回答占位不提前锁定容器。ChatGPT 首轮会先出现 `/c/WEB:…` 临时路由，只有正式 `/c/…` 才锁定及保存；用户轮次绑定前的启动重定向不锁定会话。原生/execCommand 注入可触发可信 beforeinput，绑定用户轮次前忽略该输入事件。元宝会话路径含代理与会话两段；智谱真实会话由 `cid` 查询参数标识，恢复只保留校验后的单个 24 位字母数字/下划线/连字符 cid，丢弃其它参数。

Kimi 首屏会先绑定临时 `/chat/<id>` 再换为服务端地址，且同一批里乐观用户节点也会被替换（2026-10-03 真机）：仅空首屏的第一轮、尚无正文时，允许一次该路径间迁移——同一个仍连接的用户节点，或旧节点已断开、新节点文本与问题完全一致且轮次数仍为 1（只在绑定后 10 秒内，实测约 50 ms），迁移时一并换上新节点；路由已变但暂时定位不到用户（锚点节流、重渲染中）时挂起不终止、不归属任何内容。已有会话、仍连接的另一个节点、文本不符、第二次迁移和浏览器导航仍终止归属。智谱正文/代码拆在多个 `.markdown-body`，返回其独立 `.answer-content-wrap`，排除 `.text-advance-thinking-content`；只有思考段时返回 null。其真实生成控件为输入框旁 `.enter.searching`，生成状态监控须识别该控件；历史副本已独立采用固定 15 分钟预算。

**验收边界**：九站已取得登录页面结构和合成提交证据，但不等于九站所有路径通过。新会话、已有会话、相同文本、网页直接追问与重新生成须分别核对。ChatGPT/Gemini 思考段排除仍待复核；VM 测试只能证明代码分支。当前逐站结果与未闭合项见 docs/verify.md。

豆包图片提问会连续渲染图片气泡和文字气泡；历史归属将连续图片气泡与紧随文字计作一轮，遇到 AI 回答或文字即结束分组。不能直接忽略图片气泡：独立图片追问仍须增加轮数，阻止旧提问继续采集。

**豆包新会话首问 `local_` 路由（2026-10-04 Windows 真机）**：现场 bundle 的 `NavigatePageMessageLifeCyclePlugin` 在开关 `SubmitPipeline.NavigateBeforeSend` 开启（现场读值 undefined = 开）时，发送前 pushState 到 `/chat/local_<16位数字>`，服务端确认后 replaceState 到 `/chat/<服务端 id>`（所以 `navigation.entries()` 只剩一条）。`route()` 不把 local 路由当首页，`bind()` 把它锁成 routeId，replace 后 `checkRoute` 判换路由 `stop()`，副本封存为 unavailable（首个快照即 `owned:false, ended:true`，页面 userCount=1）。离线用真 fixture 复现一致。已把 `/chat/local_\d+`（仅豆包 host、前缀精确）并入 ChatGPT 的 provisional 规则：local 路由视同首页不锁归属，replace 到服务端 id 后下一次 bind 才锁定，之后再换会话仍终止（`question-history-doubao-spacing.test.js`）；2026-10-04 Windows 复验（docs/verify.md 同日「Windows TestLab 修复复验」）的 100 ms 路径采样抓到了 push 到 `/chat/local_<数字>`，local 期间副本保持归属；但 6/6 次首问都在 replace 之前就被下段的时间戳问题结束，**local_ → `/chat/<id>` 的 provisional 迁移真机从没走到**。D4 第 3 轮（同日，5/5）才走到并推翻了离线用例「replace 时原节点补 `data-message-id`、不换节点」的假设：页面先 replace，再把用户节点整体换掉，规则见下文「local_ 阶段的归属守卫」。已有会话里追问没有 local id、不受影响。

**豆包首问用户文本混入时间戳（D4，2026-10-04 Windows 6/6）**：首问在 local 路由下以第 ② 级绑定，约 2–4 s 后用户节点 `[data-message-role=user]` 内的 `message_action_bar` 插入 `<time>今天 16:16</time>`，② 读到的用户文本变成「原文今天16:16」，`bind()` 判原文不符 `stop()`，副本 unavailable（0 字）。同会话第二问基线已有用户轮，冻结在 ①，读 `[data-message-id]` 节点本身、不含操作条，一直正常。现规则：`history-locate.js` 的 `userText()` 遇到恰好一个 `[data-testid="message_text_content"]` 时只读它；否则剔除 `<time>` 与 class/data-testid 符合现有操作条规则（`message_action_bar`、`msg-actions` 等）的子树文本，从文本末尾往前删（读屏副本仍从前删），且只删参与渲染的元素（见下段 `checkVisibility()`）；②③ 的用户文本都走它。`history-adapters.js` 豆包第 ① 级同样只读唯一的正文容器。之后再由上面的 `promote()` 升到 ①，副本只有正文。残留：删的是最后一次出现的同文，参与渲染的操作条若排在原文前面（页眉式）且其文字也出现在原文里，会删掉原文里那一段——九站 fixture 目前没有这种结构。

**local_ 阶段的归属守卫与一次性迁移（2026-10-04 审查 + D4 第 3 轮 Windows 真机）**：local 路由不锁 routeId，期间 `bind()` 的乐观替换分支没有时间窗，侧栏点开一个同文单轮旧会话（回答仍空、停止键亮着时点击被当作 streaming 忽略）会换绑过去、`promote()` 再升到第 ① 级，把旧会话的回答记成本轮副本。所以在 local 路由上绑定后（`e.localId`）、地址锁定前：仍在 local 上而已绑用户节点脱离文档（先换 DOM），或地址离开 local 却没经迁移放行，一律 `stop()`。

**「节点不换」的前提是错的**：第 3 轮 5/5（`t1-doubao-{1..5}` 的 `navs` 都是这个地址序列，2–5 轮的 `userSwaps` 抓到换节点，第 1 轮从 `turns` 推断）： push `/chat/local_<n>` → 绑定后 2.6–4.7 s（九站群发 `t3-all9` 为 5.25 s）`currententrychange` 记为 **replace** 到 `/chat/<17 位数字>` → 再过 315–665 ms 语义级用户节点被**整体换成新节点**（`oldConn:false, oldContainsNew:false, newContainsOld:false`），新节点插入时已带 `data-message-id`，同一批 ① 已命中（uc=1、同文）。旧守卫在这一批 `stop()`，副本 unavailable。现由 `history-route.js` 的 `rebase()`（按 300 行上限从 `history.js` 拆出，preload 先于 `history.js` 注入）放行**一次** local → 正式 id 迁移，条件全部满足才放：① 地址从记录的 local 换到豆包 `/chat/<数字>`，且 Navigation API 的 `navigation.currentEntry.key` 与绑定在 local 上时记下的相同（replace 留槽、push 换槽，第 4 轮 Windows 真机已实测证实：豆包 replace 11/11 保持 key，push 22/22 换 key，其中 local_ push 16/16、侧栏点开旧会话 6/6 都是 push 且换 key；traverse（后退/前进）是否换 key 未测；拿不到 key 时 fail-closed 结束，即旧行为）；② 地址变化与换节点都在绑定后 10 s 内（单站 T1 绑定到换节点最长 5.18 s；最慢的是九站群发 `t3-all9`：绑定→replace 5.25 s、绑定→换节点 5.92 s。延迟随负载与发送耗时增长，因为豆包在发送管线结束时（`onMessageSendingEnd`）才 replace，与回答流式无关。10 s 对 5.92 s 约 69% 余量，与 Kimi 首屏迁移同值；不要按单站数据收窄）；③ 新用户节点同文（normalize 后）、userCount=1，且不是原文锚点定位的（锚点同文校验是循环论证）；④ local 阶段快照可能已锁旧节点的回答根，换节点时清空，由新节点重新确立。迁移后 routeId 锁在正式 id，同一次定位里 `promote()` 随即升到 ①；之后再换地址或再换一个不同 key 的节点都结束（同 key 重渲染不算换节点）。地址已变、新节点暂时定位不到时挂起不终止、不归属任何内容。replace 后节点暂时还在也照样锁地址，换节点留到窗口内处理。只看 local 路由（`e.localId`），Kimi 首屏迁移与 ChatGPT provisional 路由不经这条路径。回归：`doubao-new-chat-capture.test.js`（真实序列整链 jsdom 回放三种时序：同批换节点且 local 阶段已锁回答、换节点前还有一批变动、观察器跑之前就读快照；第二次 replace、无 Navigation API；先换地址/先换 DOM 跳到同文旧会话），`doubao-local-migration.test.js`（假时钟：T1 与 `t3-all9` 两组真实时序；逐条阴性：push、窗口外 replace、窗口外换节点、非数字路径、换回 local、文本不符、两轮、迁移后再换地址、无 Navigation API、挂起）。测试夹具里 Navigation API 只建模 key 的槽位语义（`dom-replay.js`、`history-harness.js`）。**真机状态（第 4 轮，docs/verify.md「2026-10-04 Windows TestLab 第四轮复验」）**：主路径通过，9 次带埋点的迁移加 1 次不装埋点的对照都以 complete 封存，locate 先 semantic 后 selector；侧栏切到同文旧会话的 6 次阴性尝试（local_ 已绑定后 4 次、replace 后 2 次）都以 unavailable 结束，没有采纳旧回答。真机未覆盖：replace 与换节点之间的挂起态（79–238 ms 内没有观测样本）、rebase 的各条阴性分支（超窗、文本不符、userCount≠1、锚点、key 缺失、清空非空旧回答根，只有离线回归）、traverse。push 到 local_ 之后、`bind()` 之前（约 220–280 ms）切到同文单轮旧会话的窗口已关闭（2026-10-04）：`history-route.js` 的 `freshBind()` 规定，begin 时没锁会话地址的豆包首问，只能在首页（`/chat/`）或 local_ 上确立用户；begin 本身就在某个 local_ 上时只认那一个。绑定前页面到了任何 `/chat/<id>` 都直接 `stop()`，正式 id 只能经 `rebase()` 从已绑定的 local_ 迁移到达。代价是 fail-closed：如果哪天豆包不经 local_、在用户气泡渲染前就直接跳到正式 id，首问副本会是 unavailable。begin 时已在 `/chat/<id>` 的追问不受影响，由 `checkRoute` 锁住地址。例外：begin 在卡住的 local_ 上追问（后台页首问 2 分钟后地址仍是 local_，`u1-doubao-4-bgpage-think`），local_ 先被原地 replace 成正式 id、追问气泡后到时，同一历史槽位（begin 时记下的 Navigation key）里的 `/chat/<数字>` 放行，与「先绑定后 replace」经 `rebase()` 的结果一致；replace 后又 push 到别处、拿不到 key 照旧结束。另一方向收紧：首页上直接绑定之后第一次离开首页，`leftHome()` 只放行 local_（交给 `rebase()`）和同槽 replace 成的正式 id，push 到别的 `/chat/<id>` 直接结束，否则 `bind()` 的乐观替换分支会换绑到同文旧会话上（思考阶段 `answer()` 为 null，这个窗口覆盖整段思考）。回归 `doubao-bind-route.test.js`，覆盖理论竞态（①② 两级）、另一个 local_、首页直接绑定、local_ 绑定后迁移、已有会话追问、卡住的 local_ 上追问（两种时序与 push 阴性）、首页绑定后 push 到旧会话与同槽 replace。会话地址同样不记 local_：`safeQuestionUrl` 的豆包路径排除 `/chat/local_…`（`question-navigation.ts`），快照、落库与同步回填都经它过滤，副本在 local_ 上封存时不留地址，只存正文。**弹窗盖住会话区（2026-10-05 第 5 轮 D1，已修）**：站点开着 Radix 模态（「下载电脑版」推广弹窗）时，`aria-hidden` 包的 `hideOthers` 给 MAIN 加 `aria-hidden=true` 并打 `data-aria-hidden` 标记；local_ 阶段的乐观气泡没有 `data-message-id`（① 不中），② 的用户节点曾因 HARD 的 `[aria-hidden="true"]` 被排除，豆包又禁用 ③，local_ 上始终没绑定，replace 到正式 id 后 `rebase()` 无从迁移（`e.user` 为空），首问副本 unavailable（真机 2/2，关闭弹窗后 1/1 正常）。现在 `history-locate.js` 的排除区对带 `data-aria-hidden` 的 `aria-hidden`（`MODAL_HIDDEN`）只豁免**包住当前输入框的那一层**（`fenced()`）：`aria-hidden` 1.2.6 源码里 `hideOthers` 对原本就 `aria-hidden` 的同层节点也照打 `data-aria-hidden`（已核实），标记本身分不出「弹窗临时让位」和「本来就隐藏」，而真隐藏的区域不会装着正在用的输入框；真实页面里豆包输入框在 `<main>` 内（`fixtures-dom/doubao-single-turn.html`），第 5 轮真实弹窗标记的三个节点里正有这个 `<main>`。找不到输入框时照旧排除（fail-closed）。不带标记的 `aria-hidden`（`HIDDEN`）照旧排除；CONTROLS（`meaningful()` 向下判实质内容）仍排除全部 `aria-hidden`。弹窗本身仍由 `[role="dialog"]`/`[aria-modal]` 排除。回归 `doubao-new-chat-capture.test.js`：带标记的 `<main>` 可绑定；不带标记仍排除；`<main>` 之外带标记的隐藏区里的用户节点仍不参与定位（去掉输入框条件时这条红）。**真机（2026-10-05，docs/verify.md「2026-10-05 Windows TestLab D1 复验（豆包弹窗）」）**：只覆盖模拟形态——在同一 MAIN 上同时设 `aria-hidden=true` 与 `data-aria-hidden`，新会话首问 3/3 complete 封存、与独立页面读取双向有序一致，local_ 阶段第 ② 级已命中本轮用户（uc1、同文）；只设 `aria-hidden` 的对照 2/2 仍 unavailable（站点自己写的 `aria-hidden` 照旧排除）。真实弹窗本轮没出现，端到端未测：真实 Radix 弹窗会同时标记 3 个节点并带 `role=dialog` 遮罩与打开的 `role=menu`，模拟只标了 MAIN。该轮复验后已按审计意见核实并收窄为上述「只豁免包住输入框的那层」。**收窄版真机（2026-10-05 第 7 轮，docs/verify.md「2026-10-05 Windows TestLab 第七轮复验（D1 收窄、20 秒上限、首次加载上限）」）**：仍只有模拟形态。按 `aria-hidden` 1.2.x `hideOthers` 算法移植，以 body 下 portal 里的 `role=dialog` 和人为插在侧栏旁的 `role=menu` 为目标，每轮标记 18 个节点：覆盖第 5 轮真实弹窗已知的 3 个文本节点（含包住输入框的 `<main>`），其余 15 个是按库算法推出来的，原本就隐藏的兄弟节点也带上了标记；另放一个带 `data-message-role=user`、文本不同的已隐藏诱饵节点。实验组（`aria-hidden` + `data-aria-hidden`）与对照组（只有 `aria-hidden`）交替各跑 3 次，同提示词模板、同等待上限。实验组 3/3 complete 封存，local_ 阶段由第 ② 级 semantic 绑定（uc1、同文），到正式 id 后升到 selector；对照组 3/3 unavailable，失败机制与真实弹窗相同：local_ 阶段 semantic 被排除，到正式 id 后 selector 虽然命中，轮次已经结束。诱饵会被第 ② 级选择器匹配，但实验组在诱饵存在时仍以 uc1 绑定，6 轮里诱饵都没进副本，说明负向收窄在真机上生效。对照组跑的是当前代码，只证明「只有标记不同时结果相反」，不是在旧构建上重放。真实弹窗 15 次检查都没出现，端到端未测；模拟没有遮罩层、焦点锁和 react-remove-scroll，真实 menu 的位置也不同；弹窗在绑定后才出现、或在 local_ 阶段关闭的情形也没测。

第 ② 级用户文本剔除时间戳/操作条时只删参与渲染的元素（`checkVisibility()`）：`display:none` 的元素 innerText 退回 textContent，按字符串删会删掉原文里的同文片段。

豆包虚拟列表会移除早期用户气泡并重建节点；仅在同路由、精确提问文本、不同的新消息 ID、当前逻辑轮次的前驱 ID 等于发送前末轮 ID 时，允许 DOM 轮数缩减及基线节点回收。其它站仍要求原有计数与连接条件；同文后续追问及换会话不获授权。

### 九站图片能力复核（2026-09-22）

- Gemini：展开 Upload & tools 菜单，取 `accept="image/*"` 且没有 capture 的图片 input；支持多文件，finally 关菜单。缺入口返回 `attachment_action_required`（登录、额度等站点要求由用户处理）。
- 千问：添加附件通过 PointerEvent 的 pointerdown/up（pointerType=mouse）打开；选“上传图片”才会创建 `accept*=image/` 输入，捕获 file click 防止弹出系统选择器。每次重新走菜单；finally 移除监听并关菜单，所有等待夹取 deadline。
- 智谱：本地文件选择的 `.upload-demo` 承载新聊天附件入口；旧 `.img-input` 虽接收 files，却不触发当前附件流程。
- 开发态已用无个人信息的测试图验证上述三站与 Kimi 的附件确认；不把“附件确认”视为完整回答质量或所有账号额度的保证。

### 2026-09-29 生成状态控件复核

`generation.js` 补充五站实测停止键：ChatGPT `button[aria-label="Stop"]`，中文界面为 `button[aria-label="停止"]`（无 testid，2026-10-04 Windows zh-CN 真机；精确匹配，不吃「停止朗读」一类同前缀控件；页面侧停止键锁存用同一份选择器；zh-TW 用字相同但未真机核实），缺它时中文界面每次都报 `generation_unconfirmed`；DeepSeek `.ds-button--primary` 内 `path[d^="M2 4.88C2"]` 方形 SVG（同类发送箭头不能算停止键）；豆包 `[class*="break-btn-"]` 无 button 角色的容器；Kimi `.send-button-container.stop`；元宝 `#yuanbao-send-btn[aria-label="Stop Answering"]`，中文界面为「停止回答」，类名 `SendButton_sendStop__*` 与语言无关（2026-10-03 补）。继续执行可见性和输入区邻近检查，旧锚点保留。主进程仍须先观察到 generating（或页面侧锁存给出 `complete_observed`，2026-10-04 起，见契约表 `generation()` 行），再经连续完成确认；未改变轮询、预算、后台节流或不明确提交不重发的规则。此探针不能证明回答内容正确；但提问历史的「完整回答」以外壳 `GenerationMonitor` 用它连续确认收口为前提（再经确认之后的归属快照隔 3s 复读一致才封存，见上文「逐次提问的只读副本」），放宽停止键选择器或锁存（如误吃同前缀控件）会直接影响历史副本的完成判定。

2026-09-29 多轮资源测试补充：ChatGPT 长回答会产生可编辑 Canvas，位于 `[data-chatgpt-selection-message-id]` 内（实测约 384×3252px）；真实提问框在 form 内约 405×26px。按面积选最大编辑区会误选回答。`core.findComposer()` 仅在 chatgpt.com 排除现代及两种旧版 assistant 容器中的编辑器，保留其它站原有几何规则。离线与真实 DOM 反例通过，重启后同一测试会话连续两轮生产发送均取得 message 确认，提问框为空、回答可读。
