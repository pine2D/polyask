# Desktop 应用（`desktop/`）

动窗口/视图、preload 注入、群发编排、IPC、错误码、数据层与 Drive 同步之前读这份。**错误码全表、超时预算表、跨端不变量、源码文本守卫规则都在这里**；`CLAUDE.md` 只留硬约束条文，这份讲实现与事故现场。冲突以 `CLAUDE.md` 为准。

站点适配器契约、九张站点卡、站点 DOM 与时序坑见 `docs/adapters.md`；真机验证与门禁口径见 `docs/verify.md`；发版见 `docs/release.md`；OAuth 凭据维护见 `docs/desktop-oauth-security.md`。

`desktop/` 自包含的边界是**构建与测试自包含**：`cd desktop && npm test && npm run typecheck` 是它自己的门禁；仓库级动作（git tag、CHANGELOG、发版编排）留在根。

---

## 1. 进程边界与视图树

新增界面元素须沿用所在区域的控件样式与设计变量，并同时接入完整外壳验证夹具。主工具栏的新会话、历史和草稿入口共用一个布局单元，不增加顶层网格项；工具栏高度仍按共享显示契约计算。提交前检查新增属性是否在夹具中实际传入，核对三语、明暗主题、两种密度、开合、缩放、键盘与禁用状态及原生站点边界；孤立组件测试不能代替这项集成检查。具体入口见 `docs/verify.md`。

| 层 | 职责 | 落点 |
| --- | --- | --- |
| Main | 建窗与视图、导航/权限裁决、群发编排、数据层、Drive 同步、应用菜单 | `desktop/src/main/` |
| Shell preload | 只暴露带类型的最小命令面（`invoke`/`on`），不透传任何 Electron 原始 API | `desktop/src/preload/shell.ts` |
| Shell renderer | 命令栏、工作区、结果库、设置页；只提交经过校验的意图 | `desktop/src/renderer/` |
| Site preload | 隔离世界里加载站点运行时，收发 `site-command`/`site-response` | `desktop/src/preload/site.ts` |
| 站点运行时 | 九站适配器与通用链（classic script、`__AMS` 全局） | `desktop/src/site-runtime/` |

- Shell 是唯一的 `BrowserWindow`；每个**已打开**站点一个 `WebContentsView`，未打开的站点不建视图、不加载页面。`workspace.selectedSites` 继续持久化并同步打开页面的有序范围；参与群发独立保存到 `workspace.participation` 并同步，renderer 只采用与已打开页面相交的范围。不参与仅排除后续群发与手动采集，仍保留页面、布局、聚焦和登录；新轮冻结发送范围，重试沿用原轮范围，不随新的参与选择缩减。明确关闭页面须预览并确认：受信 IPC 核对明确确认标志、当前页面身份及操作锁，发送、导航、生成或采集未结束时拒绝；关闭会丢当前页面对话，持久 session 登录仍保留。状态更新及采集落库后重查可回收视图，监控超时不当作生成结束证据。生成监控按站点保留轮次，新轮不停止其它站旧回答；取消仅终止尚在发送的站点监控和采集，已提交回答继续只读收尾。辅助综合独立监控完成，待采集/待保存的目标也保持保护。
- **所有已打开站点都挂在视图树里并保持正尺寸**，非当前页的与当前页第一格用完全相同的矩形、压在其之下——不占屏幕、不抢鼠标。**不能只挂当前页**：未 `addChildView` 的 `WebContentsView` 页面视口恒 0×0（只 `setBounds` 同样是 0），`site-runtime/core.js` 的 `findComposer` 因 `r.top < innerHeight` 恒假而返回 null，群发对后台站点必然 `composer_not_found`，一路重投烧到截止线。
- **被遮挡时导航的视图会停帧，靠重申 `setBackgroundThrottling(false)` 救回**（2026-10-04 Linux+Windows 真机）：视图在被兄弟视图压住、或整个窗口被别的应用盖住/锁屏/最小化时完成一次跨文档导航，之后 rAF=0、ResizeObserver/IntersectionObserver/View Transitions 都停，定时器和 MutationObserver 照常，`visibilityState` 仍是 visible；窗口遮挡解除后当前页能自愈，后台页不会。Windows 上最小化还会让从未导航过的视图停帧。Chromium 在 `IsHidden` 分支里对 `setBackgroundThrottling(false)` 走 `ShowWithVisibility(kHiddenButPainting)`，所以在 get 已是 false 时再设一次就能恢复；`invalidate()` 无效，`capturePage` 在 Windows 上首次抛 `UnknownVizError`（随后视图恢复），都不能当恢复手段。落点：`paint-recovery.ts` 的 `reassertPainting` 只在视图未销毁、且 `getBackgroundThrottling()` 当前为 false 时重设（空闲节流实验设的 true 不覆盖）；`site-view.ts` 在每次主帧 `did-navigate` 调它；`startPaintRecovery` 在窗口 `restore`/`show`/`focus` 与 `powerMonitor` 的 `unlock-screen`/`resume` 时对全部视图重设一次、1s 后补一次（连发只留一个计时器），常开、不受实验开关控制，由 `runtime-gates.ts` 装配并随 dispose/窗口 closed 清理。Electron 没有「窗口不再被遮挡」事件：被别的应用盖住又露出、但用户没聚焦窗口时，要等下一次 `did-navigate` 或 `focus`。Linux 残留：Kimi/元宝/智谱后台新会话提交 10–20s 后掉到约 1 帧/秒（不是 0），重设与 `invalidate()` 都救不回，切到该页显示一次即恢复，机制未定位，Windows 稳态未见。
- **层序靠「重挂即提升」**：`addChildView` 对已在树里的子视图是原地提升到最顶层（幂等、`children` 不增长）。**绝不要改成先 detach 再 attach**——全拆重挂实测会让被聚焦站点的渲染进程真的丢焦点。落点 `view-manager.ts` 的 `attach`/`detach`/`reconcile`。
- 布局、缩放、槽位顺序、`WebContents` 生命周期归 main；renderer 只提交白名单意图。
- 每站缩放由 `SiteZoomController` 在绑定视图时设置 `setZoomMode("isolated")`，随后应用既有本机比例；共享登录域也不互相传播缩放，模式跨导航保留。快捷键、滚轮与 UI 状态存储契约不变。
- Windows 最大化窗口最小化会触发 `resize` 且内容区为 0×0（普通窗口最小化未见同样事件）。最小化或内容区宽高为零时必须保留站点原有 bounds，不计算自动聚焦；`restore` 再应用有效布局，包括最小化期间积累的显示偏好变更。否则网页会被缩到 1px，恢复时重新排版，并留下错误的空间不足提示。
- 新会话按钮位于提问框后、历史之前，常规显示加号图标及文字，收纳后保留图标、可访问名称和提示。按钮、菜单及 Alt+N 共用现有动作，只对参与提问的站点新建；未参与的打开页面不受影响，草稿和附件保留。确认前及执行期间防重入，空范围/发送中/其它阻塞操作不可执行。
- 新建会话、问题草稿恢复与重试核对使用临时 `confirmation` surface：原位置隐藏原生站点视图并保持挂载、正视口，聚焦外壳；确认或取消后恢复 `sites`。草稿打开时同步阻断命令，释放覆盖必须核对当前归属，旧组件卸载或迟到回调不能释放新的确认框。渲染命令与主进程直达导航均在确认期间阻断，发送入口也检查阻断；设置等界面的正常后台分页保持原有行为。重试核对不会发送，只有用户明确勾选并确认才走原请求重试；主动查看本站属于明确核对操作。等待期间其它站的生成和采集保留。CSS 的 z-index 无法盖住 `WebContentsView`，不可只在站点 surface 上叠确认框。离开这些覆盖界面去结果库/设置/命令页仍 detach；返回时未选忙碌站点继续隐藏。

## 2. 站点视图与会话

- 全部站点共享持久 partition `persist:polyask-sites`（`diagnostics.ts` 的 `SITE_PARTITION`），与 Shell 会话分离；不读取也不复制 Chrome 的用户配置与 Cookie。
- 安全偏好写死在 `diagnostics.ts` 的 `SITE_VIEW_SECURITY`：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`、`safeDialogs: true`。**未启用 `disableDialogs`**——站点自身的确认框仍要能用。打包产物的 smoke **回读每个视图实际生效的 `webPreferences`**（走未在类型声明里公开的 `getLastWebPreferences`，读不到按不安全处理），任一项不达标记 `insecure_site`。
- 顶层导航由 `navigation.ts` 的 `navigationDisposition` 分五类，`navigation-guard.ts` 裁决：`site`（本站 host）/ `auth`（登记的登录域）/ `transit`（一方反滥用与同意中转域，如 Google 的 sorry 页）/ `external` / `block`（非 https 一律 block）。`site`/`auth` 恒放行；`external` 主帧**只在「auth 流进行中」且「来自服务端 302」时放行**；`transit` 只在服务端 302 放行、渲染端一律拦、不进也不改登录流。核心不变量：`transit` **不新增任何到达 external 的路径**。auth 流只由 `did-navigate`（主帧实际提交）翻转，按「提交」而非「意图」武装。
- 子帧只拦非 https；子帧从不改变主帧流状态。**新窗口一律 deny 真窗口**，`window.open` 只有「目标是本站页面且顶层也在本站」「目标是登录域且顶层仍在本站或 auth 流进行中」两种改写进受管视图的情形。
- 站点视图里点到的外部链接交给用户自己的浏览器（`index.ts` 的 `openExternal` → `safeExternalUrl`）；不接这条回调是**静默无反应**。转交对象是被拒的 `external` 主帧导航/新窗口，以及明文 `http://` 链接（它们在 `navigationDisposition` 里是 `block`，视图本身绝不明文加载，`site-external-links.ts` 的 `handsOffToBrowser` 单独放行转交）；服务端 302 不转交。转交须有**近期用户输入**：`site-view.ts` 监听视图的 `input-event`，点击/按键/触摸（不含移动、滚轮）后 10s 内允许一次（`ExternalOpenGate`，一次输入一次）——`window.open` 不带发起帧，第三方 iframe 无手势调用时不再拉起系统浏览器（Electron 43 实测合成点击的 `mouseDown`/`mouseUp` 先于 `setWindowOpenHandler` 到达）。同站 `window.open` 改写进视图的 `loadURL` 拒绝被接住，由 `did-fail-load` 收口。被拦下的主帧导航（同页外链、http、block 类）在 Electron 里是 `did-start-navigation` 之后才由 `will-navigate`/`will-redirect` 取消的，只剩 ERR_ABORTED、旧文档保留：`PageLifecycle.cancelNavigation` 把阶段还原到发起前（原为就绪则重新报 ready），否则站点永久停在 loading、连重新加载都被闸门拒绝（2026-10-10 TestLab 真机，基线即有）。
- 下载不接管：站点与外壳都没有注册 `will-download`，走 Electron 默认行为（系统保存对话框由用户选择位置），应用不自动落盘、不记录下载路径。
- 权限请求处理器**只放行显式白名单**（`view-manager.ts` 的 `SITE_PERMISSION_ALLOWLIST`：`clipboard-sanitized-write` / `fullscreen` / `pointerLock`），其余一律拒绝——摄像头、麦克风、地理位置、MIDI、通知、`clipboard-read`、`window-management` 全在拒绝之列。两个 handler 都读它，改动须同步本节。
- 网页不得修改应用的任务栏／Dock 数字角标：`preload/web-badging.ts` 在页面或 Worker 的主世界把 `setAppBadge` / `clearAppBadge` 替换为返回已完成 Promise 的空操作，原型属性不可重写。Badging 不受通知权限白名单控制，当前 Chromium 也已移除 `Badging` 特性开关。`site-entry.ts` 先安装策略，再仅在主帧加载 `site.ts`；`nodeIntegrationInSubFrames: true` 只用于让子帧执行该策略，沙箱与禁用 Node 集成的约束不变，子帧不加载适配器或命令 IPC。`main/web-badging.ts` 在 ready 前监听 `session-created`，为每个会话注册独立的 Service Worker preload，包含已缓存 Worker 的后续启动。外壳自己的完成通知仍走 `CompletionNotifier`。
- `clearSiteData(site)`（站点详情的「清除缓存后重载」）**只清 `cachestorage` + `serviceworkers`**，不动 cookies、localStorage、IndexedDB——保住登录与站点自身偏好，只针对「过期 Service Worker 顶着旧资源、普通 reload 也从同一缓存来」的白屏。`await` 期间用户可能取消勾选，返回前必须重取视图引用（老引用已悬垂）；也可能开了新一轮群发并刚提交（`submitted` 仍属可重载 phase），所以 await 前后还要比较本站发送尝试身份（`GenerationMonitor.attempt`，同 runId 重试也换新），变了就不重载、返回 false。

## 3. 站点运行时注入

`desktop/src/preload/site.ts` 在隔离世界按**固定顺序**同步 require 19 条：

```
i18n → core → read-commands → tier → selection-match → send → upload → md-head → md-diagram → md → prompt-markup → adapters-intl → adapters-intl2 → adapters-intl3 → adapters-cn → adapters-cn2 → adapters-cn3 → adapters-cn4 → generation → history-route → history → history-locate → history-adapters → diag
```

- `read-commands.js` 承载只读命令 `getState`/`wasSubmitted`/`collectAnswer`/`diagnose`，挂 `__AMS.readCommand`；消息监听器仍只在 `core.js` 注册一次并委托给它（`desktop-shared-runtime.test.js` 数着），所以它必须紧跟 `core.js`。`tier.js`、`selection-match.js`、`send.js` 读 `window.__AMS`，必须排在 `core.js` 之后；候选匹配模块排在适配器之前；`generation.js` 与 `diag.js` 必须排在**全部适配器之后**——两者都按已填充的注册表逐 host 挂实现/包装，早了就静默缺席。
- **chrome shim 只剩 `runtime.onMessage.addListener`** 一条（`core.js` 用它收命令），以不可写不可配置的属性装在 `globalThis.chrome` 上。
- **locale 单向注入**：require 完成后由外壳调 `__AMS_I18N__.setLang(resolveLocale(navigator.language))`。全应用只有 `shared/locale.ts` 一份解析（`en` / `zhCN` / `zhTW`，前缀匹配，未命中的 `zh-*` 之外一律 `en`）；运行时不再自己猜语言。
- 命令通道：main 用 `contents.send("polyask:site-command", {requestId, command})`，preload 回 `polyask:site-response`。**两端都只认主帧**——`shell-ipc.ts` 的接收侧显式判 `event.senderFrame?.parent !== null` 就丢弃，再由 `manager.owns(sender)` 校验来源视图；`SiteCommandChannel.receive` 还要求 `pending.contentsId === sender.id`。
- `dispatch` 逐个遍历监听器：某个监听器返回 `true`（会异步 `sendResponse`）或已同步作答就停；没有任何监听器接手才判 `invalid_response`；无监听器时判 `adapter_unavailable`。**不在这里硬断言「有且只有一个监听器」**——模块作用域一抛，`site-command` 监听就注册不上，九站整链失守；监听器数量由离线测试 `desktop/scripts/desktop-shared-runtime.test.js` 数 `addListener` 调用点守着。
- `wasSubmitted` 的每一个失败出口都是「不支持」：超时、无适配器、异常、形状不对，一律不能被读成「确认未提交」。
- 采集正文码点上限 `TEXT_LIMIT = 1_000_000`（`site.ts`），超限不静默丢弃，改带 `answer_truncated` 码。

## 4. 群发链路与超时预算

- 普通群发、辅助综合发送、新建会话共享主进程 `OperationGate`；上一个操作未结算时拒绝新操作（IPC `operation_busy`），取消后也须等旧请求结算才能释放。渲染层辅助综合同时占用外壳操作锁并显示取消状态。取消分两条通道：群发取消 `polyask:cancel`（`shell-ipc.ts`）同时停综合派发，并作废「提交未确认」站的迟到确认；辅助综合取消 `polyask:synthesis-cancel`（`synthesis-ipc.ts`）只停综合协调器与综合导航，不碰群发状态与上一轮的迟到确认。

`renderer` → `polyask:broadcast`（`shell-ipc.ts`）→ `BroadcastCoordinator.send`（`broadcast.ts`）→ `ViewManager.sendCommand` → `SiteCommandChannel` → site preload → 站点运行时。

- **`deadline` 是绝对时间戳**，在 `broadcast.ts` 一次算出（`now() + max(1, timeoutMs)`）并原样放进每站命令，全链路透传、只读不重算。循环等待与 ≥1s 的固定等待一律夹取。
- 辅助综合通过独立的 `synthesis-` 本轮标识建立页内提交确认，完成监控不改群发计数。
- **群发预算只有 `shell-ipc.ts` 一个真源**：`request.images.length ? 90_000 : 44_000`。**辅助综合走的是 `window-data-services.ts` 里另一处硬编码的 `44_000`，且没有带图分支**——改群发预算必须同批跟进这一处，否则带图辅助综合按纯文本预算跑。
- **epoch 取消**：`BroadcastCoordinator` 每次 `send` 自增 `epoch` 并换一个 `AbortController`；`cancel()` 自增 epoch 并 abort。每个 `await` 之后都核对 epoch，不一致立刻返回 `cancelled`。新写的长流程照此办理。
- **可重试码只有两个**：`RETRIABLE = {composer_not_found, not_ready}`——只有它们代表「还没开始提交」，可在同一 deadline 内等 `min(500, 剩余)` 后重投。其它任何码（含新增的）默认不可重试。
- **提交不确定 ≠ 可以重发**：`submit_unconfirmed` 走只读确认窗（下表），确认「已提交」返回成功；确认「未提交」也**只有在开关打开时**才允许自动重发一次。开关 `POLYASK_KIMI_RESUBMIT` 是 `broadcast.ts` 的模块常量，**当前为 `false`**，不是设置项——用户不该有能力打开一条尚未真机验证的自动重发路径。测试必须显式传 `resubmit`。
- **迟到确认（只升不降，2026-10-04 用户拍板）**：`submit_unconfirmed` 的尝试仍记 `ready`、继续采集。之后第一份同时满足「本次尝试 token、`owned:true`、`locate` 为 `selector`/`semantic`（非 `anchor`）、未 `ended`、在 15 分钟观察期内」的快照（与页内 `history.submitted()` / `submissionEvidence:"message"` 同一判据）到来时，`QuestionHistoryService.accept` 把记录从 `unconfirmed` 改为 `submitted`、`submissionCode` 置 null（不新增码；回包时档位未确认的照常记 `tier_unconfirmed`，与正常成功路径一致），经 `setSubmissionHandler` 回调 `submission-upgrade.ts`：仅当外壳状态此刻仍是**同一 runId 的 `unconfirmed`**（未重试 / 未取消 / 未开新一轮）才 `markStatus` 为 `submitted` + `submissionEvidence:"message"`（档位未确认则 `warning` + `tier_unconfirmed`，渲染层结果同样带码），并 `watchGeneration` 让收口与封存照常走。渲染层 `BroadcastFlowState.acceptSubmission` 把同 runId 的 `state:"sent"` 记下，把该站 `submit_unconfirmed` 结果升为成功，重试入口消失；证据早于群发 IPC 回包到达时在提交时补上，重试的站与后续非 sent 状态作废证据。这条路径**不调用 `sendCommand` / `confirmSubmitted` / 任何 dispatch**（`test/submission-upgrade.test.ts` 断言）。**不要**为此给 Claude 等站加 `adapter.submitted()`：重发闸门按「实现了 submitted()」放行、不分站点；加了之后 Claude 首问在用户气泡出现前（实测延迟 6～13 秒）就会回 `supported:true, ok:false`。**同 runId 重试**：`polyask:broadcast` 先 `capture.prepareRun` flush 在采的站，这次 flush 可能正好把待重试站升为已发送；`lateSentResult` 认出外壳状态已是同 runId `sent` 的站，从 `dispatch` 剔除（不开新尝试、不 `beginGenerationRun`、不标发送中、不派发），直接回 `ok:true, submissionEvidence:"message"`。flush 仍没读到证据的站照常归新尝试（用户主动重试，问两遍的风险窗口从「永远」缩到几秒，不消除）。`GenerationMonitor.ticket/holds` 让在途生成探测的回包只落回发出时的条目，同 runId 重试重建的条目不收旧尝试的「生成中」。**取消**：`polyask:cancel` 只取消 `sending` 的站（辅助综合的取消走 `polyask:synthesis-cancel`，不经这里）；`cancelSubmissions` 另把外壳状态为 `unconfirmed` 的站 `holdSubmission`——采集照常，但不再迟到升级。

| 场景 | 值 | 落点 |
| --- | --- | --- |
| 群发绝对 deadline | 纯文本 44s / 带图 90s | `shell-ipc.ts` |
| 辅助综合发送 | 44s，**硬编码、无带图分支** | `window-data-services.ts` |
| 辅助综合等新会话 | 22s | `synthesis-service.ts` |
| 新会话 / 辅助综合导航前保存旧回答 | 总计 6s：读一次（≤2.5s），确认完成的候选只差静默复读时等它（≤3.05s）再读，到点不阻塞导航；随后结束这些站的采集。在辅助综合 22s 计时之前、新会话主帧计时之前 | `question-capture-binding.ts`（`SESSION_HANDOFF_MS`）、`question-capture-service.ts`（`handoff`） |
| 新会话占 OperationGate 等主帧提交 | 等 `did-navigate` 而非 `did-finish-load`（旧文档的 `did-finish-load`/ERR_ABORTED 会让 `loadURL` 提前落地，提交模式下都不算数）。单站硬上限 20s：Windows 18 次实测 96–3557ms，慢网下带 Cookie 的 HTML 约 13s（原 10s 把慢页面判成失败），取约 1.5 倍。到点先 `historyAccess.abandon` 中止未提交导航并钉 `load_failed`（`stop()` 只产生被 `PageLifecycle` 忽略的 ERR_ABORTED，不钉住会停在 loading、群发打进旧会话），再报 `not_ready` 放门，外壳显示「N 站失败」（`newSessionPartial`），重载即恢复；旧文档就是首页时保留并按成功返回（见下行「中止后保留旧文档」）。辅助综合导航后立刻发送，仍等 `did-finish-load`（`ViewManager.navigate` 默认 `"load"`）。真机：到点收口与「延迟 15/18s 后放行照常 ready」的正负对照均已验证（docs/verify.md 2026-10-05 第 7 轮、10-05/06 后续核对） | `workspace-service.ts`（`NEW_SESSION_COMMIT_CAP_MS`）、`navigation-commit.ts` |
| 视图首次加载 / 重载 / 清缓存重载 / 清站点数据 | 不占门；等主帧提交上限 20s（取值同上一行）。三种重载经 `SiteHistoryAccess.reload`、首次加载（启动、重选后重建、`replaceView`）经 `SiteHistoryAccess.initialLoad`，都先挂 `ReloadCommitWatch` 再发起；到点 `historyAccess.abandon` 钉 `load_failed`（旧代码无上限，Windows 上 Claude 曾停在 loading 11 分钟以上）。视图没有已提交文档（首次加载被中止，`getURL()` 为空）时 `reload()` 什么也不发起，改为加载站点首页。渲染进程退出即解除看门（保留 `renderer_crashed`）。看门期间 `sendCommand`/`collect` 报可重试的 `not_ready`，群发在 deadline 内重试，不往将被替换或被中止的旧文档里打字。新会话/历史恢复等提交期间（`SiteHistoryAccess.navigating`）拒绝重载、后退/前进与清站点数据：Chromium 的 reload 会丢掉未提交的 loadURL、重载旧会话，它的 did-navigate 会被 `loadUntil` 当成本次提交；到点的 `abandon()`/`stop()` 解除。只管「等提交」：已拿到响应但不出帧的情形靠 `paint-recovery.ts`；Gemini 登录回跳后 `PostAuthReloadTracker` 直接调 `contents.reload()`，不经 `ViewManager`，未接此上限。渲染层重载按钮只看 phase，提交期间点了主进程返回 false、无反馈。真机正负对照见 docs/verify.md 第 7 轮与 2026-10-06 两次复验 | `reload-commit.ts`（`RELOAD_COMMIT_CAP_MS`）、`site-history-access.ts` |
| 中止后保留旧文档（2026-10-06） | 上述新会话 / 重载 / 首次加载 / 恢复到点或取消时都走 `SiteHistoryAccess.abandon(site, contentsId, target)`：若旧文档已提交地址（`mainFrame.url`，含 pushState）**恰好等于这次导航的目标地址**、是 https、且主帧 origin 与之一致（错误页 origin 不透明），说明旧文档就是目标页本身（重载同一页、本就停在新会话页又点新会话），保留并恢复 `ready`；否则（旧会话、恢复的会话地址、首次加载无已提交文档）照旧钉 `load_failed`，群发不会打进旧会话。重载的目标默认取挂门时的已提交地址，首次加载传要加载的地址。缘由：claude.ai 带 Cookie 的 HTML 长时间不回包时，每次新会话/重载都钉失败，屏幕上那份 /new 页却完好可用。新会话因保留而到点时按成功返回（`abandon` 返回 true，`workspace-service.ts` 的 `capped()` resolve），外壳不再报「N 站失败」。代价：同一页重载没刷新成功时界面显示就绪 | `site-history-access.ts`（`keepsOldDocument`）、`reload-commit.ts` |
| 站内后退/前进（2026-10-10） | 同样先挂 `ReloadCommitWatch`（上限 20s，目标取目标历史条目地址），跨文档后退挂住时到点 `abandon`。落到同文档条目（SPA，`did-start-navigation` 带 `isSameDocument` + 主帧 `did-navigate-in-page`，Electron 43 实测）时没有 `did-navigate`/`did-finish-load`，`watchSameDocumentStep` 撤掉上限并恢复发起前的页面阶段，不再永久停在 loading | `site-history-navigation.ts`、`view-manager.ts` 的 `navigateHistory` |
| 应用发起导航忽略站点 beforeunload（2026-10-10） | 新会话/历史恢复/综合导航（`SiteHistoryAccess.navigate`）、重载（`reload`）、后退/前进及 Gemini 登录回跳重载前调用 `allowAppNavigationUnload`：期间站点 beforeunload 要挽留时 Electron 发 `will-prevent-unload`，`preventDefault()` 照常卸载；否则导航被**静默取消**（Electron 43 实测：`loadURL` 以 ERR_ABORTED 拒绝、停在旧文档，新会话 20s 后被钉 `load_failed`）。主帧提交、主帧真失败、视图销毁或 20s 上限解除，站点自己发起的导航不受影响 | `app-navigation-unload.ts` |
| 提问历史恢复 | 等主帧提交；单站 20s（`RESTORE_SITE_CAP_MS`）、总计 30s，超时与用户取消在途都走 `historyAccess.abandon`（核对视图身份 → `stop()` → 钉 `load_failed`，与新会话超时一致；拿不到视图身份时退回 `stop()`）。旧写法只 `stop()`：Chromium 只发 `did-stop-loading`，站点停在 loading、视图里却还是旧会话，群发照常打进去（2026-10-05 Windows 真机 `followups8/l1d-restore-deepseek-hang.json`）。20s 正向对照（压 15s 后放行 → opened）与超时（20012ms → timeout）已真机验证；改为 abandon 后 2026-10-06 真机复验通过（超时 20027ms → `load_failed`，取消 → `load_failed`） | `question-restore-service.ts` |
| 可重试码重投间隔 | `min(500ms, 剩余)` | `broadcast.ts` |
| 只读提交确认窗 | 固定 `now+1.5s`，**独立于群发 deadline**（deadline 到点才收到 `submit_unconfirmed` 是常态，夹在内会归零）；单次探测 ≤300ms，无人应答（页面重挂）再问，连续 5 次明确未见判未提交 | `broadcast.ts` |
| 回答采集（`collect`） | 每轮 8s | `collection-service.ts` |
| 只读诊断（`diagnose`） | 2.5s | `view-manager.ts` |
| 生成态探针（`generation`） | 单次 2.5s，轮询 900ms，连续 5 次读不到状态才放弃 | `view-manager.ts` |
| 生成监控观测期 | 起始 45s；**确实见到「生成中」后延长到 15 分钟** | `view-manager.ts` |
| 提问历史副本观察期 | 提交结果就绪后固定 15 分钟；生成或正文进度不顺延，明确终止归属时提前结束 | `question-history-service.ts` |
| Drive 周期同步 / 本机变更合并窗口 | 15 分钟 / 3s（连续写入不推迟已计划唤醒）；未来任务按最早 nextAt 到期唤醒 | `sync-engine.ts` |
| OAuth 回调等待 / 网络请求截止 | 5 分钟 / 30s | `oauth-pkce.ts`、`drive-client.ts` |
| 代理应用校验 / 密码钥匙环 / 密码惰性读取 / 测试连接 | 应用后 `resolveProxy` 有界重试 2s；`setProxy`、`clearAuthCache` 每次调用限时 5s（`PROXY_CHROMIUM_CALL_TIMEOUT_MS`，超时按应用失败处理）；密码文件的钥匙环阶段（读、写、可用性查询）各限时 10s（`SECRET_KEYRING_TIMEOUT_MS`）：写盘超时降级为仅本次运行有效（`secret: "failed"`），OAuth refresh token 写盘同样适用（connect 报 `token_store_failed`），读盘超时按读不到（`unreadable`）处理、不删文件，30s 后（`PROXY_SECRET_RETRY_MS`）才会再读，可用性查询超时按不能安全保存答复；`proxy-auth` 等待惰性读取 5s（链上那次读盘由 10s 时限结束）；测试连接请求 8s；「重新加载全部站点」关闭站点连接 5s（超时报错、不 reload）；复制诊断报告等代理状态 1.5s（`REPORT_PROXY_STATE_TIMEOUT_MS`，超时省略 `proxy` 行）。都不在群发链路内，**不改变群发 44s/90s 预算**：但 `proxy-set` 在 `OperationGate` 和代理写锁内先校验、再写密码，写盘又排在同一条链上可能已挂起的读盘之后，一次带密码的保存最坏会让群发收到 `operation_busy` 约 22s（2s 校验 + 前一次读盘 10s + 本次写盘 10s）；网络服务整体挂起时一次应用最坏占 gate 约 30s（`clearAuthCache` 5s + 恢复上一份 5s + 阻断时三个 session 与 `app.setProxy` 各 5s）。群发只会被拒、不会被拖长；后台重算同样占用 gate（见 §13） | `proxy-runtime.ts`、`secret-file-store.ts`、`proxy-auth.ts`、`proxy-probe.ts`、`proxy-reload.ts`、`renderer/site-health-actions.ts` |

**页面阶段的 `ready` = 主帧 `did-finish-load`（整页连同子资源和 load 前插入的 iframe 加载完），不是「能发了」**（`page-lifecycle.ts`，`site-view.ts` 只在 did-finish-load 调 `onReady`）。2026-10-05/06 Windows 实测（docs/verify.md「就绪判据采证」）：慢网下 Gemini 新会话可停在 loading 15–50s，而它的编辑器早在提交后数秒就已出现；群发不看 loading，照常可发；健康检查在 loading 时跳过 `diagnose`，该站显示 unknown。曾评估「输入框可用或整页加载完，先到者算 ready」：收益基本只有 Gemini（元宝约 0.6s，其余站 did-finish-load 先到），且通用 `findComposer()` 会被 ChatGPT/豆包/Gemini 的预渲染占位 textarea 骗过、须按站点只认真编辑器，**用户决定不改（2026-10-06）**，只记录语义。另：智谱遇阿里云滑块验证页时 did-finish-load 照样报 ready（页上无输入框），未处理。

改任何一格必须同时看「谁在它下游等」：站点侧的单步等待一律夹到 deadline 内，通道层 `SiteCommandChannel` 也按 `deadline - now` 起定时器，deadline 已过直接返回 `timeoutResult`。

## 5. 错误码

**main 与站点运行时只产 `code`，绝不产用户可见文案**；判定认 `code`，**绝不正则匹配文案**。翻译只有两处落点：`shared/status-copy.ts` 的映射 + `shared/copy.ts` 的三语词条。

`shared/protocol.ts` 的 `SITE_CODES`与 `status-copy.ts` 的 `STATUS_COPY_KEY` 一一对应：

| code | copy key | | code | copy key |
| --- | --- | --- | --- | --- |
| `tier_unconfirmed` | `tierUnconfirmed` | | `load_failed` | `loadFailed` |
| `composer_not_found` | `composerNotFound` | | `renderer_crashed` | `crashed` |
| `not_ready` | `siteNotReady` | | `image_invalid` | `imagePayloadInvalid` |
| `submit_unconfirmed` | `submitUnconfirmed` | | `attachment_unsupported` | `attachmentUnsupported` |
| `generation_unconfirmed` | `generationUnconfirmed` | | | |
| `timeout` | `timedOut` | | `attachment_failed` | `attachmentFailed` |
| `cancelled` | `cancelledStatus` | | `attachment_timeout` | `attachmentTimedOut` |
| `inject_failed` | `injectFailed` | | `attachment_action_required` | `attachmentActionRequired` |
| `no_view` | `siteUnavailable` | | `invalid_response` | `invalidResponse` |
| `error` | `siteError` | | `adapter_unavailable` | `adapterUnavailable` |
| `attachment_conflict` | `attachmentConflict` | | `source_changed` | `synthesisSourceVersionChanged` |
| `proxy_failed` | `proxyFailed` | | `proxy_auth_failed` | `proxyAuthFailed` |
| `command_shortcut_read_failed` | `commandShortcutReadFailed` | | `command_shortcut_save_failed` | `commandShortcutSaveFailed` |
| `command_shortcut_apply_failed` | `commandShortcutApplyFailed` | | | |

采集码另走 `describeCollectionCode`：`no_answer` → `noAnswer`、`no_view` / `no_window` → `siteUnavailable`（`no_window` 是 Drive schema 1 线格式里带进来的旧码，语义与 `no_view` 相通）、`not_ready` → `siteNotReady`、`answer_truncated` → `answerTruncated`，其余落 `failed`。辅助综合发送另有 `describeSynthesisSendCode`，另处理 `target_not_selected` 与 `operation_busy`。

- `describeStatus` **不做运行时白名单校验**：认不得的码按 `phase` 兜底，宁可笼统也不丢消息。
- `ok:true` 也可以带 `code`（如 `tier_unconfirmed`）：显示为成功 + 警示，不谎报全绿。
- `SiteResult`、`SiteStatus`、`SubmissionStatus` 可携带临时 `selection` / `submissionEvidence`，由 `shared/selection.ts` 在 preload、群发和状态边界归一。状态提示与读屏文案区分精确模型、仅模式、未确认以及本轮消息/输入框证据；生成和完成保留本轮证据，下一轮清除。失败优先显示，不能被已确认档位覆盖。旧回包没有字段则保持旧行为，不制造确认；这些字段不进 SQLite、Drive 或复制诊断报告。
- `attachment_action_required` 由适配器要求用户完成登录或站点附件操作时产出；`attachment_conflict` → `attachmentConflict` 表示上次尝试遗留的附件无法安全复用，需在站点移除后重试。
- **新增可见码要同时改三处**：`SITE_CODES`（或 `describeCollectionCode` 的 `case`）、`STATUS_COPY_KEY`、`copy.ts` 的三语。漏一处 `desktop/test/status-copy-coverage.test.ts` 会红——它做双向对账：源码里产出的每个码必须有文案，文案表里的每个码必须真有产出方，例外要在 `PRODUCED_WITHOUT_COPY` / `COPY_WITHOUT_PRODUCER` 里写明理由。
- IPC 抛出的裸码经 `ipcRenderer.invoke` 会被 Electron 包成 `Error invoking remote method '…': Error: <code>`，**唯一还原点是 `shared/ipc-error.ts` 的 `ipcErrorCode`**；不剥前缀，渲染层写好的三语文案永远不可达。
- 同步失败码另有一套：`main/sync-failures.ts` 的 `classifySyncFailure` 是唯一映射点，新增 reason 必须同步 `shared/sync-diagnostics.ts` 的 `SAFE_REASONS`（不进白名单就不会出现在报障报告里）、`renderer/sync-status.ts` 的 `describeSync`、`copy.ts` 三语。
- **站点视图内不再弹 toast**（`core.js` 的 toast 是 no-op），用户可见反馈全部在外壳。

## 6. 布局与密度

- 平台适配：`main/application-menu.ts` 生成系统菜单，macOS 的设置入口只位于应用菜单，保留服务、隐藏及窗口角色；现有命令绑定不变。「视图」菜单的重新加载、强制重新加载与缩放**不用 Electron role**（role 直接作用于获得焦点的 webContents：站点聚焦时绕过 `ViewManager` 的发送/生成闸门、提交中导航保护与提交上限，外壳聚焦时重载外壳本身；缩放外壳也不触发原生视图重排）。改为 `shared/view-menu.ts` 登记的自定义项（加速器与原 role 相同：`CmdOrCtrl+R`、`Shift+CmdOrCtrl+R`、`CmdOrCtrl+0/Plus/-`，显式写在菜单项上，快捷键速查读真实菜单照常列出），由 `main/view-menu-actions.ts` 执行：重新加载作用于获得焦点的站点视图，外壳聚焦时作用于当前聚焦站点，一律经 `ViewManager.reload`，确认框期间不导航；缩放在站点聚焦时走 `SiteZoomController.step`（记入本站比例），外壳聚焦时按 role 步长改外壳缩放后立即重排原生视图（程序化改缩放不发 `zoom-changed`）。外壳主帧每提交一份新文档（`shell-contents-bindings.ts` 监听 `did-navigate`），主进程把镜像渲染层的 surface（含确认锁）、抽屉、输入区展开和历史面板复位到初值，避免外壳经任何途径重载后确认锁永不解除、站点视图一直摘着。外壳 `main/native-shell.ts` 使用系统编辑菜单，按 `editFlags` 启用操作，不接管远程站点。窗口背景在建窗与 `nativeTheme.updated` 时匹配外壳 canvas，关闭时移除主题监听。
- 外壳 `renderer/platform.ts` 集中识别平台，仅用于外观与顺序，不作为权限依据。Windows 优先 Segoe UI Variable，macOS/Linux 使用对应系统字体；`shortcut-label.ts` 格式化可见键名，搜索兼容原始与显示写法，命令注册和 Electron accelerator 保持原值。Windows 确认在取消之前，macOS/Linux 相反；DOM 与视觉顺序一致，破坏性确认默认聚焦取消，IME 组合输入时 Escape 不关闭弹框。
- 快捷键速查额外列出提问框内发送的只读参考（Ctrl+Enter / ⌘↵），不进入命令注册表或菜单加速器；点击及 Enter 不分发操作。`command-search.ts` 的 `searchTerms` 只参与检索，兼容发送/send、Enter/↵，不作为额外键位展示。实际发送继续由提问框的 `keyboard.ts` 上下文处理。
- `focusable-controls.ts` 为局部焦点圈统一收集可见的链接、按钮、表单、summary、tabindex 和可编辑元素，过滤隐藏、禁用及折叠内容，遵守正 tabindex 顺序。历史全屏与文件夹弹框共用；门户菜单先处理退出并返回触发器。Escape 同时检查组合态和 229 键码，只拦截向外传播，保留输入法原生取消行为；图片面板普通 Escape 仍在冒泡阶段处理。
- `native-feel.css` 限制工具栏文字选择但保留正文/输入可复制，支持系统增加对比度、强制颜色与减少动态效果；`usePresence` 同步尊重减少动态效果，不保留无动画的退场等待。原生适配技能来源及研究依据记录在 `.native-feel/`，不要求架构迁移、透明材质或自动更新。
- 按钮按压采用即时静态反馈，不做全局缩放；`aria-disabled` 与原生 `disabled` 都不显示接受点击的反馈，前者仍可聚焦读取不可用原因。分页选中底板扣除容器内边距，与页按钮实际边界对齐。动态计数使用等宽数字；附件缩略图使用不占布局的中性内描边，高对比度时跟随系统颜色。细节技能的固定来源与项目取舍记录在 `.interface-polish/`。

- 工作台站点区域常驻已开页数与参与发送站数，并说明取消勾选仍保留页面；同步保存说明按需展开，关闭按钮独立且有间距与分隔线。
- 顶部栏、工作台与历史入口通过 `data-hint` 提供辅助提示，`control-hints.ts` 在底部反馈条展示：鼠标悬停 350ms、键盘聚焦即时；离开、点击、输入或 Escape 后关闭辅助提示。通知与辅助提示分别显示，提示不遮住待处理通知或恢复动作，不写入任务通知或 sr-only 播报；新的可见通知清除上一通知的动作，模板撤销独立保留。
- 总览/聚焦按钮通过显式 `aria-label` 保留三语动作名，自动聚焦原因仍走辅助提示。发送与结果库入口在所有 `data-fit` 级别保留文字，级别 2 起隐藏两者图标为名称让位（英文结果库短标签为 Library），级别 4 将总览/聚焦收为一个具名切换按钮；更多菜单保留历史，并为收起的比较动作补项。采集可用且无当前通知的恢复动作或撤销动作时，底栏显示“采集并比较”，普通群发摘要仍保留；回调跟随当前工作范围，繁忙、失去可用回答或命令栏卸载即移除，不自动采集或发送。
- 设置按显示与操作、同步与备份、连接与应用、数据管理四组组织，普通打开默认显示日常偏好，明确跳转保留原目标；分组导航用 `aria-current="location"` 标记当前阅读分区；显式跳转后的实际滚动位置未变化时保留目标，手动滚动后恢复跟踪。按吸顶导航下方首个仍可见的分组定位，分组间隙不保留已离屏组的标记，也不将尚在下方的折叠末区强制设为当前。滚动与尺寸变化只更新标记和导航的水平位置，不抢焦点或写偏好。结果列表显示来源总数与两站预览，完整名单保留在提示和读屏文本，不改变摘要数据、搜索和详情读取。
- 比较的回答与人工对照在同一工作区切换，保留两栏 DOM、阅读位置和笔记。正文或表单按剩余高度滚动，正常双栏不额外增加外层滚动；不足 160px、单列或展开长记录信息时保留外层退让。比较默认折叠记录上下文，保留单行问题摘要与“问题与记录信息”入口；展开复用原问题、操作及元数据表单，折叠不解除未保存保护，普通阅读完整显示。人工对照无摘录时可就地核对保存原文并加入摘录；取消返回入口，加入后聚焦摘录字段。各类备注按需展开，已有笔记与分类返回来源时展开，不改变草稿、证据校验和决策保存契约。
- 结果库外层和嵌入保存结果使用不同的具名区域，嵌入详情不再设第二个 `main`；布局、档位、范围以 `group` 暴露名称，设置反馈使用普通容器承载 `status` 与 polite 播报。
- 保存结果进入专注阅读时，文件夹和更多操作经 `LibraryRecordToolbar` 的顶层 DOM 插槽合入工具栏，移除独立记录管理行；视觉与 Tab 顺序一致，短窗口回收一行高度，窄窗按需换行保留按钮尺寸。正文节点、来源与阅读位置保持；返回浏览恢复原管理栏，综合/追问编辑和决策卡继续使用各自工具栏。
- 结果库采集按钮用独立的三语 `aria-label` 与 `title` 保留动作名称，窄窗隐藏文字不影响识别。比较左右正文是带来源编号与站名的 Tab 停靠点，沿用共享可见焦点并向内绘制；方向键和翻页键由浏览器原生滚动该栏，重入保持当前位置，摘录按钮仍可继续 Tab 到达。
- 结果库未选择内容时，主标题区分全库尚未保存、当前范围为空和筛选无匹配；加载与失败期间保留相应状态，不将其视为空库。保存回答的表格滚动区域以来源编号、站名和表格序号命名，比较分段额外带段落定位，其他正文使用分析或字段上下文；历史日期组为主标题之下的二级标题，正文及原有视觉样式不变。
- 快捷键速查复用命令面板的搜索控件与真实快捷键列表，按动作、本地化分类及原始或显示键位筛选；菜单条目继续去重且仅供参考。两个页面各自保留查询，空查询恢复全表，输入法合成态和229键码不触发执行或关闭。
- 结果库菜单和选择器的指针入场为 160ms 透明度与 0.97→1 缩放，起点跟随实际触发按钮中心及上弹/下弹方向，箭头反馈为 140ms；复用 `--ease-out`，仅作用于工具浮层和箭头。键盘/辅助点击打开及键盘接管时显式取消过渡，系统减少动态效果保留静态展开状态；关闭、选择和禁用立即生效，不保留退场等待。正文、列表和原生视图几何不参与该动效。

- 全页面共享底部反馈条（`WORKSPACE_FEEDBACK_HEIGHT = 32` CSS px）；主进程布局减去同一高度，避免原生站点遮挡。关闭按钮统一无边框、同尺寸图标、悬停浅底与键盘焦点环。工作台、附件及历史面板以 180ms 入场、140ms 退场，透明度与最多 6px 的 DOM 位移可中途反向；关闭即 `inert` / `aria-hidden`，退场结束后才解除原生预留宽度或历史覆盖。历史在新的确认 surface 接管后立即退出，不由迟到退场恢复站点；后台视图仍挂载并保留正视口。键盘工作台及减少动态效果路径没有退场等待。原生站点 bounds 不逐帧插值，结果库与设置保留 160ms 入场淡入。后台站点轮询只播报、不覆盖用户操作提示。群发汇总保留到用户关闭或下一项操作，复制成功提示 6 秒后收起。

- 工具栏仅在多页时显示紧凑范围分页，站点全名和状态留在提示及无障碍名称中；整轮进度通过 portal 放入已有底部反馈条，不增加常驻行或主进程高度。发送站点列表的排序按钮与标题同行，取消勾选仍保留页面。自动两站引导已撤除，命令面板手动使用指南保留。
- 单页最多 4 个站点（`shared/site-pages.ts` 的 `SITE_PAGE_SIZE = 4`）。1–4 站动态排布，5–9 站按 3+2、3+3、4+3、4+4、3+3+3 均衡分页，避免只有一站的末页。换页只改叠放次序与 bounds，不销毁、不重载、不中断生成与滚动位置。
- Overview（总览）是等权比较视图；Focus 是主次阅读视图，次要站点仍是实时可交互的 `WebContentsView`，不得降级成截图或状态卡。Overview 恢复用户保存的已选站点顺序；Focus 记住每页最近主站。
- 几何：Overview 1 站铺满、2 站左右、3 站三分、4 站 2×2；Focus 1 站铺满、2 站约 2:1、3–4 站左主右次。请求 Overview 但格宽 `<380` 或高 `<210` CSS px 时自动落 Focus（`main/layout.ts` 的 `GRID_TILE_MIN_WIDTH` / `GRID_TILE_MIN_HEIGHT`，按当前页实际站点数算）。
- 密度令牌在 `shared/display.ts`：compact = 外壳高 52 / 标题条 24 / 边距 4 / 间距 4；comfortable = 64 / 32 / 8 / 8。完整逻辑宽度不足 960px（如最小窗口外壳缩放 200%）时，工具栏按原键盘顺序分为三行，收起高度 120 / 144、展开高度 200 / 240；字段自身展开高度仍为 112 / 136。历史侧栏只扣站点宽度，不改变工具栏档位。宽窗提问框显式展开时外壳临时升到 120（comfortable 144），附件、档位、工作台及普通失焦不收起；显式收起或非组合态 Escape 恢复，独立 surface 切换及本机重置结束本次编辑上下文。始终保留同一 textarea 的内容、选区和位置；确认覆盖及历史阅读不打断编辑。所有尺寸走 4px 基础令牌，禁止逐组件散落魔数。
- 外壳提问框及所有文字输入（包括门户菜单搜索）共用 `fields.css`：无实体灰色外边，浅底、2–4px 紧阴影及低饱和内底线，鼠标与键盘相同，复制快捷键不改变样式；错误底线、只读可复制、禁用及系统强制颜色分别保留。`composer-activation.ts` 区分明确编辑和恢复焦点：点击输入区（含已聚焦重点击）、普通 Tab 进入、聚焦命令、模板与历史回填展开；Esc/收起后，分组、布局、档位、附件、窗口及程序恢复焦点不展开，直接继续输入也保持收起。Tab 意图在其它控件取得焦点、keyup、pointerdown、窗口失焦时清除，被阻止或组合态 Tab 不算进入。取消关页保留可用原焦点，否则回工作台入口；普通 Esc 只处理当前层，IME 保留原生行为。发送回包中至少一站成功且发送时的草稿修订仍有效时，清空草稿并复用退场自动收起；全部失败、取消、提交未确认或回包缺失时不收起，已编辑的新草稿也不受旧回包影响。
- `useWorkspaceMotion` 协调 DOM 与主进程：开时先请求最终原生空间，收到 `onLayout` 的已展开位置再用 180ms 揭示输入区；收时只用 140ms 收起可见输入区，结束后一次释放原生空间。工具栏保留最终高度，不把九个网页每帧缩放或替换为截图；原生网页的布局仍在开合边界变化，不承诺整个网页网格连续插值。`composer.css` / `panel-motion.css` 的退场时长须与 `motion.ts` 一起维护，减少动态效果时取消过渡和等待。
- 页面缩放与密度相互独立：未手动调整的站点沿用 `siteScale`（`0.9` 或 `1`），Focus 主站默认 1（`zoomForSite`）。AI 页面取得输入焦点后，Ctrl++／−（macOS 同时支持 Command）及 Ctrl+鼠标滚轮按浏览器常用档位调整本站，范围 25%–500%；Ctrl+0 固定恢复本站 100%。`main/site-zoom.ts` 接收原生输入并调用 `webContents.setZoomFactor()`，不向远程页面暴露接口；手动比例优先于布局默认值，开关侧栏、翻页、切换 Focus、导航和视图重建均不覆盖。快捷键速查三语列出放大、缩小、恢复及滚轮说明；外壳取得焦点时同一组快捷键缩放外壳，并随即按新缩放重排原生站点视图。
- 命令栏一条通用：Overview、Focus、窄窗共用同一套控件优先级。始终显示提问框、档位、发送/取消、站点名、是否参与群发与运行状态；空间允许时显示布局文字与选择数量；聚焦、重载等站点动作常驻标题右侧，后退仅在有可退历史时出现。紧凑模式交互目标不小于 24×24 CSS px，检测到粗指针切 comfortable。
- 颜色与文字令牌集中在 `renderer/theme.css`，表面分为 canvas/panel/field，强调色配套 on-accent 前景，状态文字用独立 ink 色以保证明暗可读性；品牌沿用靛蓝：亮色 `#4f46e5`、暗色 `#a5a0ff`，成功 `#16a34a`、失败 `#dc2626`，其余用系统中性色；字体 `system-ui`，不捆绑字体。站点标题条按选择标签、状态圆点与文字、常驻操作排列；加载时底边显示不定进度细线，由真实 loading 阶段驱动，就绪或失败即停止，不显示估算百分比，减少动态效果时显示静态细线。不加装饰渐变与无信息动画。布局切换不为原生视图 bounds 伪造动画。
- 结果库当前记录采用靛紫轮廓与浅靛紫底，悬停不覆盖选中反馈；决策状态在列表与阅读详情共用中性草稿、琥珀色待验证、绿色定稿，保留状态文字和人工判断说明，不表示事实已核实。状态底使用独立的 `success-soft / warning-soft` 明暗色；增加对比度时补可见轮廓，强制配色服从系统。
- 阅读空间优先，完整逻辑宽度 ≥960px 时命令栏保持单行，更窄时遵循上述三行契约：发送/取消和结果库始终保留文字，发送显示目标数，完整操作名由三语 `aria-label`/提示提供；采集并比较显示文字时按内容宽度布局，不沿用仅图标按钮的固定宽度。单行内的收纳由 `renderer/toolbar-fit.ts` 依实际内容逐级累加 `data-fit`，取输入框不窄于 320px 的最低级别：1 收起次要文字与快捷键，比较按钮只留图标（分页把范围与最严重状态及其数量分行，其余状态留在提示及可访问名中；重试显示图标与数量）；2 收起档位说明及发送/取消、结果库图标，保留操作文字；3 历史入口改由「更多」菜单承接、回答模式改为原生下拉；4 站点状态入口让位（需关注红点移到工作台入口），释放该按钮的保底宽度，总览/聚焦改为单键切换，采集并比较进入「更多」菜单。结果库阅读正文用 16px / 1.8、对照正文用 15px / 1.8，代码块用 13px；设置页辅助说明至少 12px。结果库来源导航在详情区大于 480px 时换行，更窄时横向滚动；设置页 980px 及以下切为单列，操作按钮自然换行。不改变原站网页字号。
- 应用菜单提供 `Alt+Q` 展开并聚焦提问框 / 收起并返回当前站点，保留草稿与附件；`Alt+W` 聚焦当前站点，不改变布局。当前站点跟随可见原生视图的实际焦点；上/下一站点保留命令面板入口，移除 Ctrl+PageUp/PageDown 绑定。系统全局提问快捷键始终展开并聚焦，不参与切换。`Alt+1`/`Alt+2`/`Alt+3` 直达站点页（不存在的页码保持当前页），`CmdOrCtrl+Shift+PageUp`/`PageDown` 顺序换页——焦点进入原生站点视图后要能回到外壳。Windows/Linux 菜单栏默认自动隐藏、按 `Alt` 临时显示；macOS 用系统全局菜单。

## 7. 数据边界与本机数据管理

查找状态的 `revision` 只随查询、范围、原生结果与操作变化；位置摘要单独递增 `positionRevision`。渲染器按这对版本拒绝迟到状态，菜单仍按语义 `revision` 校验，因此位置条更新不会让已打开的原生菜单选择/刷新失效。

- **查找位置条**：Chromium 原生查找仍决定计数、高亮和前后导航。根滚动条可见时保留原生短线；网页内部滚动或隐藏根滚动条时，`site-find-position-script.ts` 在独立世界 1101 只读匹配位置，`site-find-markers.tsx` 在外壳预留的 6 CSS px 右缘绘制橙线。所有前后台站点统一缩窄，后台视图不得漏出。只返回归一化坐标，不改 DOM、选区、输入或滚动，不返回正文或读取输入值。每页跨查询最多一个未完成探针；100ms 合并，等待与读取总窗 1.2s，扫描限 350ms、5 万文本节点、100 万字符和最多 1000 个位置桶。只有 DOM 可见匹配数与原生数相等且属于同一滚动区才画；不可读 iframe、shadow DOM、复杂分词/空白折叠、多个独立滚动区或超限时降级为原生查找。换词、范围、导航、关闭、不可用与销毁使旧摘要失效，布局变化后重算；新页面内容仍可手动刷新。摘要只在内存中使用，不进入同步、备份或诊断。
- **历史键盘翻页**：历史列表与回答阅读区为具名、可聚焦的 region。打开详情时以 `preventScroll` 聚焦阅读区，后台刷新不重复抢焦点；返回列表聚焦搜索框。搜索框内无修饰 PgUp/PgDn 将焦点交给列表并滚动可视高度的 87.5%，后续使用 Chromium 原生翻页；IME、修饰键、非活动面板及阻塞对话框不消费该交接事件。既有阅读位置记忆与菜单、图片查看器的焦点规则保留。

- 日期显示经 `shared/format.ts` 处理：同步逻辑时钟可以大于 JavaScript 日历上限，界面此时显示“—”并省略 `datetime`，导出文件名使用 `undated`；不得为修复显示而改写原始时间、排序或同步版本。结果备注沿用 4000 码点上限，在表单内计数与校验，不用按 UTF-16 计数的 `maxLength` 截断 emoji；超限和保存失败保留编辑内容。

- **跨站页面查找**：`CmdOrCtrl+F` 经应用命令打开 `renderer/site-find.tsx`，先关闭侧栏、附件和历史面板，重复按键保留未提交编辑并全选查找词；反向打开这些面板也会关闭查找。可信 Shell 的 `polyask:find-*` IPC 只接受有限查询、范围、方向和站点键；`main/site-find.ts` 对已打开站点的原生 `findInPage` 汇总计数，按请求 ID 丢弃旧回包。默认全部页面，含后台分页；仅当前站点跟随工作台聚焦站点。Enter/Shift+Enter 按页面顺序前后循环，等待回包时动作按序排队；选中站点保留原布局模式并切到对应页，搜索框保持输入焦点；Esc 清除高亮并恢复站点焦点。IME 键不消费。导航使旧计数失效，加载结束、取消或失败后重查；新出现的文字可手动刷新。查找 4 秒无最终回包时标记本站不可用，不阻断其它站点、发送或采集。离开站点表面、确认覆盖、外壳重载和销毁均释放查找监听；渲染层在每个异步操作后核对会话、操作 epoch 和查询范围，旧动作/错误不得进入新查找。单行搜索条预留 `shared/site-find.ts` 的 48 CSS px，输入框常规宽 250px（最高 320px），窄窗按需缩短；优先收起站点计数，再将刷新/范围说明交原生菜单，范围、状态、前后跳转及关闭始终保留。原生菜单内容仅由主进程当前状态生成，`polyask:find-menu` 只接收整数 session/revision；展示前及结果返回后核对 open/session/revision/query/scope，关闭、重开、查询变化或卸载后的旧回调不得选站或重查；原生视图随密度、输入区展开和外壳缩放同步重排。只查当前加载的网页文字（含菜单），不加载旧会话、不 OCR；查询及计数只在内存，不进同步、备份或诊断报告。

- 生产结果库列表通过受信 `polyask:folder-query` 返回分页摘要、总数和有效选择，回答正文及决策表单正文按选中 ID 读取。文件夹归属、关键词和状态筛选在 SQLite 执行；日期排序用 LIMIT/OFFSET，标题排序仅扫描 ID/标题窄投影并按语言排序。跨页选择不能按当前页裁剪；旧完整查询用于兼容，不作为生产列表路径。摘要是只读投影，不新增持久键、不改变同步线格式或备份。

- 引文报告复用辅助综合的 instruction/text 字段和保存替换流程，不新增持久键。`answerSourceId(index)` 从结果快照的原始数组位置生成 `[S1]` 等编号，页面、发送载荷与导出一致；选择子集不重编号。载荷明确截断或完整性未验证，报告预设要求逐字摘录并区分推断；应用不将模型引文标为已验证，也不自动将模型输出解析成可信引用。未来若允许修改/重排原始回答，必须先迁移编号语义。

- 模板删除先在外壳内等待 6 秒（跨页面保留撤销入口），到期才调用原有 tombstone 删除；撤销不写数据库，不新增持久键。等待期间退出应用保留模板。

- 本机库是 `app.getPath("userData")/polyask.sqlite`（Electron 内置 `node:sqlite`），WAL、外键、参数化仓储、事务 outbox。SQLite user_version=5；这是本机表结构版本，与各实体的同步 schema 分开。表：`questions`、`question_answers`、`question_attachment_sets`、`question_attachment_items`、`history`、`archives`、`decisions`、`folders`、`folder_memberships`、`state_items`、`outbox`、`drive_files`、`meta`。
- **本机界面状态与可同步偏好分开保存**：窗口范围、最大化、当前页、每页焦点仍仅保存在 `desktop-ui-state.json`，不跨设备同步。布局与逐站缩放从旧文件迁移到偏好库后由库决定有效值，文件仍记录本机视图快照。恢复窗口限制到可见显示器；不恢复临时抽屉、确认框或执行进度。
- 共享偏好使用 `state_items` 的 `preference:<key>` 和 state schema 1 的 `polyask.preference.<key>` setting，每键独立版本；通知、引导状态与可「不再提示」的确认（`CONFIRMATION_KEYS`：`sitePageCloseConfirm`、`newSessionConfirm`；弹窗勾选并确认才写 false，「设置 › 确认提示」可恢复；跳过弹窗时关闭页面仍先走只读预检与发送/生成/保存保护，新会话仍受忙碌/草稿确认保护；删除/清空/重试复核类确认不得接入）共享，显示密度/默认比例、默认布局、各站手动比例分别可选跟随同步。`meta.devicePreferences` 保存本机覆盖与三个跟随开关，默认均为本机覆盖；不投影、不备份。旧 localStorage 和 UI 文件只补缺失值，已有共享通知/引导不被旧缓存覆盖；旧缓存共享种子用 updatedAt=0，后来到达的有效云端版本优先，用户显式保存取得当前单调版本；晚到显示迁移仍保留本机覆盖。只有用户明确选择布局才修改默认布局，辅助发送临时聚焦不写入默认值；远端布局应用不抢键盘焦点。
- 草稿使用 `state_items` 的 `draft:<id>` 与 schema 1 setting `polyask.draft.<id>`，格式 1；种类为问题、人工比较、决策、综合（含独立追问上下文）。读取失败后的显式重试先恢复列表与主进程 epoch，再保存当前编辑；旧 epoch 回包不得恢复已重置内容。表单不含执行中状态或完整回答副本，每设备/种类/上下文独立分支。`meta.draftSyncEnabled` 默认关闭，只在开启后投影与接收草稿；关闭保留既有云端内容。编辑器自动保存本机，恢复先预览并核对来源，脏稿替换需确认，远端变化仅刷新候选副本。成功发送/保存按草稿 ID 和版本删除，不删之后新编辑；重置和清空使 IPC epoch 失效，旧保存不可复活被清数据。墓碑清空正文但保留身份，重新编辑产生新 ID。
- **草稿投影与墓碑回收**（`sync-drafts.ts`、`draft-retention.ts`）：开启同步时 state fragment 发布本机自己的活草稿、身份严格为 `backup:<草稿 ID>` 的独立恢复分支与本机已知的全部墓碑（含替其它设备分支写下的删除），其它设备的活草稿由其所有者发布；本机上一份云端 fragment 里的草稿键不再沿用（关闭同步时仍携带已知云端内容；同设备重复片段先合并，草稿墓碑始终优先于活副本）。恢复分支可由持有它的设备发布，但自动保存与 `removeOwn` 不把它当作本机编辑分支。墓碑在 `deletedAt` 超过 30 天（`DRAFT_TOMBSTONE_RETENTION_MS`）且已知的全部 fragment（`meta.remoteStates`，含本机自己的云端副本）都不再以活草稿形式携带该 ID 时才物理删除；只要有一份 fragment 仍是活副本（所有者尚未收到删除，或离线设备的旧副本），墓碑就继续保留并继续上传。对本机没有记录的分支，超期墓碑不再导入，因此回收后不会被其它副本反复写回，也不会因此触发界面刷新。LWW 语义不变：同分支墓碑优先于任何活副本。剩余边界：旧版客户端会转发其它设备的活草稿，若它曾下载某草稿却在上传前离线超过 30 天、且期间全部设备都已回收该墓碑，它回来时可能把该草稿重新发布为候选副本（只出现在恢复列表，不覆盖任何表单）。回收只在拉取合并后与新建草稿分支时执行，不入 outbox。
- 新键登记：`preferences-repository.ts` / `draft-repository.ts`、`sync-preferences.ts` / `sync-drafts.ts`、`database.resetLocalData()` 清空 state/meta，以及只增 fixture `schema1-state-preferences.json` / `schema1-state-drafts.json`。无需修改 SQLite schema；凭据、窗口与瞬时焦点保持本机。
- **删除一律 tombstone**：写 `deletedAt` + 入 outbox，不物理删（草稿墓碑传播完成后的保留期回收见上文，回收的只是墓碑本身）。`DataAdminService` 的「清空历史」「清空结果库」「清空决策卡」「清空任务文件夹」「清空草稿」走的就是这条正常路径，删除会同步到其它设备——否则其它设备会把记录同步回来。
- **「重置全部本机数据」是本应用唯一的物理删除路径**，语义刻意不同：先 `sync.disconnect()` 断开 Drive，再 `database.resetLocalData()` 物理清空十二张业务/同步表（含两张原图表）并只保留 `meta` 里的 `deviceId`；随后的 VACUUM / WAL checkpoint 收缩失败只记 `reset_compaction_failed` 告警，不让调用方跳过收尾，主进程 `afterReset` 与渲染层 `onReset` 无论重置成败都执行（失败时清空可能已经发生）。这里**不能用 tombstone**——tombstone 比云端记录新，重新连接后会赢过云端副本并上传，等于把云端也删了，与「重置不会删除云端数据」的承诺相反。`deviceId` 保留是因为本机在云端的旧 fragment 靠它找回，换掉会让重置后首轮上传把本机不建模的设置键整体丢掉。同设备有多份远端 fragment 时，携带设置与模板前先合并全部片段，再收敛重复文件；普通键按现有 LWW，草稿按删除终态。改这两条语义之前先改用户可见的承诺文案。
- Drive 同步：scope 固定 `https://www.googleapis.com/auth/drive.appdata`，全部操作限定 `appDataFolder`。旧实体沿用 `SYNC_SCHEMA = 1`：每设备一个 state fragment、每设备/文本哈希一份 history、每条结果库记录一份 archive；按 `updatedAt` 后 `deviceId` 合并，同时刻 tombstone 优先。独立 decision 实体采用 schema 2，文件夹和关联实体采用 schema 3，提问/回答采用 schema 4、原图集采用 schema 5，`SUPPORTED_SYNC_SCHEMA = 5` 表达客户端可识别的最高版本；state/history/archive 仍仅接受 schema 1，不将未知的 state schema 2 冒充可兼容。遇不支持格式进入同步只读，仍可下载可识别文件但禁止上传。
- 出箱仍有记录时保持 `waiting`，不把“暂未到期”当空闲。按最早 `nextAt` 唤醒，限流遵守退避与 Retry-After；旧失败只更新相同 revision，不覆盖上传期间的新修改。断开或销毁取消定时器并使排队任务失效。
- **上传隔离与大文件**（`sync-engine.ts`、`drive-client.ts`）：出箱按批上传（state 整份一批，其余实体一条一批）。只与本批载荷/目标有关的失败（`request_failed`、`invalid_response`、`not_found`）只给该批记退避，其余批继续上传，本轮仍如实报 `error` 并按该批退避唤醒；限流/服务端错误整体退避，鉴权、配额、网络等全局失败仍立即中止本轮。Drive 文档规定 multipart 只用于 5 MB 及以下文件，正文超过 4 MiB（`MULTIPART_BODY_LIMIT`，留 ≥20% 余量）改走 resumable：先以元数据开会话，`Location` 必须仍是 `https://www.googleapis.com/upload/drive/v3/files…` 才带令牌，再一次 PUT 整个正文；失败不续传，由出箱下次重开会话，超时按体积放宽（按 ≥128 KiB/s 估算）。
- **同键重复文件收敛**（`sync-duplicates.ts`）：首次创建的响应丢失（超时、崩溃）会在 Drive 留下同一逻辑键的多份文件。每轮拉取后（只读模式除外），本机负责写入的键（自己的 state 文件与共享实体 archive/decision/folder/folderMembership/question/questionAnswer/questionAttachments）若对应多份，保留文件 ID 最小的一份（与 `findDriveFile` 选择一致，各设备结论相同），删除其余并把本机合并后的胜者重新上传进保留文件；删除失败留待下轮。原图集还须满足附件出箱资格、本机胜者可完整校验且所有同键远端副本已验证（`seenAt !== 0`）；活原图集要求开启原图同步并满足父依赖，墓碑资格见「提问历史存储与同步基础」。其它设备自己的 state/history 文件交给其写入方。上传时若索引中的文件已被其它设备删除（404），改写幸存副本或新建。
- **站点顺序同步**：SQLite 复用 `workspace.selectedSites`，不新增业务键或 schema；`sync-repository.ts` 将顺序投影成 state fragment 的 `amsConsole.siteOrder` 主机名数组，与 `amsConsole.selected` 同时写入相同版本。拉取只采用与勾选版本一致的顺序，过滤未知/重复/未选项并按默认顺序补齐缺项；旧客户端更新勾选而保留旧顺序时回退默认排列。上传保留远端未知站点的勾选与顺序字段。分组 `hosts` 数组保序；分组云端副本含本机不认识的 host 时（`sync-groups.ts`），未改动的分组按云端副本原样上传（同版本同内容），本机改名/改站点则替换已知 host、保留云端最新副本里的未知 host 并以新版本上传，不再被下一轮拉取回滚。备份沿用既有 workspace/group 字段，`resetLocalData` 随 `state_items` 和 `meta` 清除本机顺序，重连可从云端恢复；冻结兼容样本为 `desktop/test/fixtures/schema1-state-site-order.json`。
- **发送站点勾选同步**：SQLite 的 `workspace.participation` 保存站点集合、独立 `updatedAt` 与 `deviceId`，经受信 `set-participation` IPC 写入 workspace 并入 outbox；修改档位、打开页面或排序不改勾选版本。Drive state schema 1 新增 `amsConsole.participating` 主机名布尔映射，保留未知站点的 true/false；缺字段兼容旧数据默认已打开页面全部参与，明确空映射表示零站参与。非布尔载荷不采用；已有有效本机偏好时保留，无有效偏好时采用空集合，不能把字符串 false 当启用。当前客户端整体合并此偏好，冲突按既有时间戳、设备 ID 裁决。
- **勾选确认与恢复**：界面等待页面打开与勾选保存各自回执，保存期间阻止发送；独立版本阻止旧回执覆盖较新推送，保存失败立即恢复最近权威状态。云端推送只更新后续发送范围，原轮与重试仍用冻结的范围。关闭页面只从有效范围排除它，期间编辑其它站点仍保留关闭页的偏好；重新勾选会先开页再保存。旧客户端可透传此设置但不会显示或应用它。备份 workspace 包含偏好与版本、不含设备 ID；提供偏好的备份恢复重记本机新版本，旧备份缺字段时保留现有独立偏好与版本。`resetLocalData` 随 state_items/meta/outbox 清除，重连可由云端恢复；固定样本为 `desktop/test/fixtures/schema1-state-participation.json`。
- 加密 refresh token 经 `main/secret-file-store.ts` 写入（`TokenStore` 是它的薄包装）：先写同目录独占临时文件（0600），完成写入、同步与关闭后原子替换；失败清理临时文件，保留原令牌文件。无安全加密后端时仍仅保留进程内令牌；明确保存替代令牌时，在同一串行队列内清除旧密文，清除失败报 `token_store_failed`，防止重启使用被替换的账号。单纯读取失败仍不删文件。启动前的可用性查询同样限时 10s，超时按不可用继续初始化。钥匙环阶段（读、写、可用性查询）各限时 10s：写盘超时不建临时文件、不动旧文件，首次连接报 `token_store_failed`（以前钥匙环挂起时连接会一直挂着），令牌轮换路径保留内存令牌、不报错；读盘超时与解密失败同样处理（`load()` 返回 null，不删令牌文件，下次再读）。
- 网络代理的持久化（`preference:proxy`、本机 meta 键 `proxyOverride` / `proxyFollowing` / `proxyAccepted`、加密的 `proxy-secret.bin`）、备份排除与本机重置顺序见 §13「数据边界」。
- 结果库过滤在 SQLite 执行，保持既有 searchText 的大小写与字面搜索语义；标签独立查询，不再为标签加载全部回答。历史每页批量读取尝试摘要，正文仍只随选中详情返回；不新增数据库字段或同步格式。
- **schema 1 的线格式冻结在 `desktop/test/fixtures/schema1-*.json`**（每个文件 `{file, body}`，出自扩展时代的真实实现，代码保留在 tag `archive/extension-v0.25.1`）。**不要重新生成、不要按新校验「修正」它们**：`schema1-wire-format.test.ts` 把全部样本喂进下行链路并要求逐条接收，任何一次校验收紧命中存量形状会先红在那里，而不是在用户的结果库里静默少几条。新增决策卡 schema 2 另增 `schema2-decision*.json`，文件夹及关联 schema 3 另增 `schema3-folder*.json`；旧实体仍为 schema 1，冻结样本不变。
- **两条跨端不变量**（跨设备记录要能互认，改一端就是让另一端拒收）：
  1. **提问在派发之前无条件入库**——`shell-ipc.ts` 的 `history.record(request.text)` 先于 `coordinator.send`。请求校验、图片站点支持检查、操作互斥及 `collection.beginRun` 的过期轮次检查都在记录之前，被这些检查拒绝的请求不入库；**全部站点都失败的提问照样留记录**，这是有意的（用户要能重发）。
  2. **结果库字段上限按码点计、两端一致**（`shared/archive.ts`）：`title` 512、`instruction` 4000、`note` 4000、`host`/`label`/`winnerHost` 256、预览 `text` 320、`state`/`code` 64、单个 `tag` 32、`tags` 数组 20 项。`title` 与预览**截断**，其余**超限即 throw**。新增字段必须同时进这张表，否则表现为「某台设备的记录同步不过来」。
- 上传图片不再自动打开管理区；只保留顶栏数量入口，警告以同一入口圆点及提示显示。点击后临时使用工作台侧栏宽度，关闭即归还；与工作台、历史入口互斥，输入框展开仅由编辑状态决定。保留完整缩略图、文件名与独立删除按钮，更换为整批替换，关闭后焦点返回入口。
- 待发图片属于本次提问：`useImageSelection.prepareSend` 捕获图片批次及清理闭包，`useBroadcastFlow` 在同一 runId 首次有任一站成功时调用一次，覆盖首次回包、主动重试和迟到确认。全部失败、取消且无成功、结果未确认或 IPC 异常均保留。文字与图片分别按自己的修订清理；后续文字编辑不保留已发旧图，新图落地后不被旧结果清除，切换表面不算改图。消费旧图不中断较新的读取/文件框；追加读取完成后基于当前批次组合，防止旧图被重新加入；取消选图或选到无效文件也不保留已发旧图。重试始终使用原请求的图片快照，历史原图保留不受影响。
- 图片限额：单批最多 4 张 PNG/JPEG、合计不超过 10 MiB（`shared/images.ts` 的 `MAX_IMAGE_COUNT` / `MAX_IMAGE_BYTES`）。**改任何一个数，代码 + 三语词条 + README/docs 叙述的全部落点要一起改**，清单与当前数值以 `scripts/test-image-limits.js` 的对账项和 `docs/adapters.md` 的「图片载荷」为准，别凭记忆列。
- 便携版：根目录 `portable.json` 识别发行形态，`userData` 与 `sessionData` 都切到同级 `PolyAsk Data`。根目录固定分为可替换的 `App` 与持久的 `PolyAsk Data`，升级只替换 `App`。首次运行才询问是否从系统默认目录复制旧资料，复制走旁路暂存 + 重启后切换，失败保留旧资料；复制出的 profile 获得新的同步 `deviceId`，避免用户回退旧版后两个客户端覆盖同一份云端状态。设置页只拿到裁剪过的版本号与发行形态，不暴露本机用户数据路径。

## 8. 站点健康与诊断报告

- 左侧工作区的「站点状态」标签页（命令 `open-site-health`，`Alt+H`）做只读健康检查：**只调 `state`、`diagnose` 等只读契约，不开菜单、不切档、不写输入框、不触发发送**。
- `diagnose()` 每条检查必须带 `kind`（`shared/site-health.ts` 的 `SiteCheckKind`）：`reach`（到不到得了站点）/ `control`（关键控件在不在）/ `tier`（当前档位读不读得出）/ `probe` / `capture`（会话页上第 ① 级采集选择器能否定位末条提问与回答根，见 docs/adapters.md「定位分级」）。缺省与未知值一律按 `control` 处理（fail-loud），漏标一处只会被归成 `control` 继续误报。
- **只有 `tier`、`capture` 之外的红项决定站点可用性**（`checks.filter(check => !isAdvisoryCheck(check))`）。各站 `state()` 是刻意的偏函数：用户停在非预设的合法档位时可能返回 null，那不是故障；部分组合会被粗判归入 think/fast，精确边界见各站卡。`tier` 红项仍在详情页以提示显示。`capture` 红只说明提问历史副本的选择器漂移，群发照常可用，同样只提示。
- 判定口径：只有站点给出明确登录证据才说「需要登录」，无法可靠判断一律「无法确认」，不拿 URL 或页面外观猜。单站正在发送或重载会破坏当前任务时禁用「重新加载」并说明原因。
- **可复制诊断报告**（`shared/site-report.ts` 的 `buildSiteReport`）是切除扩展后唯一的结构化报障入口，**不得只可见不可复制**。内容边界：版本 / 发行形态 / 平台 / 显示缩放、每站的 `phase`+`code`+健康结论+`checkedAt`、每条 check 的 `{name, kind, ok}`、白名单进程类别/退出原因/数值错误码，以及每站 `capture-locate selector=… semantic=… anchor=…`、`capture-reason …=数字` 与 `capture-slow-observer N` 行。原因仅取 `CAPTURE_REASONS` 固定枚举；卡顿数为 historyTurn 单次超过 250ms 的 MutationObserver 回调次数。三类均为主进程内存计数，经 `polyask:capture-locate-counts` 读取，只认白名单枚举键与正安全整数，读取失败仅省略该行。**绝不包含对话内容、URL、账号、路径、token 或消息 key**——`check.name` 是本地化的 `diag_*` 词条不是页面文本，站点只写 key 与产品名不写 host。Drive 连接诊断另在设置页，同样走负向泄漏约束的白名单快照。
- 报告头部的 `proxy mode=…` 一行只含代理模式、协议、是否带认证、密码状态、是否跟随、应用结果、挂起、待确认与存储状态这些枚举和布尔值，不含主机、端口、用户名或绕过列表，格式见 §13「诊断」。

## 9. 源码文本守卫的明文规则

`desktop/test/` 里有一批测试不执行代码，而是读源码文本做正则断言（`shell-contract.test.ts` 最集中，另有 `status-copy-coverage`、`sync-reasons-coverage`、`site-navigation-escape`、`view-visibility`、`ui-guidelines` 等）。它们守的是「运行时验证成本过高、但改错了会静默出事」的不变量。

- **什么时候允许写**：① 断言的是**缺席**（某个危险 API 没被用上，如 `forcefullyCrashRenderer`、`location.reload`）；② 真实验证需要跑起 Electron 或真机，而 CI 的离线单测跑不到；③ 两份清单必须对齐而没有共同的运行时表达（如码表双向对账）。**能用真实调用断言行为的，一律写真实测试**，别用文本匹配替代。
- **一律走 `desktop/test/fixtures.ts` 的 `readSource(相对 desktop/ 的路径)`**。它以模块位置解析路径，守卫测试从任何 cwd 跑结果一致；**别用 cwd 相对路径的 `readFileSync`**，也别自己拼 `__dirname`。
- **断言要指名文件与原因**：测试名说清守的是哪条不变量，断言失败信息里要能看出「为什么这段文本不能没有」。只写 `assert.match(src, /foo/)` 而不解释，下一个人读不出该修代码还是该改断言。
- **别把断言钉死在可自由重构的字面量上**。反例参考：`status-copy-coverage.test.ts` 的产出方清单是**从 `site.ts` 的 require 列表现读**的，运行时文件搬家不用改测试；同时它带 `assert.ok(requires.length >= 5)` 与 `produced.size >= 10` 两条**自校验**，正则失效时先红在「抽取坏了」而不是假绿放行。新写的守卫照此办理：只要断言依赖某个正则抽取，就配一条「抽到的条目数不能塌成 0」的下限断言。
- 例外要**在代码里登记理由**，不要靠注释外的默契：`PRODUCED_WITHOUT_COPY` / `COPY_WITHOUT_PRODUCER` 每条都写明为什么豁免，且反向断言「豁免项现在若已有产出方就必须摘掉」。

## 10. 仍成立的设计决策

- **真实页面优先**：所有辅助界面服务于站点页面，不建立持续占宽的信息栏；应用身份由系统标题栏、任务栏/Dock 与应用菜单承担，不在高密度命令栏重复放品牌。
- **一个动作，一份定义**：命令、快捷键、菜单项与可访问名称共用同一注册表（`shared/commands.ts`）。加动作先进注册表，不在某一处单开分支。
- **状态不冒进**：`submitted` 只证明提问已提交，不能证明回答已生成完。没有可靠证据时只说「已发送」。生成态钩子 `generation()` 返回 `"idle" | "generating" | "complete" | null`，`null` = 无法可靠判断，界面停在「已发送」；探针层（`generation.js` 的 `generationProbe`）另有 `complete_observed`：本次提交后亲眼见过停止键、且 `answer()` 是提交前基线之外的新节点，监控据此接受未在 900ms 采样里见到 generating 的短回答完成；**不得靠「文字一段时间没变」推断完成**；钩子保持同步只读。
- **不中断运行**：切页签、聚焦站点、开关面板、打开命令面板都不重载站点、不终止生成。后台站点完成或失败时不自动切页、不抢焦点。
- **职责边界**：左侧工作区管选站/预设/分组/健康与单站检查重载；设置页管 Drive、显示与数据设置、连接诊断、更新检查；命令面板只搜索并执行已有命令，不承载长期状态；页签只表达后台分页的发送/生成/完成/失败，不自动切页。新信息没有明确归属时**默认不进左侧工作区**。
- 按需指南复用 `commands` 全页表面（`guide` 模式），从更多菜单或命令面板的 `open-getting-started` 打开；只解释并调用已有选站、诊断、聚焦输入与采集比较命令，不自动发送、不改默认选站、不写完成状态。关闭复用回到站点路径，指南内容独立滚动，不增加站点阅读时的常驻占位。
- **允许 0–9 个任意站点组合**，别假设用户总选 9 个。选择变化、切分组不得销毁仍被选择的站点视图；「新建会话」会丢站点页面里的未保存内容，执行前必须确认。
- **已选站点的数组顺序就是排列与分页顺序**：`workspace.selectedSites`、分组的 `sites` 及 Drive 分组的 `hosts` 均保留输入顺序，不再按站点表重排。选择面板先列已选项，拖动手柄提交一次最终顺序，也可用上下移按钮或聚焦手柄后按 ↑/↓；取消勾选保留其余顺序，重新勾选追加末尾，范围预设保留仍在范围内的顺序。主进程沿数组顺序创建新视图，页面仍并行加载；已有页面排序不重建、不重载。聚焦模式保留切主站的槽位交换，选择未变化时不重置槽位顺序。
- **本地数据层不引原生第三方依赖**（用 Electron 自带的 `node:sqlite`），降低三平台打包差异；OAuth refresh token 只经 `safeStorage` 持久化，Linux 后端不可用时只留进程内令牌并明确说明重启后需重新连接。
- OAuth 回环收到匹配 state 的授权响应后，返回本地生成的单语明暗卡片，语言经 `resolveLocale(app.getLocale())` 选择；收到授权与拒绝分开呈现。只报告授权响应已收到，令牌交换、保存与 Drive 验证仍由应用完成；页面不展示回调参数，不加载外部资源，不引入唤回协议。
- **不以技术绕过登录限制**：不改 User-Agent、不关 `webSecurity`、不复制浏览器 Cookie、不注入凭据。浏览器能登录而应用不能时，按嵌入式环境兼容问题保留诊断证据，不宣称已修复。
- **生产包不留远程调试开关**，测试不依赖对外开放的调试端口；稳定性观测走 `app.getAppMetrics()` 周期采样加 `render-process-gone` / `unresponsive` / 加载失败事件（`main/runtime-gates.ts`，由环境变量 `POLYASK_SOAK_REPORT` / `POLYASK_DIAGNOSTICS_FILE` 一次性开启）。
- **可访问性是功能要求不是装饰**：键盘焦点、读屏播报、高对比度、reduced motion、中文输入法合成态，与布局同级。仅用键盘要能完成群发、取消、回到提问框、换主站、换站点页与重载。

## 11. 行数门禁

- `desktop/src/site-runtime/*.js` 与根 `scripts/*.js`：**单文件 ≤300 行**。
- `desktop/src/**/*.ts|tsx`：**单文件 ≤400 行**，三个越界文件走棘轮（只许降不许升，基线写死在 `scripts/verify.sh`，要上调必须同一 commit 改基线并写明理由）；豁免只有 `shared/copy.ts` 一条，且不用通配——通配会让日后新建的文件自动逃逸。
- 动手前先 `wc -l`，别凭记忆行数；要加行按职责拆分，不靠压行或删注释续命。

## 12. 开发命令

```bash
cd desktop
npm ci
npm test          # 类型检查 + test/**/*.test.ts(x) + scripts/*.test.{js,mjs}
npm run typecheck # 与 npm test 首段的 tsc --noEmit 重叠；CI 单独再跑一遍是刻意的双保险
npm start
npm run package
npm run make
npm run smoke
npm run soak -- --minutes=60
```

根 `bash scripts/verify.sh` 跑跨端项（语法、JSON、行数门禁、OAuth 卫生、文档与测试登记、workflow YAML、5 个跨端测试）；两条都要跑。开发用 OAuth 凭据的配置见 `docs/desktop-oauth-security.md`。

### 提问库变量模板

内置任务模板和自存模板通过 `{{变量名}}` 标记填写位置（1–40 个非花括号/换行字符）。变量去重、值按字面一次替换，不递归展开；全部填写且展开后不超过既有 100,000 字符才可填入。模板文本继续使用既有 text 字段同步，内置模板不写库，填写值仅驻留编辑器内存。选择或取消不改草稿；显式填入复用 onInsertPrompt，只改草稿，不改站点、档位或发送状态。

普通模板、内置模板、变量展开和最近提问使用统一替换保护：非空且不同的草稿须明确确认，取消保留原文。保存模板等待异步结果，失败保留名称并允许修正重试。提问框粘贴与拖入图片按输入顺序追加，合计数量和字节沿用共享限额；超限或读取失败保留原附件，显式更换、移除、清空与失效会阻止旧读取回写。提问框与命令面板同时尊重组合态和 229 键码。

综合/追问完整表单由 `synthesis-draft.ts` 按来源及追问站点保存在当前会话内存，不新增持久化或同步键。发送前先恢复非零站点视口；失败底栏动作只返回原编辑器，不自动重发。成功仅移除本次发送版本的草稿，保留在途期间的新编辑；来源原文比较基线跨卸载保留，恢复时明确提示来源变化并继续逐字校验摘录。本机重置清空草稿并使迟到的恢复动作失效。

### 单站摘录追问

辅助请求可带 excerpt，仅此模式允许一份来源。主进程在导航前验证逐字摘录属于选中的保存原文、追问非空、单一来源及完整载荷 ≤60,000 字符；目标仍须在当前选择范围。载荷使用原始 text（不是 task 标题）、固定来源编号和有围栏的摘录，标注仅为部分证据。普通综合仍要求两份回答。

追问复用单站导航/发送、互斥与取消及综合采集/替换确认，不新增自动重试。保存结构不变：追问问题保存在 synthesis.instruction，摘录不单独存储；完整发送载荷沿用提问历史。保存区统一称“补充分析”，可查看当时要求、目标、档位与时间；旧记录缺少发送证据则明确未知。提交、取回和保存分别呈现，不把发送成功当作已保存；保存后明确进入该结果的阅读面。此版本不提供追问树或多份分析历史。

摘录只直接接受同一文本节点内唯一的原文字面片段；跨格式、重复或图形选择先打开已保存 Markdown 原文，由用户选择连续范围并确认。HTML textarea 的 LF 选区回映到原始 CRLF/CR 的 UTF-16 偏移，拒绝拆开代理对、空范围和身份/版本变化。摘录导航在来源读取前后都检查未保存编辑；确认等待结束后重新读取来源，重读期间新稿仍需另行确认，最终检查与导航之间不跨异步等待。导航与发送前重新核对保存来源，辅助发送可带临时 `sourceUpdatedAt`，导航后派发前再次检查，变化返回 `source_changed`，不发送旧材料。超过决策证据的 4,000 码点仍可追问，不截断正文；替换已有追问摘录先逐字展示旧新内容并确认。

比较可就地展开；进入比较时详情容器宽度 ≤760px 自动复用专注阅读，返回浏览和单纯缩放不重复触发。进入、展开和返回沿用未保存备注的导航保护。原文、两列比较及补充分析仅挂载当前面；各面和每个来源的阅读位置在会话内保留，换记录或明确新导航使旧上下文失效。人工对照按结论/依据/条件/成本保存会话内笔记和逐字来源，变化的来源需重新核对，笔记仍保留；形成决策仅填入草稿，用户明确保存才写库，不把字面相同或人工共识标为事实。

阅读来源导航按已保存的 `winnerHost` 显示最佳回答星标，常驻 12px 星标位置，标记、改选及取消不改变导航尺寸。保留原编号、站名及锚点，可访问名称补充三语“最佳回答”。标记、改选或取消均沿用现有保存流程，等待和失败不改变原星标；不新增持久化字段、不自动跳转，也不将人工选择标为当前阅读位置或核验结论。

结果列表标题最多显示两行，裁切必须落在标题自身，不能依赖列表直属按钮的旧选择器；来源、时间和标签按各自行排布，完整标题仍保存在提示与详情中。比较块以间距组织，不逐块附加横线；原文 Markdown 分隔线、表格边界和共有段落标记保留，不改变比较内容或存储数据。

结果详情的问题标题按实际排版判断三行溢出，默认收起并复用原问题展开/收起词条；保留 h1 与完整原文，展开状态仅留在当前阅读会话。进入综合或追问编辑器的显式已放行操作聚焦表单标题，关闭后恢复对应入口及阅读位置；后台恢复请求和编辑更新不抢焦点，不写入数据或同步字段。

取消新建决策卡并确认放弃后，返回创建前的来源阅读/比较模式、展开与滚动位置，并恢复本次创建入口焦点；已有卡片取消编辑仍回只读面。入口归属随创建意图透传，不在异步核对完成时重新猜测当前焦点；同一综合任务的导航仅在阅读会话中消费一次，重挂不覆盖用户后来选择的阅读面。备注、文件夹创建/关联、决策保存失败后，控件重新启用且焦点仍因本次禁用落在 BODY 时恢复原控件；等待期间的主动聚焦、键盘、指针或窗口失焦会取消恢复。均不新增持久化键。

结果库错误按采集/加载来源保存，显示时使用当前语言文案。采集失败仅在用户明确点重试时复用现有采集及互斥入口，后台列表成功或失败回包不覆盖该错误；加载错误的恢复仍刷新列表。重试开始及成功采集清理原错误，重复点击和卸载沿用既有保护，不增加站点发送或自动采集。

比较栏最大高度按正文栏起点相对详情滚动内容的位置计算，扣除底部16px余量并保底160px。正文栏前的来源选择器计入占用；外层滚动不改变高度，窗口、字体或上方布局变化才重测。短视口仍允许外层滚动，独立/比例同步滚动、来源选择及有效位置记忆保留。工具行的人工比较按钮复用现有表单，点击后展开并聚焦其summary；离开或换记录取消迟到定位。

阅读面的当前来源以吸顶导航底部下方1px为判定线，选择最后一个顶部已越线的回答；有实际滚动范围且已向下滚到底时优先归末来源，容忍1px舍入，短末条标题未越线也适用。无滚动范围或初始未滚动时不因到底判定跳到末来源。链接用aria-current=location与下划线表达，与winnerHost及最佳星标独立，不写库或会话字段。滚动/尺寸变化经单帧合并，只在位置变化时更新；返回阅读后按父级恢复的位置再次测量，切面、换记录及卸载清理监听和排队帧，不抢焦点或滚动导航。

### 独立决策卡数据契约

- 编辑器按字段显示必填、长度、定稿结论和摘录校验错误，字符计数按 Unicode 码点计算；保存时聚焦首个错误，修改后即时更新提示，保存失败保留输入。来源未加载时只允许同一结果记录中未修改的已存摘录；客户端提示不替代主进程的原文核对。

- `shared/decision.ts`：DecisionRecord schema 2；标题≤160，结论/理由/待核实/下一步各≤4,000，证据≤9份、resultIndex唯一且0–8、逐字摘录≤4,000。每卡只有一个 archiveId，更新不可改来源；多张卡可引用同条结果。来源显示标题快照≤320、host/label≤256、id/deviceId≤128，均按码点；时间为非负安全整数。
- 状态只允许 `draft` / `verify` / `final`；`final` 必须有非空结论。标题与 archiveId 必填，证据摘录不能为空；`updatedAt` 不得早于 `createdAt`。
- 证据只由主进程从保存原文核对并补入 host/label/capturedAt。删除来源后保持独立卡片与原摘录；来源查不到时文案同时说明可能尚未同步，不把“未找到”武断视为已删除。可以修改决策正文和移除证据，不能伪造缺失来源的新摘录。所有删除/清空来源的确认提示说明摘录保留。
- 新实体 `decision:<id>` 独立 outbox；import 按 updatedAt/deletedAt 与 deviceId 整卡合并，版本与设备完全相同的 tombstone 优先。更新和删除时间单调增加；本机重置删除 decisions 表内容，保留 deviceId，断开 Drive 后执行。
- 旧客户端读取远端 decision schema 2 会沿用 future-schema 保护停止上传；新版若发现先前跳过的可支持格式则全扫补拉。已有只读锁只能在该文件成功导入或 listing+changes 确认其已删除时清除；文件损坏/下载解析失败不能解锁。持续存在的不支持 state schema 2 会保持只读并重复扫描，正常 decision 补拉后恢复增量。

### 任务文件夹契约

- 文件夹为单层，多对多关联结果和决策卡；不复制内容、不自动带入来源。名称去首尾空白，1–80 个 Unicode 码点，禁止控制字符；同名允许，id 区分。结果库采用目录优先的文件夹导航＋混合列表＋阅读详情，宽窗前两列为 184/280 CSS px。普通阅读的整理与更多动作并入记录标题，比较上下文收起时仍可操作；主工具栏保持单行；窄窗口先收起文件夹，专注阅读临时隐藏导航和列表，不持久化。结果详情分阅读、对比和综合结果，阅读切换与来源导航共同吸顶，比较根据详情容器宽度收为单列。来源标题旁集中“导出 .md”“标为最佳”和“追问”，窄容器允许换行；正文首尾不额外叠加段落间距，保留内容内部节奏。标签备注集中到可收起的整理面板，显式保存；收起保留唯一编辑器和未保存导航保护，取消离开重新打开原字段。文件夹归类独立保存，同记录归类不经放弃草稿导航或卸载编辑器；外部 Markdown 链接只经 shell 的可信打开通道。
- 标签按中英文逗号拆分并去首尾空白，原始非空数组最多 20 项、每项最多 32 码点，不先去重绕过服务上限；编辑器显示逐项计数、具体错误和失败保稿。归档弹框复述完整对象类型与标题，空态可就地创建合法文件夹，创建成功仅选中，最终保存才写关联；取消关联保留已创建文件夹。创建后使旧列表读取失效并重新刷新，不能被迟到空快照覆盖。
- `shared/task-folder.ts` 定义 schema 3 的 folder / folderMembership。folderId / targetId / deviceId 不超过 128 个 UTF-16 代码单元（`String.length`，不同于名称的码点计数）且不得含控制字符；关联以 folderId 长度前缀、targetKind 和 targetId 生成确定性 id，复合关联 id 不套 128 限额；每条关联独立版本，renderer 仅提交本次多选的差异，避免覆盖别的设备新增关联。
- 文件夹删除为终态，迟到的重命名不复活。关联按版本时间/deviceId 合并，同版本删除优先；可显式重新加入仍存在的文件夹。删除文件夹及本机已知关联写 tombstone＋outbox，保留结果、决策卡与其他文件夹关联。未知/已删除目标不展示；乱序到达的关联仍保留，待文件夹和目标拉到再显示。
- Drive 新实体文件名和元数据 id 使用正文 id 的 SHA-256，拉取校验哈希后按原 id 建索引；不放标题和摘录，避免复合或 Unicode id 超出 Drive 属性长度。schema 1/2 冻结 fixture 不改，新增 schema 3 样本。
- 数据迁移新增两表与索引，清空文件夹保留内容，清空结果或卡片保留文件夹。本机重置清两表，仍先断开 Drive 并保留 deviceId。文件夹界面与多选对话框不新增持久 UI 设置。
- UI 搜索覆盖正文和摘录；编辑为显式保存，失败保留内存草稿。工作区切换和全局命令经过未保存确认；确认默认取消、Escape关闭、焦点圈定。应用异常退出不承诺恢复尚未保存的编辑。导出为单卡 Markdown，不等同于可恢复备份。
- 混合列表搜索仍查询全部记录，前端稳定排序并每页显示至多 100 条，明确总数和范围，键盘可到最后一条。多选以 `kind:id` 区分对象，当前页选择与跨页数量可见；批量加入文件夹只添加关联，收藏仅对结果。加入文件夹及收藏沿用已有单目标 IPC 串行处理，停止后等待当前请求结算、不启动下一项，部分失败可人工只重试失败项；Markdown 混合导出改用下述专用面板与主进程文件服务，不产生缺项文件。第一项 IPC 前阻断父导航，卸载后不继续发起任务。
- 筛选后的选中记录仍匹配时保留阅读，最新回包排除记录时也须经过当时的未保存确认；发起新的导航意图即作废旧回包，确认时再核对请求、意图及选择。会话内只保存筛选、排序、页码、列表滚动和阅读标识，不缓存全部正文或持久化多选；返回重新取最新记录，删除、明确导航及本机重置不复活旧阅读。

### 业务备份与恢复契约

- 用户导出经 `BackupService.exportFile` 生成单文件 `.polyask` v4，包含有效 history/archive/decision/folder/folderMembership/template/group/workspace/question/questionAnswer/questionAttachments/preference/draft 及提问原图；不包含凭据、Cookie、设备身份、同步游标、outbox、本机图片同步开关或确认记录。不导入删除指令。旧 v1–3 JSON 继续按 32 MiB / 20,000 条读取；内部 `export()` 保留 v3 元数据接口供兼容测试，生产 IPC 不再使用它直接写文件。
- **v4 字节格式固定**：17 字节 ASCII magic `POLYASK-BACKUP-4\n`（末尾是真实 LF），随后 4 字节 unsigned big-endian 清单字节数、UTF-8 JSON 清单，最后按清单顺序串接 raw binary。无压缩、无新增依赖。清单字段为 `{format:"polyask-backup",version:4,exportedAt,entries,payloads,omissions}`；每个 payload 为 `{key,setId,index,size,sha256}`，key 必须严格等于顺序生成的 `images/0.bin`、`images/1.bin` 等。附件条目保留 schema 5 的 ID/questionId/createdAt/updatedAt/images 元数据，剥掉 deviceId/base64；每个原图对应一个 payload。文件总计 ≤512 MiB、清单 ≤32 MiB、业务条目与图片 payload 合计 ≤20,000；每提问仍最多 4 张 PNG/JPEG、合计 10 MiB。
- `backup-container.ts` 仅以 64 KiB 分块读写，内存最多持有清单元数据及单个附件集（≤10 MiB）的原始数据/转换副本。导出先完整性预检、再逐集严格读取 BLOB、写同目录 0600 临时文件，fsync 后在最终 intent 检查与同步 rename 间不让出执行；失败保留已有目标文件。`QuestionAttachmentRepository.readBytes` 是严格的单集 binary 接口，不投影整库 base64。导入先读有界清单，在受管临时目录用生成的数字文件名暂存；不从备份路径解压，不使用图片名当路径。预览之前核对类型、哈希、长度、总量、重复、路径、截断、尾随数据、父提问数量/创建时间与依赖。
- 缺图结果逐提问返回标题、应有数量及可知原图名称，未知名称只显示数量，不编造文件名。用户可取消、明确补下载或仅导出文字；未连接或须重新授权时引导至 Drive 连接设置，原图同步关闭时引导至图片同步设置，保留当前缺图任务，条件满足后才显示补下载入口。完成或取消后回到备份入口，下载失败或仍有缺图时恢复下载按钮焦点；等待期间主动移开焦点则保留新焦点。补下载调用现有 `fetchQuestionAttachments`，不自动打开同步，返回 true 后仍重新核对本机完整集合。仅文字 v4 省略全部原图，`omissions` 按提问记录 `{questionId,count,images}`（images 是已知完整元数据或空数组）；完整附件与 omissions 不可重叠，所有正图片数父项须被其中之一覆盖。成功反馈区分仅文字，导入预览显示省略提示。
- 预览只向 renderer 返回业务/图片元数据和省略清单，不含 BLOB/base64、内部 payload 文件引用或 staging 路径。预览会话持有 staging，15 分钟过期；取消、换预览、错误、快照失效、reset、IPC dispose/正常退出均清理。只删除本任务生成的 staging/临时文件，绝不删除用户选中的原备份；异常断电/强杀不承诺执行退出清理。所有异步边界核对 service intent 与 question lifecycle，重置前断开入口立即作废会话，迟到下载/读取不能发布预览或替换导出文件。
- 格式冻结样本 `desktop/test/fixtures/backup-format1.json` 覆盖八类业务数据；它独立于 Drive schema 1/2/3。偏好恢复写入使用当前设备身份和递增版本；草稿恢复为稳定独立备份分支，不进入本机正在编辑的分支。保留本机 deviceId，不从备份接收设备身份。
- 原生文件选择仅在主进程进行，可信 shell IPC 不接受渲染层路径；读取限制实际字节数，导出先写同目录临时文件再替换。预览只返回文件名，错误只返回机器码。
- 预览不写库，冲突默认本机、删除默认跳过；最终显式确认选择。token 绑定全业务快照，期间本机编辑或同步变化使预览失效，必须重新导入。所有写入与 outbox 同一事务，失败全回滚；保留本机与内容相同条目不写入。
- 文件夹删除为终态，明确恢复使用派生新身份并映射所选关联；重复导入复用已恢复文件夹，不覆盖后续编辑，也不复活再次删除的派生文件夹。缺失依赖的关联在预览提示并跳过，不能隐式恢复未选择的内容。
- 界面采用集中列表、双版本比较、分段冲突按钮和最终汇总；应用期间阻止重复点击及导航，取消释放预览。确认导入按现有 Drive 机制传播，不新增同步线格式或持久化键。
- 核对显示业务枚举、布尔值及本地时间，未知枚举保留原值，冲突默认突出变化字段，可展开完整版本及原始业务数据。依赖按名称定位并显式加入，已删除对象不自动勾选；决策卡的来源缺失为可选提醒。批量仅作用于当前类型/状态筛选中的新增或冲突条目，最终确认保留条数、跳过原因和同步影响。
- `backup-selection-preview` 为受信 shell 的只读 IPC，校验原有 token、指纹及所选键，与 apply 共用 `backup-restore-plan.ts` 的恢复/跳过规划。预览令牌固定未封存回答的业务封存时钟，版本时间仍取实际写入时刻；计算期间或错误时禁用确认，迟到的旧选择回包不能覆盖新计数。不修改恢复事务、备份线格式、数据库或同步键。

### 资源观察边界

- `runtime-process-diagnostics.ts` 在运行期监听 `app.child-process-gone`，忽略正常退出及未知枚举；按白名单进程类别最多保留七条最新故障，仅含类别、退出原因与有效数值错误码。窗口释放时清理监听和内存；不保存进程名、服务名、PID、路径或正文。可信 shell 的 `getRuntimeProcessFailures` 仅在复制 Alt+H 报告时读取，不改变站点健康结论，也不推断进程已恢复。显式 soak 才另写入对应 `child-process-gone` 事件并计为稳定性失败。

- `POLYASK_RESOURCE_TRACE` 显式指向尚不存在的本地 JSONL 文件时，外壳就绪后每 5 秒记录一次进程资源及窗口状态，最长 30 分钟。普通运行不建文件、不挂监听、不采样；失败、背压、窗口关闭均停止并清理。它不自动退出应用、不调整节流，也不取代 Alt+H 的站点诊断报告。
- 资源记录只含运行时版本/GPU 功能状态、窗口可见/最小化/聚焦状态、当前页、站点键/加载/节流状态，以及 PID/创建时间/CPU/工作集。只关联站点主帧 PID；子帧、worker 和其他未归属进程保留为未归属，不推算每站完整成本。同一 PID 多站共享时只记录一笔进程资源，工作集仍不是独占物理内存；新进程首笔 CPU 标为无有效间隔。不记录网址、正文、标题、账号或 IPC 载荷。
- `POLYASK_SOAK_REPORT` 显式启用时，runtime-gates 才累计稳定性事件并采样 `app.getAppMetrics()`；普通运行不保留无消费者的事件数组。站点状态反馈及诊断快照独立于该记录器。
- soak 第一笔发生在启动期间，CPU 初次读取为零，不代表空闲；后续样本为两次读取之间的用量。各进程工作集相加不是去重后的独占物理内存，启动期增长不能直接判定为泄漏。
- 已打开站点保留页面会话，不参与群发不回收；明确关闭且监控/采集具备结束证据后事件触发回收。监控连续 5 次读不到状态或到达 45 秒／15 分钟观察上限时显示 `generation_unconfirmed`。采集一侧以完整封存、冻结结束或固定 15 分钟观察预算到期为观察结束；生成一侧须监控也已停下（读不到、到达上限或收口），「提交未确认」本就不开监控，采集结束即可（`site-page-protection.ts`）。两侧都结束后明确关闭不再报 `generation_pending`，已关闭的页面随即回收；任一侧仍在观察时保留页面，以免关闭可能仍在生成的回答。已打开站点休眠及新的后台可见性策略尚未实施，需单独决策与真机验证。

### 提问历史存储与同步基础

历史原图查看器默认适应窗口，支持切换至 100% 原始尺寸并在图片区域滚动；标题显示文件名和顺序号。Tab 保留在查看器内，Escape 关闭后返回原缩略图；不提供连续缩放或前后切图。

逐次提问采用独立 `question` 和 `questionAnswer`（每站每次尝试）schema 4，SQLite version 5 保留 questions/question_answers 并新增原图存储。相同文字不同发送不合并，重试保留独立尝试；自动副本上限 200,000 码点，不改变手动采集上限。父子删除为终态 tombstone + outbox，迟到子记录遇已删除父立即转为 tombstone；本机重置清新两表且保留 deviceId。旧文字 history 仍为 schema 1。

每条提问最多一份不可变原图集：`shared/question-attachments.ts` 的 `QUESTION_ATTACHMENTS_SCHEMA = 5` 定义身份、元数据及独立 JSON/base64 线格式，提问/回答仍为 schema 4。ID 是 `SHA256(JSON.stringify(['questionAttachments', questionId]))`。SQLite `question_attachment_sets` 仅存身份、图片名称/类型/字节数/SHA-256；`question_attachment_items` 按 set_id/image_index 存原始 BLOB，保留顺序、重复、字节与 EXIF，无全局去重。最多 4 张 PNG/JPEG，合计 10 MiB，名称限 128 码点且仅接受叶文件名。`get`/`forQuestion`/`all` 不读 BLOB；`readImage`/`readAll`/备份用 `readBytes` 需要活动父提问，并核对图片数量、创建时间、MIME 签名与哈希；`project` 允许同步中的孤立子记录，但存在父记录时仍核对归属。损坏或缺失原图抛错，不降级为空数组；同版本、同不可变元数据且字节校验通过的 wire 可修复本机 BLOB。

`history.begin` 先提交提问和本次尝试，再独立保存原图；附件事务失败不撤销文字记录、token 或发送流程。保存失败通过 `onAttachmentSaveFailure` / `setAttachmentSaveFailureHandler` 单独回报，不触发文字历史失败状态；外壳通过独立原图保存失败事件提示。同 run 重试共享原图集，只有与最初请求图片完全相同的重试才能补存此前失败的附件，新 run 使用新身份。保存消耗现有 prepareRun 的绝对截止时间，不重开 44s/90s 预算。父/附件删除同事务写终态墓碑和 outbox，并移除 BLOB；迟到活附件遇父/附件墓碑不能复活。重置先清两张原图表，再清其它本机数据和 meta，仅保留 deviceId；不执行附件墓碑定期回收。

原图 outbox kind 为 `questionAttachments`，`SyncRepository.questionAttachments(id)` 提供严格 schema 5 投影。`questionImageSyncEnabled`（默认 false）和 `questionImageSyncAcknowledged`（首次确认开启置 true，关闭不撤销）仅存 SQLite meta，不进入同步偏好、state fragment 或业务备份；重置清除两键。设置开启须确认原图、文件名、EXIF、本机与 Drive 空间及全部设备升级影响；旧客户端遇 schema 5 后全局停止上传。`sync-images` 受信 IPC 只接收 boolean 和开启确认，`SyncStatus.imageSyncEnabled` 连接实际历史界面。

队列 ready/nextAt/pending 使用同一资格谓词；SQLite 惰性游标先筛选后截 100 条，不把整库 outbox 加载到内存。关闭时保留 live 图片队列但不计待同步、不安排空转；live 子集要求活动父提问已有远端索引且父 outbox 已清空，因此父失败退避及分页均不能绕过父优先。纯本机附件墓碑在本机从未确认开启且没有对应远端索引证据时保留本机；一旦确认开启或取得远端证据即可上传，父 schema 4 墓碑始终照常传输。

Drive 附件文件固定命名 `questionAttachments-<SHA256(body.id)>.json`，appProperties 只有 app/schema/kind/哈希 id/deleted；名称、原父 ID、EXIF 和 base64 仅在正文。下载按 10 MiB 的 base64 展开加 64 KiB 封装余量限制流字节，再验证正文、哈希、MIME 和不可变身份。沿用既有大正文 resumable 会话上传：失败整集重试，不承诺字节级续传。关闭期间只索引 live 元数据，已验证的墓碑仍可下行；未验证索引不能删除重复 live 文件。启用后重放此前跳过或失败的文件，不依赖已推进的 changes token；升级可据 schema 5 元数据解除旧锁，已知 schema 6 锁仍保留。附件 payload/网络失败隔离，其它记录继续；账号鉴权与配额仍沿用全局失败语义。

`SyncImages` 对图片请求单独持有 AbortController 和 generation，关闭立即取消图片请求而不打断文字同步；手动同步忙碌期间设置关闭仍可用。每次网络返回后检查 signal、仓库 lifecycle 及当前父状态，父墓碑终态，重置/断开后迟到下载不能恢复原图。受信 `question-fetch-attachments` 仅接收提问 ID，`fetchQuestionAttachments(id): Promise<boolean>` 不要求已有同步轮次，但与常规同步共用串行队列；排队时捕获图片 generation 和仓库 lifecycle，关闭再开启、断开或重置会作废旧请求，关闭操作本身不排队。匹配目标的未来版本元数据直接建立全局只读锁，不下载未知正文；显式读取发现的未来正文同样保留锁。禁用/断开/父缺失或删除/附件墓碑返回 false，绝不自动开启开关。成功表示本机完整集合可用，可修复同版本损坏 BLOB；读取失败供界面重试。业务备份通过 v4 二进制容器包含原图，读取旧 v1–3 JSON 时不声称含原图；格式、缺图选择与 staging 生命周期见「业务备份与恢复契约」。

Drive 提问、回答及原图文件名/属性 ID 使用正文 ID 的 SHA-256，不带正文或会话 URL；最高支持 schema 5，旧实体保持原格式。业务备份导出 version 4、兼容读取 version 1–3；附件与选中的父提问、回答及 outbox 同事务恢复，按单集从 staging 严格读取；缺父依赖不能静默恢复。v4 含附件的提问遇原父/子墓碑时使用固定 seed `['question-originals', questionId, createdAt]` 派生新提问 ID，附件 ID 重新由新 questionId 确定；seed 不依赖所选子项或后续墓碑版本。分次选择原图复用该新身份，映射后的父或附件再次删除则保持终态，不再造第三身份。v1–3 和不含附件的旧恢复路径保留既有父墓碑/所选回答墓碑规则；此新 seed 规则只适用于含附件的 v4。备份不恢复图片同步开关与首次确认状态。


提问历史 IPC 由 `question-history-ipc.ts` 注册并验证外壳身份；renderer 不接受任意导航地址，恢复只提交记录 ID / 尝试 ID，再用主进程生成的一次性预览令牌执行。实际导航前再次核对记录、站点选择及视图身份，受 OperationGate 保护；最多两站并发、单站 20s、总计 30s，缺地址不导航首页。快照轮询每 5s 启动，最多两个只读探针并发，探针 2.5s；提交成功或提交不确定的结果就绪后固定观察 15min，不依赖早期生成控件，后续进度不顺延；归属不明确时仅观察，不保存正文或地址。明确归属终止、取消或删除仍提前封存；未显示答案的记录可能等待完整观察期才标为未取得副本。切换会话前尽力在 2.5s 内保存：先等待在途采集；旧轮未覆盖的新 token 在同一剩余预算内补采，到期不阻塞导航。新会话与辅助综合导航目标站前同样先保存（`sessionHandoff`，总计 6s，与开新轮同口径等完成候选的静默复读，见预算表），再结束这些站的采集。中间副本入 outbox 延后 30s，封存或首次文本立即可上传。运行时不把停止键缺失或正文静止当完成证据，无法正向确认结束的副本保留“完成状态未知”。“完整回答”唯一来源是外壳 `GenerationMonitor` 的收口确认（`onComplete`，`view-manager.ts` 的 `onGenerationComplete` 由 `question-capture-binding.ts` 接到 `QuestionCaptureService.complete`）：只认同 runId 且本次尝试已回包的条目，确认后立即补读（在途轮结束后马上再读），确认之后开始的归属、未结束、非生成中、带正文且未截断的快照先记候选，候选回包 ≥3s（`SEAL_QUIET_MS`，`question-history-service.ts`）后才开始的另一次读读到逐字相同的正文才封存为 complete（增长否决，防元宝草稿隐藏停止键的误收口与停止键消失后的尾部续长；采集服务按 `sealDelay()` 提前排复读）；没带读序号的快照不算确认之后；封存后不再被追问、取消或后续快照改写。不新增持久化键、不改 schema。

右侧历史面板宽 360 CSS px，与左侧面板互斥。共享最小站点列宽决定窄窗全页；阅读副本/确认操作时原位置隐藏原生站点视图，保持挂载、正尺寸与既有禁用后台节流设置，退出恢复可见性（BrowserWindow 默认外壳不是可重排子视图）。历史卡片点击始终读取副本；恢复原站走独立按钮，忙碌时仅保留阅读和复制等只读操作。结果库 surface 会 detach 站点视图，因此其顶部入口仍在发送/辅助操作期间禁用并说明原因。列表只传摘要和尝试元数据，正文仅按选中尝试读取；旧文字历史独立查询分页，顶部提问库的最近文字行为保持不变。错误提示由三语 `question-copy.ts` 提供。

历史列表和详情的图片数量表示本次请求附图数量，不代表原图已保存、已同步或成功发送。详情先读取原图元数据，再按索引以最多两个并行读取加载原图缩略图；放大预览只使用受信 IPC 返回的 PNG/JPEG data URL，具备关闭、Escape、焦点圈及关闭后还原触发按钮焦点。缺失与读取失败均保留明确重试入口；后台原图到达后可点重试重新读元数据和图片，或重新打开详情。

再次提问经 `question-reask` 重新读取活提问，并严格读取 inputImageCount 对应的完整图片集；零图提问显式返回空数组。只将完整文字＋图片一次恢复到顶部草稿，不发送。缺失或损坏时保持草稿，只有明确选择“仅使用文字”并确认后才降级。已有文字或附件均须确认；旧文字历史也不能静默清除附件。异步读取与确认应用时同时核对 DraftRevision、图片选择意图序号及导航请求序号；输入同文、同数量换图、待处理选图、关闭/删除/切换/忙碌/重置及后续重问都会使旧请求失效。恢复图片通过替换控制器作废先前选图读取及原生文件选择框的意图 token，避免文件读取或原生选择事件迟到后覆盖草稿；打开文件选择框本身也会作废旧重问。

受信 `question-attachments`（只读元数据）、`question-attachment`（提问 ID＋索引）、`question-reask`（完整集合）拒绝未知/删除父记录及错误归属，不接受路径、URL 或 renderer 正文。错误以 `invalid_question` / `history_not_found` / `question_attachments_unavailable` 有限码返回；原图保存失败单独发 `question-attachment-save-failed`，不影响文字历史失败通道或发送。三语文案在 `question-attachment-copy.ts`；本机原图界面使用实际 `imageSyncEnabled`，开启后通过 `questionFetchAttachments` 提供显式补下载；成功刷新本机元数据和图片，后台到达仍通过重试或重开刷新。结果库仍仅保存提问文字和回答副本，原图留在提问历史，详情有明确说明。

历史与结果库共用 `markdown-it` 分词、React 白名单元素渲染，禁止原始 HTML；URL 显示投影不修改快照或完整目标。纯 URL 标签从文字、简单强调/行内代码格式及换行中识别，裸域名沿用 linkifier 的整串匹配，不要求显示地址与目标相等。空标签、超长 URL 标签及带文字定位片段的 URL 标签按实际目标显示域名＋有限路径，可展开并复制完整地址；有意义的标题及独立代码里的 URL 原样保留。详情只保留副本信息下的一条工具栏：左侧「在应用中打开」传当前回答 ID，旁边菜单不传回答 ID，恢复本次提问各站最新尝试的会话；保留既有导航预览与确认。复制链接、系统浏览器打开及复制回答均为图标，取当前站点/尝试的地址或正文；缺失/不安全地址禁用会话操作，无地址仍可复制已存正文。右侧再次提问填入原问题，更多菜单删除整条提问及副本，保留确认。群发忙碌时仍可阅读、复制与系统浏览器打开，禁用应用内恢复、再问及删除；切换站点/尝试关闭旧会话菜单，Escape 只关闭菜单并归还焦点，窄窗口按两组换行。图表、链接文案三语在 `reading-copy.ts`，历史操作在 `question-copy.ts`，均并入 `DesktopCopy`。

“保存并复制所选回答”（Alt+C）先采集并保存一次结果，再生成 Markdown 并写入剪贴板。后续复制失败时说明回答已保存，可在结果库重试复制；不再次采集或改变当前页面。详情复制、导出和来源链接失败分别说明对应动作，不误报为保存或加载结果库失败。加载成功后的空列表与详情欢迎区共用上下文指引：先考虑搜索或筛选，再考虑真实文件夹、决策卡类型或首次采集；“未归档”沿用采集或创建决策卡指引。

Mermaid 仅在需要预览时加载本地依赖，串行绘制、最多缓存 12 个结果，strict 安全级别与禁用 HTML 标签固定；回答配置指令不参与绘制。源码超过 20,000 字符、按换行/分号/`&` 保守计算超过 250 段（标签内也计数）、边数超过 200，或生成 SVG 超过 2 MB/视框超限时退回源码。复杂度在布局前检查，单行大量孤立节点也不能绕过；离开回答后尚未开始的任务跳过。生成图经本地 SVG 检查后作为 data 图片展示，外壳不插入原始图表 HTML；错误、源码缺失、超限明确提示，复制始终取原始源码。预览支持代码切换和 0.5–3 倍缩放，图表区域自行滚动。源码变更/组件卸载后迟到结果不覆盖新内容；旧副本中有 mermaid 围栏即可预览，已丢失源码的旧副本不会自动补采。新增依赖的兼容修补版本以 package/lock 的 overrides 固定（lodash-es、KaTeX），生产依赖审计须检查；不新增数据库键、同步 schema 或采集完成证据。

分页发送统计：`SiteStatus.submission` 是运行期发送结果（runId/state/code），仅群发入口赋值；生成态更新保留它，页面故障仍覆盖站点表头但不覆盖发送结果。新 run 清除上一轮计数，同 runId 子集重试保留未重试站结果。生成监控同理：`GenerationMonitor.begin` 遇同 runId 时把**被重试的站**重置为 submitted、清掉旧的生成证据，未重试站的条目保留（2026-10-04 起；旧逻辑跳过同 runId 条目，Windows 实测重试后 1.2s 即显示 complete）。已知残留：重试时上一轮的生成探测若仍在途，回来后仍会被新条目接收，条目没有身份标识。分页绿色计数表示已提交，不宣称回答完成；失败、提交未确认、取消分别显示，逐站生成态与警告进入共享悬停提示和无障碍名称。该字段不持久化、不进入同步。

整轮摘要另使用 `SiteStatus.generation` 的 runId/state 与每站最新保存尝试元数据，严格区分已提交、生成中及完整副本。`question-run-progress` 为受信只读 IPC/事件，SQL 仅取至多九站的 ID、状态、版本及正文是否存在，不加载正文/会话地址、不新增轮询；删除和重置也推送最新摘要。完整副本必须非空、未截断、采集 complete 且已封存；pending retry 不继承旧生成。推送优先于迟到 get、新轮/卸载/重置隔离旧回复。摘要放在已有 32px 底部状态条，读取按钮固定在进度区右端，提示切换不移动按钮；原生视图仍只预留该反馈高度；工具栏分页显示紧凑范围、完整站名提示及异常数量。阅读入口传准确提问/尝试 ID，只读已保存副本。

首次两站提示与自动引导已移除，命令面板的手动使用指南保留。旧指南字段仅作为本机界面设置兼容读取，生产界面不再触发相关导航或完成记录；成功本机全重置仍清除旧字段，SQLite/Drive/schema 不新增键。

代码围栏先显示原代码和语言，逐块复制保留制表符和末尾换行，按需开启有限高亮；未知语言仍可完整复制。数学先显示完整源码，用户预览才在本地单 Worker 中解析，750ms 超时、4,096 字符/32 层/256 次展开界限及 `trust:false`，结果只接受有限安全 MathML；失败、超限或不支持保持源码，忙碌可手动重试，旧来源/卸载后的回复不回写。块公式缺少闭合标记的扫描按解析 state、容器行偏移及结束范围复用未命中，包含 paragraph silent lookahead，避免反复遍历全文；代码围栏、链接标签、货币及未闭合显式标记保持字面。正文未变化的父重绘复用组件内解析结果，不建立无界跨记录缓存。

历史列表每 5s 重读至已加载尾部，反映新增、删除与回答保存进度；以可见记录为滚动锚点。列表或详情请求未结束时不叠加轮询；返回、关闭、切换或删除使旧详情回包失效。

历史首次打开在防抖等待及首轮读取期间显示“正在读取历史”，成功取得空结果后才显示没有记录；失败结束读取状态并保留重试入口。后续搜索仍防抖，已有非空列表在等待及读取期间保留，返回无匹配结果后再替换为无匹配提示。

历史正文区分加载、读取失败、记录缺失和没有副本，失败可重读当前尝试。当前会话内按提问/站点/尝试保留阅读位置；隐式记忆的尝试已删除时回到本站最新尝试，显式传入的尝试不存在则报缺失。长原问题先显示摘要，展开按钮与标题同行；复制原问题位于右侧主工具栏，以无障碍名与提示区别回答复制。菜单图标居中，删除分隔线仅出现在普通操作之后。保存到结果库只提交提问 ID 与每站至多一个尝试的 ID/updatedAt；受信 `question-archive` IPC 在主进程重新核对未删除记录、归属、版本及非空保存正文，再生成新结果，source 为 null，不采当前网页或接受 renderer 正文。缺失/变化先重新读取并人工勾选，比较至少两站；结果可继续加入现有文件夹。新收集/比较目标覆盖先前历史目标，忙碌或迟到保存回包不能导航。

重试只对明确提交前失败使用默认批量入口。提交未确认、超时、未知/缺失回包及取消都需先查看本站，再逐站勾选确认；取消不证明未发送。核对/查看动作不发送，重试仍使用原 runId/text/tier/images。查看时核对最新选择，本站未选则不聚焦其它站、不自动改范围，具名提示人工重新选择也会加入后续群发；查看经受信 inspect-site IPC 在同一主进程事件内核对并聚焦，严格 true 回执才切回站点；拒绝或异常显示具名提示，等待回执期间核对框与根层命令保持锁定。已作废轮次的迟到回执不再导航。重新打开页面不作为未提交证据。执行时重新读取本轮结果，迟到同轮可信 sent 只升不降并移除重试选择；新轮和本机重置使旧选择失效，不改主进程重发策略或预算。

设置按外观与阅读、操作与快捷键、同步、备份与恢复、网络代理、数据管理、关于七类显示；普通入口默认外观，旧 display/overview/drive-diagnostics/proxy/data 及备份、原图、偏好子目标统一映射后聚焦。分类状态仅在本次设置会话内保留，不增加同步字段；各组件稳定挂载，hidden/inert 排除隐藏内容的布局、键盘及读屏访问。代理与同步只共享一次带 secret 标志的状态读取；草稿、备份选择和分类反馈保留，隐藏异步结果不主动聚焦。离开整页仍确认未保存草稿，确认层可在其他分类显示。分类跳转保留滚动位置，离开数据管理清空 DELETE，写入锁期间的跳转请求不延迟重放。

设置集中既有显示密度及站点默认比例，仅应用主进程接受的值，与菜单推送共用状态。高级数据操作默认折叠，可通过显式设置命令定位。清理确认的 `local-data-stats` 是受信只读单条 SELECT 快照，区分分类附带记录与 reset 的全部本机范围；执行前重读，相关数量变化须再次确认，执行结果以真实返回条数为准，两次 IPC 不构成原子快照。可先定位备份导出入口。破坏性本机/云端写入前同步阻断关闭与根层命令，成功或失败后释放；迟到重置结果不能清新会话。诊断按机器 kind/code 推荐安全手动首步，更明确的忙碌/未确认/登录/页面与控制证据优先，未知失败要求检查，旧健康快照不能宣称新失败已恢复；其它恢复操作按需展开，不自动重载或重发。

## 13. 网络代理

- 代理表单的未保存输入只留在设置卡内，并显示未保存状态。关闭设置、Escape 或离开的全局命令先让用户选择继续编辑或放弃；取消保留输入及焦点，确认后才执行完整导航。切换设置分区不丢输入，密码不进入普通草稿。应用退出与强杀不在此保护范围。

全应用只有一份代理配置，分三档：跟随系统（`system`，默认）、不使用代理（`direct`）、自定义（`custom`，支持 HTTP、HTTPS、SOCKS4、SOCKS5）。九站、外壳和 Google Drive 同步（包括 OAuth）都按这一份配置出网。值类型、默认值、字符校验和规范化都在 `shared/proxy-preference.ts`。设置卡 `renderer/settings-proxy.tsx` 只读 `polyask:proxy-state`，不读偏好快照。本期不做显式 PAC、分站分流，也不给每站单独配代理；「跟随系统」时，系统配置里的 PAC 交给 Chromium 处理。

### 出口

| 出口 | 承载 | 处理 |
| --- | --- | --- |
| `persist:polyask-sites`（`SITE_PARTITION`） | 九站视图，以及站内的登录跳转 | `setProxy` 后校验；认证走 `app.on("login")` |
| defaultSession | 外壳窗口；开发态的 dev server | `setProxy`，不校验（`setProxy` 之前它的 `resolveProxy` 不可信，见下文「启动阻断」） |
| `polyask-net`（非持久，`main/proxy-sessions.ts` 的 `NET_PARTITION`） | Drive，以及 OAuth 的令牌交换、刷新和撤销 | `setProxy` 后校验；认证走请求级 `login` |
| `polyask-proxy-probe`（非持久） | 设置卡里的「测试连接」 | 每次测试单独配置 |
| `app.setProxy` | 不属于任何 session 的请求 | 写入同一份配置，作兜底 |

- Drive 和 OAuth 经 `main/net-request-fetch.ts` 的 `createSessionFetch` 走 `net.request`，参数为 `redirect: "manual"`、`cache: "no-store"`、`useSessionCookies: false`。Node 全局 `fetch` 和 `session.fetch` 都不能用：前者不走 Chromium 网络栈，连系统代理都不认；后者不处理 `login`。适配器自己跟随重定向，最多 20 次，跨源时去掉 `Authorization`；`net::ERR_*` 原样保留在 `Error.message` 里。源码守卫断言生产装配注入的是这个适配器。
- Drive 用非持久的 `polyask-net`，不用 defaultSession，这样同步载荷和 Google Cookie 都不会落盘。OAuth 回环回调是入站连接，不受代理影响。`shell.openExternal` 打开的系统浏览器不在本应用的代理范围内。
- 默认的「跟随系统」下，Drive 同步也走系统代理。此前它用 Node `fetch`，任何代理都不走。

### 翻译、应用与 fail-closed

- **翻译**（`toProxyConfig`）：`system` 译为 `{mode: "system"}`，`direct` 译为 `{mode: "direct"}`。`custom` 译为 `fixed_servers`，其中 `proxyRules` 是 `<scheme>://<host>:<port>`（IPv6 写成 `[addr]`），`proxyBypassRules` 是用户列表末尾再由程序固定追加 `<local>`。`<local>` 只匹配不含点的单标签主机名，与 loopback 无关；loopback 由 Chromium 隐式绕过，开发态 dev server 不受影响（实测见 `docs/verify.md`「自定义代理」）。凭据不能写进代理规则，只能经 `login` 提供。
- **应用**（`main/proxy-runtime.ts`，串行执行，排队时只留最新一份）：
  1. 先装入新凭据或墓碑：每次应用都调用 `proxy-auth` 的 `beginApply`，`gen` 加一。目标身份（scheme、host、port、username）与已应用身份不同，或者请求带了新凭据（包括清除密码）时，再对站点 partition、defaultSession、`polyask-net` 执行 `clearAuthCache()`，并清零熔断。这样清缓存之后再到达的 407，拿到的只会是新凭据或墓碑。
  2. 依次 `setProxy`，最后 `app.setProxy`。
  3. 对站点 partition 和 `polyask-net` 调用 `resolveProxy("https://proxy-check.polyask.invalid/")`，与期望值比较：http 对应 `PROXY h:p`，https 对应 `HTTPS h:p`，socks4 对应 `SOCKS h:p`，socks5 对应 `SOCKS5 h:p`，direct 对应 `DIRECT`；`system` 不比较。结果不符时有界重试，总时长不超过 2s。`setProxy` resolve 只说明配置写进了 pref store，不能当作已生效的证据。
  4. 目标与已应用配置规范化后相同（且当前没有阻断）时，跳过第 2、3 步；第 1 步只看身份和凭据，不受这条影响。
- 每次 `setProxy`、`clearAuthCache` 调用限时 5s（`PROXY_CHROMIUM_CALL_TIMEOUT_MS`），每次 `resolveProxy` 只给 2s 校验窗口的剩余时间；超时一律按应用失败处理，走下面的 fail-closed。Chromium 网络服务挂起时，代理流程不会无限期占着 gate 和写锁。
- 校验用的是 `.invalid` 保留域名，不会触发 DNS。保存时按 Chromium 的通配语义，拒收能匹配这个主机的绕过规则（`*`、`*.*`、`*.invalid`、`.invalid`、`*polyask*` 等）。这类规则会让校验误判，效果也等于全部直连。
- **fail-closed**：校验失败时，先恢复上一份已应用配置并重新校验。没有上一份（启动时），或者恢复后仍然失败，就把三个出口改成阻断配置 `http://127.0.0.1:9`（不带 direct 回退），站点报 `proxy_failed`，状态记 `proxy_apply_failed`。**任何情况下都不回退到 `system` 或直连。** 阻断配置永远不记为「已应用配置」：认证匹配、打开或关闭跟随时，取到的只会是上一份合法配置或 null，状态另外标 `blocked`。
- **启动阻断**（`main/proxy-startup-block.ts`）：`main/index.ts` 在模块顶层、app ready 之前调用 `blockProxyUntilApplied(app.commandLine)`，追加命令行开关 `--proxy-server=http://127.0.0.1:9`（与阻断配置同址），让所有网络上下文默认处于阻断，直到 runtime 第一次 `setProxy` 把它覆盖。原因：session 一被实例化，Chromium 就开始下载拼写词典（`redirector.gvt1.com`），不等 webContents，`spellcheck: false` 也挡不住；外壳窗口和第 1 步的 `clearAuthCache()` 都会在首次 `setProxy` 之前实例化 session，没有这个开关时，存了自定义代理的启动每次都有 1–3 个词典请求直连出网。Electron 44.5.0（Linux）实测 `session.setProxy` / `app.setProxy` 的 http、socks5、`direct`、`system`（含带 `http_proxy` 环境变量启动）都能覆盖开关，回来回切换照常；从未 `setProxy` 的 session 保持阻断；loopback 仍隐式直连，开发态 dev server 不受影响。阻断期间 defaultSession 的 `resolveProxy` 会答 `DIRECT`，但流量实际被拦，所以 runtime 只校验站点 partition 和 `polyask-net`。源码守卫断言开关在 app ready 之前追加。
- **启动顺序**：数据库就绪 → `await proxy.runtime.recomputeFromStore()`（内部完成读取、分类、应用和阻断）→ `new ViewManager(...)`。读取用 `ProxyPreferenceStore.read()` 直接读四项原始值（不调用 `snapshot()`，不依赖 `deviceId`，全新安装时也不抛错）；启动时还没有绑定 gate，这次调用不经过 `OperationGate`；存储值损坏时进入阻断而不抛错，不会让启动失败。所以首个站点 `loadURL` 发生在代理应用并校验之后。装配代码在 `main/proxy-services.ts`；源码守卫断言 `main/index.ts` 里的 `await proxy.runtime.recomputeFromStore()` 只出现一次，并且在 `new ViewManager` 之前。启动时不读密码。Chromium 代理调用全部挂起时，启动最多在窗口隐藏的状态下等约 25s（`clearAuthCache` 5s + 阻断时三个 session 与 `app.setProxy` 各 5s），之后以阻断状态继续启动。
- 四项读取结果都带标签：`absent`、`invalid`、`ok`。以下情况进入阻断，状态标 `stored=invalid`，设置卡提示重新设置：`proxyFollowing` 存在但不是布尔值；不跟随，且 override 非法；跟随，且 `proxyAccepted` 非法；跟随、`proxyAccepted` 缺失，且 override 不是 `ok`。跟随时 `preference:proxy` 非法按缺失处理，只会退回已经确认过的值，不会 fail-open，状态同样标 `stored=invalid`（不阻断）。不跟随时 `preference:proxy` 不参与解析，非法也标 `stored=ok`：本机保存修不了它，标成损坏只会让设置卡一直报警、同步设置行一直禁用。
- **运行中变更**：忙碌只看 `OperationGate` 的 `busy` 和 `onIdle`。同步拉取、备份恢复后的 refresh、本机重置，都经 `PreferenceRuntime.refresh()` 的 proxy 回调；回调只调用 `request()` 设置脏标记，不携带值。重算在 `gate.run` 内执行，每次都从 store 读取最新输入。拿不到 gate，或者正在本机重置时，保留脏标记，等 `onIdle` 或重置结束后再试。因此重算期间群发会收到 `operation_busy`，不会在发送中途换线路。
- **写锁与重置互斥**：`proxy-set`、`proxy-follow`、`proxy-accept` 的完整 handler、后台重算、`wipeSecrets` 都在代理写锁内执行。顺序是先取 gate 再取锁，重置一侧只取锁。写 handler 进入 gate 之前先查 `dataAdmin.isResetting`，重置中返回 `proxy_busy`。每个 await 之后核对 `wipeEpoch`，一旦变化，就放弃写缓存、写盘、写 meta 和写 outbox。
- **不断开旧连接**：保存后不调用 `closeAllConnections`。流式回答和 WebSocket 沿旧线路跑完，新连接按新设置。「重新加载全部站点」（`polyask:proxy-reload-sites`，占用 gate，`main/proxy-reload.ts`）先对站点 partition 执行 `closeAllConnections()`（限时 5s，失败或超时直接报错，不报告成已切换），再逐个已选站点 reload，会中断正在生成的回答；未选站点没有视图，选中时按新线路加载。`reload` 返回 false 的站点会列出来，请用户手动刷新。保存后不自动重载。
- **WebRTC**：已应用配置是 `custom`，或者处于阻断时，所有站点 webContents 设为 `disable_non_proxied_udp`，其余情况设为 `default`。阻断属于 fail-closed，按 `default` 处理会让 UDP 绕过阻断直连。新视图在 `main/site-view.ts` 的创建点读取当前策略，已有视图由 runtime 遍历更新。

### 认证（`main/proxy-auth.ts`）

- 只有同时满足以下条件才交出凭据：`authInfo.isProxy === true`；已应用配置（或应用过程中的 `applying`）是 `custom`；host 和 port 规范化后一致（IPv6 带方括号比较，IDN 转 punycode，端口按数值比较）。`authInfo.scheme` 是认证方案（basic/digest），不是代理协议。站点自己的 401 一律不代填。
- `app.on("login")` 满足条件时**同步**调用 `event.preventDefault()`，callback 可以之后异步调用；`polyask-net` 的请求级 `login` 用同一套规则。只有缓存为空时才惰性读取 `proxy-secret.bin`：读取期间缓存为 `loading`，5s 超时。代际号 `gen` 只增不减，读完时发现 `gen` 已变，就丢弃结果并取消认证。清除密码时写入墓碑，命中墓碑直接取消、不读盘，所以即使删除密码文件失败，也不会把旧密码读回来。读到 `unreadable`（解密失败或钥匙环超时）不是永久结论：距上次结果满 30s（`PROXY_SECRET_RETRY_MS`）后，下一次认证挑战或设置卡刷新会再读一次，钥匙环解锁后可以恢复；没有密码文件（`none`）则保持到下次保存或应用。
- 密码原样交给 Chromium，不做 URL 编码，也不按 `:` 或 `@` 截断；含非 ASCII 字符的密码在站点和 Drive 两条认证路径上都由原生检查覆盖。
- **407 熔断**：`app.on("login")` 只统计 `firstAuthAttempt === false` 的事件；请求级 `login` 在同一个请求第二次进入时记一次。同一身份 60s 内累计 2 次即熔断，之后一律取消，产出 `proxy_auth_failed`。身份变化、换密码或清除密码、本机重置时清零。九站并发首载产生的 `firstAuthAttempt === true` 不计数。
- **测试连接**（`main/proxy-probe.ts`）：同一时间只允许一个测试，不受 `OperationGate` 限制。每次测试前清空 probe session 的认证缓存、连接和 DNS 缓存，再用 8s 超时请求 `https://www.gstatic.com/generate_204`，并返回实际线路 `route: "proxy" | "direct"`。设置卡只在自定义代理时把 `direct` 说成「绕过列表让测试地址直连」；不使用代理、或跟随系统而系统没有代理时，直连就是预期线路，只报连接成功。凭据只在请求级 `login` 里交出，不经 `app.on("login")`，也不影响正式的熔断计数。表单没填新密码时，先取 `proxy-auth` 缓存里身份一致的密码（`credentialFor`，包括只在本次运行有效的密码）；缓存是墓碑、正在重置或是别的身份时不交密码、也不读盘；缓存为空或没有读到文件时才读 `proxy-secret.bin`，读取期间发生本机重置则丢弃结果。

### 同步与本机确认

| 本机状态 | 线路配置的来源 | 上传 | 本机重置 |
| --- | --- | --- | --- |
| 不跟随（默认） | `meta.proxyOverride` | 不上传 | 清除，回到 `system` |
| 跟随 | `main/proxy-target.ts` 的 `resolveProxyTarget`，基于共享值和 `proxyAccepted` | `preference:proxy` 投影为 `polyask.preference.proxy`，按 LWW 合并 | 清除本机副本，云端不删 |

- 同步拉取时，不管本机跟不跟随，都会把云端值写进本机 `state_items`；不跟随时这份值不生效。跟随开关只能经 `polyask:proxy-follow` 修改，通用的 `polyask:preferences-follow` 拒收 `proxy` 组。同步设置里的「代理」行读 `proxy-state` 的 `following`，不读偏好快照里的跟随状态（`proxy-follow` 不经通用偏好刷新，快照里那一项可能是旧的）。
- **确认规则**：跟随时，共享值改成 `system` 或 `direct`，或者与比较基准同为 `custom` 且 scheme、host、port 都相同（只改了绕过列表或用户名），就直接采用。其他情况保留基准，并给出 `pendingConfirm = {scheme, host, port, version}`；设置卡显示横幅，提供「应用」和「保留本机设置」，外壳反馈通道同时发一条提示。比较基准是 `proxyAccepted ?? proxyOverride`；打开跟随的那一次，固定用当时的已应用配置。`proxyAccepted` 只在校验通过后写入。
- `proxy-accept` 在 gate 内从 store 重新读取共享值，同时满足以下三条才应用：入参与 `pendingConfirm` 一致；共享值的 `{updatedAt, deviceId}` 等于 `pendingConfirm.version`；共享值的 scheme、host、port 等于入参。任何一条不满足，返回 `proxy_not_pending`，并重算一次刷新横幅。有待确认项时，`proxy-set` 返回 `proxy_pending_confirm`，设置卡也会禁用保存。
- **打开跟随**：处于阻断或 `stored_invalid` 时拒绝，返回 `proxy_invalid`。成功后在同一个事务里写 following=true 和 `proxyAccepted`；原本没有共享值时，把当前配置作为新版本写入并入 outbox。
- **关闭跟随**：在同一个事务里把 `proxyOverride` 设为 `proxyAccepted`（缺失时取已应用配置），把 following 置为 false，并删除 `proxyAccepted`。**永远不会把未确认的共享值复制进本机。** `proxyAccepted` 非法，或者没有已应用配置时，拒绝关闭；这时用 `proxy-set` 保存一份新配置即可脱困，following 非法时它会一并写回 false。
- **`proxy-set` 先应用、后落盘**：校验或应用失败时什么都不写，重启后也不会进入阻断。成功后，跟随时在同一个事务里写共享值（入 outbox）和 `proxyAccepted`，不跟随时写 `proxyOverride`。密码写盘失败不回滚配置，结果附带 `secret: "failed"`，密码只在本次运行有效。`password` 的取值：`undefined` 不改，`null` 清除，`""` 拒收；身份是 SOCKS 时一律拒收。
- 旧版客户端的 `isPreferenceKey` 会过滤掉这个键，`carriedSettings` 原样带回。

### 数据边界

- **`preference:proxy`**：存在 `state_items` 并参与同步投影，冻结样本是 `desktop/test/fixtures/schema1-state-preferences-proxy.json`。它**不进** `PreferenceValues`、`DEFAULT_PREFERENCE_VALUES` 和偏好快照的 `values`。通用写入路径双层拒收 `proxy` 键和 `proxy` 组：一层是 `main/preferences-drafts-ipc.ts`，一层是 `PreferencesRepository` 的 `set`、`seed`、`setFollowing`。唯一的写入口是 `main/proxy-preference-store.ts`。
- **本机 meta 键** `proxyOverride`、`proxyFollowing`、`proxyAccepted` 各自独立存放，不放进 `devicePreferences`。原因是通用写入会把经 `readDevice` 过滤的对象整个写回；放在里面的损坏值会在下一次调整站点缩放时被静默删掉，重启后变成 `system`。三个键都不同步、不进备份，`resetLocalData` 清空 meta 时一并清除。
- **备份完全排除**：`BackupService.snapshot` 跳过 `preference:proxy`，`backup-validation` 遇到它直接拒收。理由有三：同步会把其他设备的值写进本机；恢复时会盖上新时间戳并上传，按 LWW 覆盖所有跟随的设备；≤ v1.19.0 的版本导入含这个键的备份，会整份报 `backup_invalid`。
- **密码**：文件是 `userData/proxy-secret.bin`，明文 `{version, scheme, host, port, username, password}` 用 `safeStorage.encryptStringAsync` 加密，由 `main/secret-file-store.ts` 写入（refresh token 的 `TokenStore` 现在是它的薄包装）。写入流程是同目录临时文件 0600、fsync、rename。钥匙环阶段限时 10s（`SECRET_KEYRING_TIMEOUT_MS`），读、写和可用性查询各自计时：写入的钥匙环阶段（`available()` + 加密）超时不建临时文件、不动旧文件，按写盘失败处理（`secret: "failed"`，密码只在本次运行有效）；读取的钥匙环阶段（`available()` + 读文件 + 解密）超时按读不到（`unreadable`）处理；`securePersistence()` 超时按不能安全保存答复；`clear` 只删文件、不经过钥匙环。超时后迟到的结果一律丢弃，排在后面的读写照常执行；读取失败（含超时）绝不删除文件；`read`、`write`、`clear` 在同一条链上串行执行，链上已有读取在排队或进行、其后还没排入写或删时，新的读取直接复用它，所以反复触发的惰性读取不会在钥匙环挂起时越积越多；写入在 rename 之前核对 `wipeEpoch`。没有安全加密后端（包括 Linux 的 `basic_text`）时只留在内存。保存新密码时写盘失败（含钥匙环超时）或只能留在内存，`proxy-auth` 会删掉旧的 `proxy-secret.bin`（只 unlink、不经钥匙环），下次启动不会读回被替换的密码；删不掉时结果同样附带 `secret: "failed"`。密码只交给身份完全一致的代理，不同步、不进备份和诊断报告；IPC 只写不读。
- 设置卡显示的 `ProxySecretState`：`unknown`（本次运行还没读过）、`saved`、`memory`（重启后丢失）、`mismatch`（已解密但身份不一致）、`unreadable`（解密失败或钥匙环超时，例如便携目录换了机器或用户）、`none`。
- **本机重置**：`DataAdminService` 在 `sync.disconnect()` 之后、`resetLocalData()` 之前 await `wipeSecrets`，依次执行：取写锁；`wipeEpoch` 加一，缓存置为 `wiping`（期间到达的 407 一律取消、不读盘）；`gen` 加一；删除密码文件；清零熔断；三个出口执行 `clearAuthCache()`。任何一步失败，整个重置就失败。之后经 `afterReset → preferences.reset() → refresh()` 回到 `system`。本机重置不删 Drive 上的共享代理值。

### 错误码

| 场景 | 码 | 落点 |
| --- | --- | --- |
| 站点主帧因代理加载失败 | `proxy_failed`、`proxy_auth_failed`，进 `SITE_CODES`，和 `load_failed` 一样归为「提交前失败」 | `main/proxy-errors.ts`、`main/view-manager.ts` |
| Drive / OAuth 请求经代理失败 | `proxy_error`，同步归为 `offline`，reason 为 `oauth_proxy` 或 `drive_proxy`，与 `network_error` 一样退避 | `main/proxy-net-error.ts`、`main/sync-failures.ts` |
| 代理 IPC 结果 | 失败码放在 `result` 字段：`proxy_invalid`、`proxy_busy`、`proxy_apply_failed`（未生效）、`proxy_test_busy`、`proxy_not_pending`、`proxy_pending_confirm`。密码写盘失败不算失败：成功回包附 `secret: "failed"`，渲染层译为 `proxy_secret_failed`（密码未保存，只在本次运行有效）。都不进 `SITE_CODES` | `shared/proxy-copy.ts` 翻译 |
| 测试连接结果 | `result` 字段取 `proxy_failed`、`proxy_auth_failed`、`network_error`、`network_timeout`、`proxy_apply_failed`、`proxy_invalid`、`proxy_test_busy` | `main/proxy-probe.ts` |

- 站点码的映射：`ERR_PROXY_CONNECTION_FAILED`、`ERR_TUNNEL_CONNECTION_FAILED`、`ERR_SOCKS_CONNECTION_FAILED`、`ERR_SOCKS_CONNECTION_HOST_UNREACHABLE`、`ERR_PROXY_CERTIFICATE_INVALID`、`ERR_MANDATORY_PROXY_CONFIGURATION_FAILED` 归为 `proxy_failed`；`ERR_PROXY_AUTH_REQUESTED`、`ERR_PROXY_AUTH_UNSUPPORTED` 归为 `proxy_auth_failed`；其余仍为 `load_failed`。阻断配置会让站点得到 `ERR_PROXY_CONNECTION_FAILED`，因此显示为 `proxy_failed`。
- Electron 44.5.0 原生实测：HTTPS 目标遇到 407 且认证被取消（熔断或没有密码）时，站点拿到的是 -111 `ERR_TUNNEL_CONNECTION_FAILED`，`ERR_PROXY_AUTH_REQUESTED`（-127）、`ERR_PROXY_AUTH_UNSUPPORTED`（-115）实际几乎不出现。所以 `ViewManager` 另接 `proxyAuthFailed`（`ProxyAuth.authFailed()`）：分类结果是 `proxy_failed` 且熔断处于触发状态时，改报 `proxy_auth_failed`。各场景的错误号见 `docs/verify.md`「自定义代理」。
- Drive/OAuth 的判断依据是 `Error.message` 以 `net::ERR_PROXY`、`net::ERR_TUNNEL`、`net::ERR_SOCKS` 或 `net::ERR_MANDATORY_PROXY` 开头。这是 Chromium 错误名，属于机器字面量，不是文案。认证被取消时 `net.request` 先回一个 407 响应、读正文时才报 `net::ERR_TUNNEL_CONNECTION_FAILED`，所以响应状态 407（RFC 9110 规定只由代理发出）和正文阶段的代理网络错误同样归为 `proxy_error`。
- 同步阶段（非 OAuth）的 `proxy_error` 也报 `drive_proxy`：同步流量就是 Drive 流量，要改的是代理而不是网络。同步诊断按 Drive 访问失败统计 `drive_proxy`。

### 预算

代理不改群发的 44s/90s 预算，也不在群发链路里加入等待：代理的写操作和后台重算都占用 `OperationGate`，与群发互斥，群发只会以 `operation_busy` 被拒，不会被拖长。代理自己的上限是：应用后校验 2s，`setProxy` / `clearAuthCache` 每次调用 5s（`PROXY_CHROMIUM_CALL_TIMEOUT_MS`），密码文件的钥匙环阶段（读、写、可用性查询）各 10s（`SECRET_KEYRING_TIMEOUT_MS`；写盘超时降级为仅本次运行有效，读盘超时按 `unreadable` 处理，30s 后才再读），`proxy-auth` 等待惰性读取 5s，测试连接请求 8s，「重新加载全部站点」关闭连接 5s（§4 预算表）。`proxy-set` 在 gate 和写锁内先应用校验、再写密码，写盘又排在同一条链上可能已挂起的读盘（设置卡打开时的密码状态刷新，或 407 触发的惰性读取）之后，所以钥匙环无响应时，一次带密码的保存最坏会让群发收到 `operation_busy` 约 22s（2s 校验 + 前一次读盘 10s + 本次写盘 10s）；本机重置的 `wipeSecrets` 在写锁内删除密码文件，最多先等前一次读或写的 10s（`clear` 本身不经过钥匙环）。Chromium 网络服务整体挂起时，一次应用最坏占 gate 约 30s（`clearAuthCache` 5s + 恢复上一份 5s + 阻断时三个 session 与 `app.setProxy` 各 5s）；启动时同样情况最多在窗口隐藏下等约 25s，然后以阻断状态继续。没有这些时限时，钥匙环或网络服务挂起会让 gate 和写锁一直不释放、群发一直被拒。

### 诊断

`Alt+H` 诊断报告头部有一行 `proxy`（`shared/site-report.ts`），格式为 `proxy mode=<system|direct|custom> [scheme=…] auth=yes|no secret=<ProxySecretState> following=yes|no applied=ok|proxy_apply_failed pending=yes|no confirm=yes|no stored=ok|invalid`。`mode`、`scheme`、`auth` 描述的是配置值（不跟随时为本机配置，跟随时为解析出的目标），`applied` 说明它是否已生效；`scheme` 只在自定义时输出，`auth` 只说有没有用户名。`secret=unknown` 表示本次运行还没读过密码文件：复制诊断报告不会触发读盘。这一行只取枚举和布尔值，不输出主机、端口、用户名、绕过列表或任何 URL；单个字段不合法时只省略该字段，`mode` 不合法、读取失败或 1.5s 内（`REPORT_PROXY_STATE_TIMEOUT_MS`，`renderer/site-health-actions.ts`）拿不到代理状态时整行省略，报告照常复制。

### 已知限制

- SOCKS 代理不支持用户名密码认证：Chromium 只提供无认证方法。身份是 SOCKS 时，用户名会被清空，密码一律拒收。
- SOCKS4 在本机解析 DNS，可能受 DNS 污染，也不支持 IPv6 目标；SOCKS5 由代理端解析。
- Windows 上，代理要求 NTLM 或 Negotiate 认证时，Chromium 会静默使用当前 Windows 登录凭据。本期不禁用 `auth-schemes`，因为公司 NTLM 代理的用户需要它。同步带来的新地址要先在本机确认，所以只有用户自己填写或确认过的代理才会走到这一步。
- Linux 的「跟随系统」：能识别 GNOME/KDE 时，读 gsettings/kioslaverc，不读环境变量；识别不了（WSL、裸 X）时，读启动环境里的 `*_proxy`，从图标启动可能读不到。设置卡在 `linuxDesktopProxy === "env"` 时提示改用自定义。钥匙环未解锁时解密可能卡住：`proxy-auth` 最多等 5s，链上的读盘 10s 后按读不到处理，不删密码文件。
- 同步带来的「改为直连」「改为跟随系统」，以及只改绕过列表的变化，无需确认就会生效（用户的选择），可能让站点改为直连。缓解措施：拒收裸 `*`；设置卡标明配置来源；诊断报告带 `following` 字段。
- IPv6 代理地址带端口时必须写方括号：不带方括号的 `::1:7890` 是另一个合法的 IPv6 地址，会被原样接受（主机栏没有专门提示，测试连接会失败）。
- Drive/OAuth 只按上面四个前缀判断代理错误：`ERR_PAC_SCRIPT_FAILED`、`ERR_NO_SUPPORTED_PROXIES`、`ERR_UNEXPECTED_PROXY_AUTH` 不在其中，仍报 `network_error`。
- 在 fake-IP 方式解析 DNS 的环境里（Clash 一类），代理主机名写错时得到的是 -324 `ERR_EMPTY_RESPONSE`，站点显示 `load_failed`，不是 `proxy_failed`。
- 熔断只对已识别的代理认证失败计数。假如没有熔断，错误密码会一直重试到 -375 `ERR_TOO_MANY_RETRIES`（实测 31 次之后），这个错误号不在映射表里；熔断在第 2 次就会触发，所以正常情况下走不到这一步。
- Chromium 的网络质量估计在启动时会对首个请求的主机名做一次只查 DNS 的解析（不建连），有没有启动阻断都一样；生产中这是一次系统 DNS 查询，SOCKS5 下也可能经本机 DNS 暴露该主机名。预期它只命中本机缓存或 hosts，有待真机抓包确认（`docs/verify.md` 真机清单）。
- macOS 未经真机验证；启动阻断开关能被各模式覆盖这一点也只在 Linux 上实测过。

## 14. 桌面通知、全局快捷键与报告导出

### 通知

`completion-notifier.ts` 按 runId 在 800ms 内聚合同轮的完成及需处理状态；没有明确完成证据时不报完成。辅助综合/追问通过 `SiteStatus.operationRunId` 携带身份，不新增 submission 或改变群发计数；页面失败保留身份，新群发清除旧身份。主窗口聚焦时不显示完成通知。`completion-notifications.ts` 负责通知目标与历史生命周期，`notification-delivery.ts` 负责原生事件与清理。

设置页保留原有通知开关的同步规则，新增手动测试及运行态反馈，不新增持久化键。`Notification.isSupported()` 只判断环境能力；调用 `show()` 后为 requested，收到原生 show 才为 shown，5 秒无确认则 unknown；失败为 failed，不回传操作系统原始错误。测试不改变开关。macOS 未签名包可能无法投递，不能以 API 返回成功或 Linux 桩测试声称 macOS 可用。

点击通知先恢复已有窗口，再校验记录、回答身份和 repository lifecycle；有效已存提问只打开历史阅读，不恢复远程会话。无已存目标时仅定位相同 runId 的仍打开站点。renderer 经过群发/确认/操作锁及既有未保存编辑导航保护；不自动重发、重载或替换提问草稿。禁用、重置、关窗会使旧通知及计时器失效。

确认框等待用户选择时也禁止新的通知/全局命令导航：通用确认和本机数据确认由 `external-navigation-lock.ts` 持有保护，备份导入确认由原导航 guard 检查。阻挡新请求不作废原先待确认的导航；用户明确批准后，原操作仍可完成。

### 命令面板快捷键

默认 `CmdOrCtrl+Shift+P`，可在设置中切换为 `CmdOrCtrl+P`；仅一组生效，F1 和 Alt+K 不再绑定。`CommandPaletteShortcutRuntime` 在可交互前恢复，菜单、外壳和站点输入共享同一有效 mode；组合输入期间暂时抑制原生菜单快捷键，非组合输入或清理时恢复。Windows/Linux 的菜单还关闭这两项的自动加速器注册；macOS 不依赖该平台限定字段，物理键仍需实机核验。

原生命令打开面板、快捷键速查或使用指南时先将键盘焦点交给外壳，再由面板聚焦搜索框或内容区。四个模式均可点击面板外空白处关闭；Escape 在窗口冒泡阶段处理，焦点落到 body 仍可退出，组合态、229 键码、已被处理的事件及嵌套确认框优先，不会一次关闭两层。

`meta.commandPaletteShortcut` 由专用仓储读写，不进 outbox、Drive 或业务备份，恢复备份不改变该选择；重置清除此键并保留 deviceId。冻结样本为 `desktop/test/fixtures/command-palette-shortcut-local-meta-v1.json`。非法存储值回退默认，非法 IPC 值拒绝；读、写、菜单应用失败分别返回 `command_shortcut_read_failed/save_failed/apply_failed`。候选菜单预先构建，写入和菜单切换在同步事务中完成，失败回滚；重置失败后重新读实际库，不盲目清除仍保存的选择。单调 revision 防止迟到读写回包覆盖较新事件。

### 全局提问快捷键

`GlobalPromptShortcutRuntime` 在 app ready 后恢复，app 退出时只注销自身持有的绑定；macOS 关窗后保留注册但不新建窗口，Dock 重建后复用同一 runtime。触发只恢复、显示并聚焦已有主窗口，再走既有 `focus-prompt` 命令保护。默认关闭，不读剪贴板。

`meta.globalPromptShortcut` 由 `global-prompt-shortcut-repository.ts` 单独存储，不写 state/outbox，不进入 Drive 投影或业务备份。`database.resetLocalData()` 的 meta 清理会移除它；重置收尾重新读取实际仓储，重置失败且未清库时保留原绑定。新增冻结样本 `desktop/test/fixtures/global-prompt-shortcut-local-meta-v1.json` 与存储回归覆盖这四处边界，不升级同步 schema。

设置使用修饰键与主键选择器，避免录制按键先被原生菜单消费。更换时先注册候选、保存成功才释放旧绑定；冲突、保存失败或环境不支持均显示有限状态并保留原有效绑定。桌面环境保留的组合键及 Wayland 支持仍需真机核验。

### Markdown 下载与合并导出

历史与结果库分别维护本次多选，不跨页面混选；单份回答直接打开系统保存框，整条记录及批量选择先打开共用导出面板。历史阅读导出固定当前 answerId；结果库单份导出先校验展示记录的 updatedAt + deviceId，再绑定 revision 与结果索引。历史选择只覆盖显式勾选/当前已加载的记录，搜索保留选择并显示隐藏数量，加载更多不自动选中；退出选择或关闭历史清空。结果库复用 kind:id 多选，同时兼容已保存的决策卡。

站点按钮只切换本站：全选时清除，未选或部分选中时补齐，其他站点及已选历史版本不变。默认选择每站最新有正文的尝试，最新无正文时标明回退原因；版本刷新保留仍有效的 answerId，不自动纳入新回答。初次预览仍要求所有目标存在；仅显式刷新允许移除已删除目标，并显示移除数量，保留其他记录的站点与版本选择。结果库 revision 变化后，刷新清空该记录的旧索引选择，须重新核对。减少来源时取消默认纳入的综合结果，用户仍可显式勾选并看到缺失来源提示。列表顺序/时间正序/时间倒序决定合并次序；未勾选的记录不进入文件。

`polyask:markdown-preview` / `polyask:markdown-export` 均通过 trustedShell，仅接收目标身份、版本、条目 ID 和 en/zhCN/zhTW，不接受正文或文件路径。预览仅返回有界元数据；历史正文由 SQLite JSON 投影排除。每次最多 100 条记录，输入预览和最终 UTF-8 输出不超过 64 MiB，超限明确失败而非截断。主进程保存开始读取固定副本，再打开原生 SaveDialog；后续正常生成/编辑不混入该副本，删除、重置 epoch 变化或窗口失效会阻止最终写入。复用同目录独占临时文件、fsync、末次同步检查与 rename；取消不落盘，错误仅返回有限码。默认文件名完整长度不超过 240 个 UTF-8 字节，按 Unicode 码点截断标题，为站点、日期和扩展名保留空间。

文件保留问题、站点、版本、时间、请求档位、可用来源链接和正文；“请求档位”不冒充站点实际档位。历史注明未完成/截断，采集结果未获完整性证据时注明未核验。决策卡保留独立正文与证据，原来源缺失仍可导出。Markdown 调整标题层级、保留列表/表格/代码/公式语义，转义原始 HTML；链接只保留安全 HTTP(S) 或文内锚点，图片降为文字链接，不下载远程资源或嵌入原图。公式复用 shared/markdown-math-tokens 的语法 token，不在解析前替换全文；公式里的 HTML、链接与引用定义同样经过安全转换，代码内容不进入公式处理。此文件不是可恢复备份；HTML/PDF 和剪贴板入口保持原契约。

### HTML/PDF 报告

结果库和决策卡的既有“更多”菜单调用 `polyask:report-export`，请求仅含 kind、id、format 和受限 locale，入口通过 trustedShell。主进程重新读取记录并构造统一模板，不接受任意 HTML 或路径；保存位置只来自原生保存对话框。报告读取已存正文、状态、备注、综合及人工决策依据；明确缺失/未验证内容，不含原图，公式/图表按文字或代码保留。来源缺失的独立决策卡仍可导出标题快照与原摘录。

模板禁用 Markdown 原始 HTML，不嵌入远程图片/脚本，链接限制为不带凭据的 HTTP(S)。最多接受九份回答，输入、HTML 和 PDF 各限 64 MiB，超限明确拒绝。PDF 使用独立非持久 session、无 Node/JavaScript/preload 的隐藏窗口，仅允许本次模板加载，拒绝网络、权限、新窗和下载；30 秒超时、关闭或取消统一释放窗口，并等 WebContents 实际销毁后释放处理器（销毁等待上限 2 秒）。每次 await 后检查窗口、重置 epoch 与记录版本；临时文件写完后最后一次检查和 rename 同步相邻，变更、删除或重置后不得落下陈旧报告。报告状态使用专有有限码及三语文案，不进入站点发送状态通道。

## 实验：最小化空闲节流（默认关闭）

仅启动命令显式设置 `POLYASK_IDLE_THROTTLING_EXPERIMENT=1` 时启用，不增加持久化键或用户设置。`runtime-gates.ts` 装配 `idle-throttling.ts`，纯策略在 `idle-throttling-policy.ts`。每 5 秒检查一次，仅在原生 `isMinimized()` 为真、所有已挂载站点正尺寸且未加载、外壳阶段均为 ready/complete、逐站生产 generation 回包均为 idle/complete/complete_observed 时，才对所有站点允许 backgroundThrottling。每个探针限 2.5 秒；提交未确认、未知、失败、取消或任一站生成中均不准入。异步返回后重验窗口、epoch、成员和阶段。

恢复/show 同步关闭节流。所有 submitPrompt 命令在通道 dispatch 前通知控制器并同步关闭全部站点节流；订阅按当时的视图成员核对，不能依赖周期登记，否则新建视图首个提交会漏唤醒。加载、主帧导航、同文档导航和视图增删也关闭节流；这些动作若发生于最小化期间，锁住直到下一次 restore/show。关闭窗口或释放控制器时清理监听、定时器、待回包及已设置的节流。默认关闭时不注册实验监听、不添加轮询。

这是采集证据用的实验分支，不承诺 CPU/内存收益。当前生成状态仍依赖站点 DOM，不能据此默认启用；不能以隐藏窗口实验替代原生最小化、用户后台操作或跨平台验收。

### 2026-10-22 异步与网络边界补充

结果库同记录刷新只更新未编辑的备注/标签字段；成功保存采用已去重的标签表示，取消编辑采用最新记录。历史删除确认发出后关闭原确认层，迟到回包只处理原详情，不关闭后来打开的记录或弹层，列表刷新采用当前筛选。

`net-request-fetch` 的响应流取消先结束状态、解除信号监听，再终止底层请求；迟到 data/end/error 不再接触已关闭的流。OAuth loopback 只处理本机路径，非法地址解析返回 404，不结束对合法 state 的等待。
