# Desktop 应用（`desktop/`）

动窗口/视图、preload 注入、群发编排、IPC、错误码、数据层与 Drive 同步之前读这份。**错误码全表、超时预算表、跨端不变量、源码文本守卫规则都在这里**；`CLAUDE.md` 只留硬约束条文，这份讲实现与事故现场。冲突以 `CLAUDE.md` 为准。

站点适配器契约、九张站点卡、站点 DOM 与时序坑见 `docs/adapters.md`；真机验证与门禁口径见 `docs/verify.md`；发版见 `docs/release.md`；OAuth 凭据维护见 `docs/desktop-oauth-security.md`。

`desktop/` 自包含的边界是**构建与测试自包含**：`cd desktop && npm test && npm run typecheck` 是它自己的门禁；仓库级动作（git tag、CHANGELOG、发版编排）留在根。

---

## 1. 进程边界与视图树

新增界面元素须沿用所在区域的控件样式与设计变量，并同时接入完整外壳验证夹具。主工具栏的历史和草稿入口共用一个布局单元，不增加顶层网格项；工具栏高度仍按共享显示契约计算。提交前检查新增属性是否在夹具中实际传入，核对三语、明暗主题、两种密度、开合、缩放、键盘与禁用状态及原生站点边界；孤立组件测试不能代替这项集成检查。具体入口见 `docs/verify.md`。

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
- 新建会话与重试核对使用临时 `confirmation` surface：原位置隐藏原生站点视图并保持挂载、正视口，聚焦外壳；确认或取消后恢复 `sites`。重试核对不会发送，只有用户明确勾选并确认才走原请求重试；等待期间其它站的生成和采集保留。CSS 的 z-index 无法盖住 `WebContentsView`，不可只在站点 surface 上叠确认框；等待确认期间不接受其它外壳命令。离开这些覆盖界面去结果库/设置/命令页仍 detach；返回时未选忙碌站点继续隐藏。

## 2. 站点视图与会话

- 全部站点共享持久 partition `persist:polyask-sites`（`diagnostics.ts` 的 `SITE_PARTITION`），与 Shell 会话分离；不读取也不复制 Chrome 的用户配置与 Cookie。
- 安全偏好写死在 `diagnostics.ts` 的 `SITE_VIEW_SECURITY`：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`、`safeDialogs: true`。**未启用 `disableDialogs`**——站点自身的确认框仍要能用。打包产物的 smoke **回读每个视图实际生效的 `webPreferences`**（走未在类型声明里公开的 `getLastWebPreferences`，读不到按不安全处理），任一项不达标记 `insecure_site`。
- 顶层导航由 `navigation.ts` 的 `navigationDisposition` 分五类，`navigation-guard.ts` 裁决：`site`（本站 host）/ `auth`（登记的登录域）/ `transit`（一方反滥用与同意中转域，如 Google 的 sorry 页）/ `external` / `block`（非 https 一律 block）。`site`/`auth` 恒放行；`external` 主帧**只在「auth 流进行中」且「来自服务端 302」时放行**；`transit` 只在服务端 302 放行、渲染端一律拦、不进也不改登录流。核心不变量：`transit` **不新增任何到达 external 的路径**。auth 流只由 `did-navigate`（主帧实际提交）翻转，按「提交」而非「意图」武装。
- 子帧只拦非 https；子帧从不改变主帧流状态。**新窗口一律 deny 真窗口**，`window.open` 只有「目标是本站页面且顶层也在本站」「目标是登录域且顶层仍在本站或 auth 流进行中」两种改写进受管视图的情形。
- 站点视图里点到的外部链接交给用户自己的浏览器（`index.ts` 的 `openExternal` → `safeExternalUrl`）；不接这条回调是**静默无反应**。
- 权限请求处理器**只放行显式白名单**（`view-manager.ts` 的 `SITE_PERMISSION_ALLOWLIST`：`clipboard-sanitized-write` / `fullscreen` / `pointerLock`），其余一律拒绝——摄像头、麦克风、地理位置、MIDI、通知、`clipboard-read`、`window-management` 全在拒绝之列。两个 handler 都读它，改动须同步本节。
- `clearSiteData(site)`（站点详情的「清除缓存后重载」）**只清 `cachestorage` + `serviceworkers`**，不动 cookies、localStorage、IndexedDB——保住登录与站点自身偏好，只针对「过期 Service Worker 顶着旧资源、普通 reload 也从同一缓存来」的白屏。`await` 期间用户可能取消勾选，返回前必须重取视图引用（老引用已悬垂）。

## 3. 站点运行时注入

`desktop/src/preload/site.ts` 在隔离世界按**固定顺序**同步 require 19 条：

```
i18n → core → read-commands → tier → selection-match → send → upload → md → adapters-intl → adapters-intl2 → adapters-cn → adapters-cn2 → adapters-cn3 → adapters-cn4 → generation → history → history-locate → history-adapters → diag
```

- `read-commands.js` 承载只读命令 `getState`/`wasSubmitted`/`collectAnswer`/`diagnose`，挂 `__AMS.readCommand`；消息监听器仍只在 `core.js` 注册一次并委托给它（`desktop-shared-runtime.test.js` 数着），所以它必须紧跟 `core.js`。`tier.js`、`selection-match.js`、`send.js` 读 `window.__AMS`，必须排在 `core.js` 之后；候选匹配模块排在适配器之前；`generation.js` 与 `diag.js` 必须排在**全部适配器之后**——两者都按已填充的注册表逐 host 挂实现/包装，早了就静默缺席。
- **chrome shim 只剩 `runtime.onMessage.addListener`** 一条（`core.js` 用它收命令），以不可写不可配置的属性装在 `globalThis.chrome` 上。
- **locale 单向注入**：require 完成后由外壳调 `__AMS_I18N__.setLang(resolveLocale(navigator.language))`。全应用只有 `shared/locale.ts` 一份解析（`en` / `zhCN` / `zhTW`，前缀匹配，未命中的 `zh-*` 之外一律 `en`）；运行时不再自己猜语言。
- 命令通道：main 用 `contents.send("polyask:site-command", {requestId, command})`，preload 回 `polyask:site-response`。**两端都只认主帧**——`shell-ipc.ts` 的接收侧显式判 `event.senderFrame?.parent !== null` 就丢弃，再由 `manager.owns(sender)` 校验来源视图；`SiteCommandChannel.receive` 还要求 `pending.contentsId === sender.id`。
- `dispatch` 逐个遍历监听器：某个监听器返回 `true`（会异步 `sendResponse`）或已同步作答就停；没有任何监听器接手才判 `invalid_response`；无监听器时判 `adapter_unavailable`。**不在这里硬断言「有且只有一个监听器」**——模块作用域一抛，`site-command` 监听就注册不上，九站整链失守；监听器数量由离线测试 `desktop/scripts/desktop-shared-runtime.test.js` 数 `addListener` 调用点守着。
- `wasSubmitted` 的每一个失败出口都是「不支持」：超时、无适配器、异常、形状不对，一律不能被读成「确认未提交」。
- 采集正文码点上限 `TEXT_LIMIT = 1_000_000`（`site.ts`），超限不静默丢弃，改带 `answer_truncated` 码。

## 4. 群发链路与超时预算

- 普通群发、辅助综合发送、新建会话共享主进程 `OperationGate`；上一个操作未结算时拒绝新操作（IPC `operation_busy`），取消后也须等旧请求结算才能释放。渲染层辅助综合同时占用外壳操作锁并显示取消状态。

`renderer` → `polyask:broadcast`（`shell-ipc.ts`）→ `BroadcastCoordinator.send`（`broadcast.ts`）→ `ViewManager.sendCommand` → `SiteCommandChannel` → site preload → 站点运行时。

- **`deadline` 是绝对时间戳**，在 `broadcast.ts` 一次算出（`now() + max(1, timeoutMs)`）并原样放进每站命令，全链路透传、只读不重算。循环等待与 ≥1s 的固定等待一律夹取。
- **群发预算只有 `shell-ipc.ts` 一个真源**：`request.images.length ? 90_000 : 44_000`。**辅助综合走的是 `index.ts` 里另一处硬编码的 `44_000`，且没有带图分支**——改群发预算必须同批跟进这一处，否则带图辅助综合按纯文本预算跑。
- **epoch 取消**：`BroadcastCoordinator` 每次 `send` 自增 `epoch` 并换一个 `AbortController`；`cancel()` 自增 epoch 并 abort。每个 `await` 之后都核对 epoch，不一致立刻返回 `cancelled`。新写的长流程照此办理。
- **可重试码只有两个**：`RETRIABLE = {composer_not_found, not_ready}`——只有它们代表「还没开始提交」，可在同一 deadline 内等 `min(500, 剩余)` 后重投。其它任何码（含新增的）默认不可重试。
- **提交不确定 ≠ 可以重发**：`submit_unconfirmed` 走只读确认窗（下表），确认「已提交」返回成功；确认「未提交」也**只有在开关打开时**才允许自动重发一次。开关 `POLYASK_KIMI_RESUBMIT` 是 `broadcast.ts` 的模块常量，**当前为 `false`**，不是设置项——用户不该有能力打开一条尚未真机验证的自动重发路径。测试必须显式传 `resubmit`。
- **迟到确认（只升不降，2026-10-04 用户拍板）**：`submit_unconfirmed` 的尝试仍记 `ready`、继续采集。之后第一份同时满足「本次尝试 token、`owned:true`、`locate` 为 `selector`/`semantic`（非 `anchor`）、未 `ended`、在 15 分钟观察期内」的快照（与页内 `history.submitted()` / `submissionEvidence:"message"` 同一判据）到来时，`QuestionHistoryService.accept` 把记录从 `unconfirmed` 改为 `submitted`、`submissionCode` 置 null（不新增码；回包时档位未确认的照常记 `tier_unconfirmed`，与正常成功路径一致），经 `setSubmissionHandler` 回调 `submission-upgrade.ts`：仅当外壳状态此刻仍是**同一 runId 的 `unconfirmed`**（未重试 / 未取消 / 未开新一轮）才 `markStatus` 为 `submitted` + `submissionEvidence:"message"`（档位未确认则 `warning` + `tier_unconfirmed`，渲染层结果同样带码），并 `watchGeneration` 让收口与封存照常走。渲染层 `BroadcastFlowState.acceptSubmission` 把同 runId 的 `state:"sent"` 记下，把该站 `submit_unconfirmed` 结果升为成功，重试入口消失；证据早于群发 IPC 回包到达时在提交时补上，重试的站与后续非 sent 状态作废证据。这条路径**不调用 `sendCommand` / `confirmSubmitted` / 任何 dispatch**（`test/submission-upgrade.test.ts` 断言）。**不要**为此给 Claude 等站加 `adapter.submitted()`：重发闸门按「实现了 submitted()」放行、不分站点；加了之后 Claude 首问在用户气泡出现前（实测延迟 6～13 秒）就会回 `supported:true, ok:false`。**同 runId 重试**：`polyask:broadcast` 先 `capture.prepareRun` flush 在采的站，这次 flush 可能正好把待重试站升为已发送；`lateSentResult` 认出外壳状态已是同 runId `sent` 的站，从 `dispatch` 剔除（不开新尝试、不 `beginGenerationRun`、不标发送中、不派发），直接回 `ok:true, submissionEvidence:"message"`。flush 仍没读到证据的站照常归新尝试（用户主动重试，问两遍的风险窗口从「永远」缩到几秒，不消除）。`GenerationMonitor.ticket/holds` 让在途生成探测的回包只落回发出时的条目，同 runId 重试重建的条目不收旧尝试的「生成中」。**取消**：`polyask:cancel` 只取消 `sending` 的站；`cancelSubmissions` 另把外壳状态为 `unconfirmed` 的站 `holdSubmission`——采集照常，但不再迟到升级。

| 场景 | 值 | 落点 |
| --- | --- | --- |
| 群发绝对 deadline | 纯文本 44s / 带图 90s | `shell-ipc.ts` |
| 辅助综合发送 | 44s，**硬编码、无带图分支** | `index.ts` |
| 辅助综合等新会话 | 22s | `synthesis-service.ts` |
| 新会话占 OperationGate 等主帧提交 | 等 `did-navigate` 而非 `did-finish-load`（旧文档的 `did-finish-load`/ERR_ABORTED 会让 `loadURL` 提前落地，提交模式下都不算数）。单站硬上限 20s：Windows 18 次实测 96–3557ms，慢网下带 Cookie 的 HTML 约 13s（原 10s 把慢页面判成失败），取约 1.5 倍。到点先 `historyAccess.abandon` 中止未提交导航并钉 `load_failed`（`stop()` 只产生被 `PageLifecycle` 忽略的 ERR_ABORTED，不钉住会停在 loading、群发打进旧会话），再报 `not_ready` 放门，外壳显示「N 站失败」（`newSessionPartial`），重载即恢复；旧文档就是首页时保留并按成功返回（见下行「中止后保留旧文档」）。辅助综合导航后立刻发送，仍等 `did-finish-load`（`ViewManager.navigate` 默认 `"load"`）。真机：到点收口与「延迟 15/18s 后放行照常 ready」的正负对照均已验证（docs/verify.md 2026-10-05 第 7 轮、10-05/06 后续核对） | `workspace-service.ts`（`NEW_SESSION_COMMIT_CAP_MS`）、`navigation-commit.ts` |
| 视图首次加载 / 重载 / 清缓存重载 / 清站点数据 | 不占门；等主帧提交上限 20s（取值同上一行）。三种重载经 `SiteHistoryAccess.reload`、首次加载（启动、重选后重建、`replaceView`）经 `SiteHistoryAccess.initialLoad`，都先挂 `ReloadCommitWatch` 再发起；到点 `historyAccess.abandon` 钉 `load_failed`（旧代码无上限，Windows 上 Claude 曾停在 loading 11 分钟以上）。视图没有已提交文档（首次加载被中止，`getURL()` 为空）时 `reload()` 什么也不发起，改为加载站点首页。渲染进程退出即解除看门（保留 `renderer_crashed`）。看门期间 `sendCommand`/`collect` 报可重试的 `not_ready`，群发在 deadline 内重试，不往将被替换或被中止的旧文档里打字。新会话/历史恢复等提交期间（`SiteHistoryAccess.navigating`）拒绝重载、后退/前进与清站点数据：Chromium 的 reload 会丢掉未提交的 loadURL、重载旧会话，它的 did-navigate 会被 `loadUntil` 当成本次提交；到点的 `abandon()`/`stop()` 解除。只管「等提交」：已拿到响应但不出帧的情形靠 `paint-recovery.ts`；Gemini 登录回跳后 `PostAuthReloadTracker` 直接调 `contents.reload()`，不经 `ViewManager`，未接此上限。渲染层重载按钮只看 phase，提交期间点了主进程返回 false、无反馈。真机正负对照见 docs/verify.md 第 7 轮与 2026-10-06 两次复验 | `reload-commit.ts`（`RELOAD_COMMIT_CAP_MS`）、`site-history-access.ts` |
| 中止后保留旧文档（2026-10-06） | 上述新会话 / 重载 / 首次加载 / 恢复到点或取消时都走 `SiteHistoryAccess.abandon(site, contentsId, target)`：若旧文档已提交地址（`mainFrame.url`，含 pushState）**恰好等于这次导航的目标地址**、是 https、且主帧 origin 与之一致（错误页 origin 不透明），说明旧文档就是目标页本身（重载同一页、本就停在新会话页又点新会话），保留并恢复 `ready`；否则（旧会话、恢复的会话地址、首次加载无已提交文档）照旧钉 `load_failed`，群发不会打进旧会话。重载的目标默认取挂门时的已提交地址，首次加载传要加载的地址。缘由：claude.ai 带 Cookie 的 HTML 长时间不回包时，每次新会话/重载都钉失败，屏幕上那份 /new 页却完好可用。新会话因保留而到点时按成功返回（`abandon` 返回 true，`workspace-service.ts` 的 `capped()` resolve），外壳不再报「N 站失败」。代价：同一页重载没刷新成功时界面显示就绪 | `site-history-access.ts`（`keepsOldDocument`）、`reload-commit.ts` |
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

**页面阶段的 `ready` = 主帧 `did-finish-load`（整页连同子资源和 load 前插入的 iframe 加载完），不是「能发了」**（`page-lifecycle.ts`，`site-view.ts` 只在 did-finish-load 调 `onReady`）。2026-10-05/06 Windows 实测（docs/verify.md「就绪判据采证」）：慢网下 Gemini 新会话可停在 loading 15–50s，而它的编辑器早在提交后数秒就已出现；群发不看 loading，照常可发；健康检查在 loading 时跳过 `diagnose`，该站显示 unknown。曾评估「输入框可用或整页加载完，先到者算 ready」：收益基本只有 Gemini（元宝约 0.6s，其余站 did-finish-load 先到），且通用 `findComposer()` 会被 ChatGPT/豆包/Gemini 的预渲染占位 textarea 骗过、须按站点只认真编辑器，**用户决定不改（2026-10-06）**，只记录语义。另：智谱遇阿里云滑块验证页时 did-finish-load 照样报 ready（页上无输入框），未处理。

改任何一格必须同时看「谁在它下游等」：站点侧的单步等待一律夹到 deadline 内，通道层 `SiteCommandChannel` 也按 `deadline - now` 起定时器，deadline 已过直接返回 `timeoutResult`。

## 5. 错误码

**main 与站点运行时只产 `code`，绝不产用户可见文案**；判定认 `code`，**绝不正则匹配文案**。翻译只有两处落点：`shared/status-copy.ts` 的映射 + `shared/copy.ts` 的三语词条。

`shared/protocol.ts` 的 `SITE_CODES`（19 个）与 `status-copy.ts` 的 `STATUS_COPY_KEY` 一一对应：

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

- 平台适配：`main/application-menu.ts` 生成系统菜单，macOS 的设置入口只位于应用菜单，保留服务、隐藏及窗口角色；现有命令绑定不变。外壳 `main/native-shell.ts` 使用系统编辑菜单，按 `editFlags` 启用操作，不接管远程站点。窗口背景在建窗与 `nativeTheme.updated` 时匹配外壳 canvas，关闭时移除主题监听。
- 外壳 `renderer/platform.ts` 集中识别平台，仅用于外观与顺序，不作为权限依据。Windows 优先 Segoe UI Variable，macOS/Linux 使用对应系统字体；`shortcut-label.ts` 只格式化可见键名，不改命令注册或搜索。Windows 确认在取消之前，macOS/Linux 相反；DOM 与视觉顺序一致，破坏性确认默认聚焦取消，IME 组合输入时 Escape 不关闭弹框。
- `focusable-controls.ts` 为局部焦点圈统一收集可见的链接、按钮、表单、summary、tabindex 和可编辑元素，过滤隐藏、禁用及折叠内容，遵守正 tabindex 顺序。历史全屏与文件夹弹框共用；门户菜单先处理退出并返回触发器。Escape 同时检查组合态和 229 键码，只拦截向外传播，保留输入法原生取消行为；图片面板普通 Escape 仍在冒泡阶段处理。
- `native-feel.css` 限制工具栏文字选择但保留正文/输入可复制，支持系统增加对比度、强制颜色与减少动态效果；`usePresence` 同步尊重减少动态效果，不保留无动画的退场等待。原生适配技能来源及研究依据记录在 `.native-feel/`，不要求架构迁移、透明材质或自动更新。
- 按钮按压采用即时静态反馈，不做全局缩放；`aria-disabled` 与原生 `disabled` 都不显示接受点击的反馈，前者仍可聚焦读取不可用原因。分页选中底板扣除容器内边距，与页按钮实际边界对齐。动态计数使用等宽数字；附件缩略图使用不占布局的中性内描边，高对比度时跟随系统颜色。细节技能的固定来源与项目取舍记录在 `.interface-polish/`。

- 顶部栏、工作台与历史入口通过 `data-hint` 提供辅助提示，`control-hints.ts` 在底部反馈条展示：鼠标悬停 350ms、键盘聚焦即时；离开、点击、输入或 Escape 后关闭辅助提示。通知与辅助提示分别显示，提示不遮住待处理通知或恢复动作，不写入任务通知或 sr-only 播报；新的可见通知清除上一通知的动作，模板撤销独立保留。

- 全页面共享底部反馈条（`WORKSPACE_FEEDBACK_HEIGHT = 32` CSS px）；主进程布局减去同一高度，避免原生站点遮挡。关闭按钮统一无边框、同尺寸图标、悬停浅底与键盘焦点环。工作台、附件及历史面板以 180ms 入场、140ms 退场，透明度与最多 6px 的 DOM 位移可中途反向；关闭即 `inert` / `aria-hidden`，退场结束后才解除原生预留宽度或历史覆盖。历史在新的确认 surface 接管后立即退出，不由迟到退场恢复站点；后台视图仍挂载并保留正视口。键盘工作台及减少动态效果路径没有退场等待。原生站点 bounds 不逐帧插值，结果库与设置保留 160ms 入场淡入。后台站点轮询只播报、不覆盖用户操作提示。群发汇总保留到用户关闭或下一项操作，复制成功提示 6 秒后收起。

- 工具栏仅在多页时显示紧凑范围分页，站点全名和状态留在提示及无障碍名称中；整轮进度通过 portal 放入已有底部反馈条，不增加常驻行或主进程高度。发送站点列表的排序按钮与标题同行，取消勾选仍保留页面。自动两站引导已撤除，命令面板手动使用指南保留。
- 单页最多 4 个站点（`shared/site-pages.ts` 的 `SITE_PAGE_SIZE = 4`）。1–4 站动态排布，5–9 站按 3+2、3+3、4+3、4+4、3+3+3 均衡分页，避免只有一站的末页。换页只改叠放次序与 bounds，不销毁、不重载、不中断生成与滚动位置。
- Overview（总览）是等权比较视图；Focus 是主次阅读视图，次要站点仍是实时可交互的 `WebContentsView`，不得降级成截图或状态卡。Overview 恢复用户保存的已选站点顺序；Focus 记住每页最近主站。
- 几何：Overview 1 站铺满、2 站左右、3 站三分、4 站 2×2；Focus 1 站铺满、2 站约 2:1、3–4 站左主右次。请求 Overview 但格宽 `<380` 或高 `<210` CSS px 时自动落 Focus（`main/layout.ts` 的 `GRID_TILE_MIN_WIDTH` / `GRID_TILE_MIN_HEIGHT`，按当前页实际站点数算）。
- 密度令牌在 `shared/display.ts`：compact = 外壳高 52 / 标题条 24 / 边距 4 / 间距 4；comfortable = 64 / 32 / 8 / 8。提问框显式展开时外壳临时升到 120（comfortable 144），附件、档位、工作台及普通失焦不收起；显式收起或非组合态 Escape 恢复，独立 surface 切换及本机重置结束本次编辑上下文。始终保留同一 textarea 的内容、选区和位置；确认覆盖及历史阅读不打断编辑。所有尺寸走 4px 基础令牌，禁止逐组件散落魔数。
- 外壳提问框及所有文字输入（包括门户菜单搜索）共用 `fields.css`：无实体灰色外边，浅底、2–4px 紧阴影及低饱和内底线，鼠标与键盘相同，复制快捷键不改变样式；错误底线、只读可复制、禁用及系统强制颜色分别保留。`composer-activation.ts` 区分明确编辑和恢复焦点：点击输入区（含已聚焦重点击）、普通 Tab 进入、聚焦命令、模板与历史回填展开；Esc/收起后，分组、布局、档位、附件、窗口及程序恢复焦点不展开，直接继续输入也保持收起。Tab 意图在其它控件取得焦点、keyup、pointerdown、窗口失焦时清除，被阻止或组合态 Tab 不算进入。取消关页保留可用原焦点，否则回工作台入口；普通 Esc 只处理当前层，IME 保留原生行为。发送回包中至少一站成功且发送时的草稿修订仍有效时，清空草稿并复用退场自动收起；全部失败、取消、提交未确认或回包缺失时不收起，已编辑的新草稿也不受旧回包影响。
- `useWorkspaceMotion` 协调 DOM 与主进程：开时先请求最终原生空间，收到 `onLayout` 的已展开位置再用 180ms 揭示输入区；收时只用 140ms 收起可见输入区，结束后一次释放原生空间。工具栏保留最终高度，不把九个网页每帧缩放或替换为截图；原生网页的布局仍在开合边界变化，不承诺整个网页网格连续插值。`composer.css` / `panel-motion.css` 的退场时长须与 `motion.ts` 一起维护，减少动态效果时取消过渡和等待。
- 页面缩放与密度相互独立：未手动调整的站点沿用 `siteScale`（`0.9` 或 `1`），Focus 主站默认 1（`zoomForSite`）。AI 页面取得输入焦点后，Ctrl++／−（macOS 同时支持 Command）及 Ctrl+鼠标滚轮按浏览器常用档位调整本站，范围 25%–500%；Ctrl+0 固定恢复本站 100%。`main/site-zoom.ts` 接收原生输入并调用 `webContents.setZoomFactor()`，不向远程页面暴露接口；手动比例优先于布局默认值，开关侧栏、翻页、切换 Focus、导航和视图重建均不覆盖。快捷键速查三语列出放大、缩小、恢复及滚轮说明；外壳取得焦点时仍沿用菜单的外壳缩放。
- 命令栏一条通用：Overview、Focus、窄窗共用同一套控件优先级。始终显示提问框、档位、发送/取消、站点名、是否参与群发与运行状态；空间允许时显示布局文字与选择数量；聚焦、重载等站点动作常驻标题右侧，后退仅在有可退历史时出现。紧凑模式交互目标不小于 24×24 CSS px，检测到粗指针切 comfortable。
- 颜色与文字令牌集中在 `renderer/theme.css`，表面分为 canvas/panel/field，强调色配套 on-accent 前景，状态文字用独立 ink 色以保证明暗可读性；品牌沿用靛蓝：亮色 `#4f46e5`、暗色 `#a5a0ff`，成功 `#16a34a`、失败 `#dc2626`，其余用系统中性色；字体 `system-ui`，不捆绑字体。站点标题条按选择标签、状态圆点与文字、常驻操作排列；加载时底边显示不定进度细线，由真实 loading 阶段驱动，就绪或失败即停止，不显示估算百分比，减少动态效果时显示静态细线。不加装饰渐变与无信息动画。布局切换不为原生视图 bounds 伪造动画。
- 阅读空间优先，命令栏保持单行：发送按钮显示目标数，窄窗保留图标与数字，完整操作名由三语 `aria-label`/提示提供；采集并比较和结果库始终使用等宽图标按钮。1400px 及以下的窗口分页将范围与状态符号分行，完整状态数量保留在提示及可访问名中，重试显示图标与数量。结果库阅读正文用 16px / 1.8、对照正文用 15px / 1.8，代码块用 13px；设置页辅助说明至少 12px。结果库来源导航在详情区大于 480px 时换行，更窄时横向滚动；设置页 980px 及以下切为单列，操作按钮自然换行。不改变原站网页字号。
- 应用菜单提供聚焦提问框、上/下一站点、上/下一组站点；`Alt+1`/`Alt+2`/`Alt+3` 直达站点页（不存在的页码保持当前页），`CmdOrCtrl+Shift+PageUp`/`PageDown` 顺序换页——焦点进入原生站点视图后要能回到外壳。Windows/Linux 菜单栏默认自动隐藏、按 `Alt` 临时显示；macOS 用系统全局菜单。

## 7. 数据边界与本机数据管理

- 生产结果库列表通过受信 `polyask:folder-query` 返回分页摘要、总数和有效选择，回答正文及决策表单正文按选中 ID 读取。文件夹归属、关键词和状态筛选在 SQLite 执行；日期排序用 LIMIT/OFFSET，标题排序仅扫描 ID/标题窄投影并按语言排序。跨页选择不能按当前页裁剪；旧完整查询用于兼容，不作为生产列表路径。摘要是只读投影，不新增持久键、不改变同步线格式或备份。

- 引文报告复用辅助综合的 instruction/text 字段和保存替换流程，不新增持久键。`answerSourceId(index)` 从结果快照的原始数组位置生成 `[S1]` 等编号，页面、发送载荷与导出一致；选择子集不重编号。载荷明确截断或完整性未验证，报告预设要求逐字摘录并区分推断；应用不将模型引文标为已验证，也不自动将模型输出解析成可信引用。未来若允许修改/重排原始回答，必须先迁移编号语义。

- 模板删除先在外壳内等待 6 秒（跨页面保留撤销入口），到期才调用原有 tombstone 删除；撤销不写数据库，不新增持久键。等待期间退出应用保留模板。

- 本机库是 `app.getPath("userData")/polyask.sqlite`（Electron 内置 `node:sqlite`），WAL、外键、参数化仓储、事务 outbox。SQLite user_version=3，增量新增 folders / folder_memberships 表，不改旧记录。表：`history`、`archives`、`decisions`、`folders`、`folder_memberships`、`state_items`、`outbox`、`drive_files`、`meta`。
- **本机界面状态与可同步偏好分开保存**：窗口范围、最大化、当前页、每页焦点仍仅保存在 `desktop-ui-state.json`，不跨设备同步。布局与逐站缩放从旧文件迁移到偏好库后由库决定有效值，文件仍记录本机视图快照。恢复窗口限制到可见显示器；不恢复临时抽屉、确认框或执行进度。
- 共享偏好使用 `state_items` 的 `preference:<key>` 和 state schema 1 的 `polyask.preference.<key>` setting，每键独立版本；通知与引导状态共享，显示密度/默认比例、默认布局、各站手动比例分别可选跟随同步。`meta.devicePreferences` 保存本机覆盖与三个跟随开关，默认均为本机覆盖；不投影、不备份。旧 localStorage 和 UI 文件只补缺失值，已有共享通知/引导不被旧缓存覆盖；旧缓存共享种子用 updatedAt=0，后来到达的有效云端版本优先，用户显式保存取得当前单调版本；晚到显示迁移仍保留本机覆盖。只有用户明确选择布局才修改默认布局，辅助发送临时聚焦不写入默认值；远端布局应用不抢键盘焦点。
- 草稿使用 `state_items` 的 `draft:<id>` 与 schema 1 setting `polyask.draft.<id>`，格式 1；种类为问题、人工比较、决策、综合（含独立追问上下文）。表单不含执行中状态或完整回答副本，每设备/种类/上下文独立分支。`meta.draftSyncEnabled` 默认关闭，只在开启后投影与接收草稿；关闭保留既有云端内容。编辑器自动保存本机，恢复先预览并核对来源，脏稿替换需确认，远端变化仅刷新候选副本。成功发送/保存按草稿 ID 和版本删除，不删之后新编辑；重置和清空使 IPC epoch 失效，旧保存不可复活被清数据。墓碑清空正文但保留身份，重新编辑产生新 ID。
- 新键登记：`preferences-repository.ts` / `draft-repository.ts`、`sync-preferences.ts` / `sync-drafts.ts`、`database.resetLocalData()` 清空 state/meta，以及只增 fixture `schema1-state-preferences.json` / `schema1-state-drafts.json`。无需修改 SQLite schema；凭据、窗口与瞬时焦点保持本机。
- **删除一律 tombstone**：写 `deletedAt` + 入 outbox，不物理删。`DataAdminService` 的「清空历史」「清空结果库」「清空决策卡」「清空任务文件夹」「清空草稿」走的就是这条正常路径，删除会同步到其它设备——否则其它设备会把记录同步回来。
- **「重置全部本机数据」是本应用唯一的物理删除路径**，语义刻意不同：先 `sync.disconnect()` 断开 Drive，再 `database.resetLocalData()` 物理清空十张业务/同步表并只保留 `meta` 里的 `deviceId`。这里**不能用 tombstone**——tombstone 比云端记录新，重新连接后会赢过云端副本并上传，等于把云端也删了，与「重置不会删除云端数据」的承诺相反。`deviceId` 保留是因为本机在云端的旧 fragment 靠它找回，换掉会让重置后首轮上传把本机不建模的设置键整体丢掉。改这两条语义之前先改用户可见的承诺文案。
- Drive 同步：scope 固定 `https://www.googleapis.com/auth/drive.appdata`，全部操作限定 `appDataFolder`。旧实体沿用 `SYNC_SCHEMA = 1`：每设备一个 state fragment、每设备/文本哈希一份 history、每条结果库记录一份 archive；按 `updatedAt` 后 `deviceId` 合并，同时刻 tombstone 优先。独立 decision 实体采用 schema 2，文件夹和关联实体采用 schema 3，`SUPPORTED_SYNC_SCHEMA = 4` 表达客户端可识别的最高版本；state/history/archive 仍仅接受 schema 1，不将未知的 state schema 2 冒充可兼容。遇不支持格式进入同步只读，仍可下载可识别文件但禁止上传。
- 出箱仍有记录时保持 `waiting`，不把“暂未到期”当空闲。按最早 `nextAt` 唤醒，限流遵守退避与 Retry-After；旧失败只更新相同 revision，不覆盖上传期间的新修改。断开或销毁取消定时器并使排队任务失效。
- **站点顺序同步**：SQLite 复用 `workspace.selectedSites`，不新增业务键或 schema；`sync-repository.ts` 将顺序投影成 state fragment 的 `amsConsole.siteOrder` 主机名数组，与 `amsConsole.selected` 同时写入相同版本。拉取只采用与勾选版本一致的顺序，过滤未知/重复/未选项并按默认顺序补齐缺项；旧客户端更新勾选而保留旧顺序时回退默认排列。上传保留远端未知站点的勾选与顺序字段。分组 `hosts` 数组保序。备份沿用既有 workspace/group 字段，`resetLocalData` 随 `state_items` 和 `meta` 清除本机顺序，重连可从云端恢复；冻结兼容样本为 `desktop/test/fixtures/schema1-state-site-order.json`。
- **发送站点勾选同步**：SQLite 的 `workspace.participation` 保存站点集合、独立 `updatedAt` 与 `deviceId`，经受信 `set-participation` IPC 写入 workspace 并入 outbox；修改档位、打开页面或排序不改勾选版本。Drive state schema 1 新增 `amsConsole.participating` 主机名布尔映射，保留未知站点的 true/false；缺字段兼容旧数据默认已打开页面全部参与，明确空映射表示零站参与。非布尔载荷不采用；已有有效本机偏好时保留，无有效偏好时采用空集合，不能把字符串 false 当启用。当前客户端整体合并此偏好，冲突按既有时间戳、设备 ID 裁决。
- **勾选确认与恢复**：界面等待页面打开与勾选保存各自回执，保存期间阻止发送；独立版本阻止旧回执覆盖较新推送，保存失败立即恢复最近权威状态。云端推送只更新后续发送范围，原轮与重试仍用冻结的范围。关闭页面只从有效范围排除它，期间编辑其它站点仍保留关闭页的偏好；重新勾选会先开页再保存。旧客户端可透传此设置但不会显示或应用它。备份 workspace 包含偏好与版本、不含设备 ID；提供偏好的备份恢复重记本机新版本，旧备份缺字段时保留现有独立偏好与版本。`resetLocalData` 随 state_items/meta/outbox 清除，重连可由云端恢复；固定样本为 `desktop/test/fixtures/schema1-state-participation.json`。
- 加密 refresh token 先写同目录独占临时文件（0600），完成写入、同步与关闭后原子替换；失败清理临时文件，保留原令牌文件。无安全加密后端时仍仅保留进程内令牌。
- 结果库过滤在 SQLite 执行，保持既有 searchText 的大小写与字面搜索语义；标签独立查询，不再为标签加载全部回答。历史每页批量读取尝试摘要，正文仍只随选中详情返回；不新增数据库字段或同步格式。
- **schema 1 的线格式冻结在 `desktop/test/fixtures/schema1-*.json`**（每个文件 `{file, body}`，出自扩展时代的真实实现，代码保留在 tag `archive/extension-v0.25.1`）。**不要重新生成、不要按新校验「修正」它们**：`schema1-wire-format.test.ts` 把全部样本喂进下行链路并要求逐条接收，任何一次校验收紧命中存量形状会先红在那里，而不是在用户的结果库里静默少几条。新增决策卡 schema 2 另增 `schema2-decision*.json`，文件夹及关联 schema 3 另增 `schema3-folder*.json`；旧实体仍为 schema 1，冻结样本不变。
- **两条跨端不变量**（跨设备记录要能互认，改一端就是让另一端拒收）：
  1. **提问在派发之前无条件入库**——`shell-ipc.ts` 的 `history.record(request.text)` 先于 `coordinator.send`。请求校验、图片站点支持检查、操作互斥及 `collection.beginRun` 的过期轮次检查都在记录之前，被这些检查拒绝的请求不入库；**全部站点都失败的提问照样留记录**，这是有意的（用户要能重发）。
  2. **结果库字段上限按码点计、两端一致**（`shared/archive.ts`）：`title` 512、`instruction` 4000、`note` 4000、`host`/`label`/`winnerHost` 256、预览 `text` 320、`state`/`code` 64、单个 `tag` 32、`tags` 数组 20 项。`title` 与预览**截断**，其余**超限即 throw**。新增字段必须同时进这张表，否则表现为「某台设备的记录同步不过来」。
- 上传图片不再自动打开管理区；只保留顶栏数量入口，警告以同一入口圆点及提示显示。点击后临时使用工作台侧栏宽度，关闭即归还；与工作台、历史入口互斥，输入框展开仅由编辑状态决定。保留完整缩略图、文件名与独立删除按钮，更换为整批替换，关闭后焦点返回入口。
- 图片限额：单批最多 4 张 PNG/JPEG、合计不超过 10 MiB（`shared/images.ts` 的 `MAX_IMAGE_COUNT` / `MAX_IMAGE_BYTES`）。**改任何一个数，代码 + 三语词条 + README/docs 叙述的全部落点要一起改**，清单与当前数值以 `scripts/test-image-limits.js` 的对账项和 `docs/adapters.md` 的「图片载荷」为准，别凭记忆列。
- 便携版：根目录 `portable.json` 识别发行形态，`userData` 与 `sessionData` 都切到同级 `PolyAsk Data`。根目录固定分为可替换的 `App` 与持久的 `PolyAsk Data`，升级只替换 `App`。首次运行才询问是否从系统默认目录复制旧资料，复制走旁路暂存 + 重启后切换，失败保留旧资料；复制出的 profile 获得新的同步 `deviceId`，避免用户回退旧版后两个客户端覆盖同一份云端状态。设置页只拿到裁剪过的版本号与发行形态，不暴露本机用户数据路径。

## 8. 站点健康与诊断报告

- 左侧工作区的「站点状态」标签页（命令 `open-site-health`，`Alt+H`）做只读健康检查：**只调 `state`、`diagnose` 等只读契约，不开菜单、不切档、不写输入框、不触发发送**。
- `diagnose()` 每条检查必须带 `kind`（`shared/site-health.ts` 的 `SiteCheckKind`）：`reach`（到不到得了站点）/ `control`（关键控件在不在）/ `tier`（当前档位读不读得出）/ `probe` / `capture`（会话页上第 ① 级采集选择器能否定位末条提问与回答根，见 docs/adapters.md「定位分级」）。缺省与未知值一律按 `control` 处理（fail-loud），漏标一处只会被归成 `control` 继续误报。
- **只有 `tier`、`capture` 之外的红项决定站点可用性**（`checks.filter(check => !isAdvisoryCheck(check))`）。各站 `state()` 是刻意的偏函数：用户停在非预设的合法档位时可能返回 null，那不是故障；部分组合会被粗判归入 think/fast，精确边界见各站卡。`tier` 红项仍在详情页以提示显示。`capture` 红只说明提问历史副本的选择器漂移，群发照常可用，同样只提示。
- 判定口径：只有站点给出明确登录证据才说「需要登录」，无法可靠判断一律「无法确认」，不拿 URL 或页面外观猜。单站正在发送或重载会破坏当前任务时禁用「重新加载」并说明原因。
- **可复制诊断报告**（`shared/site-report.ts` 的 `buildSiteReport`）是切除扩展后唯一的结构化报障入口，**不得只可见不可复制**。内容边界：版本 / 发行形态 / 平台 / 显示缩放、每站的 `phase`+`code`+健康结论+`checkedAt`、每条 check 的 `{name, kind, ok}`、白名单进程类别/退出原因/数值错误码，以及每站 `capture-locate selector=… semantic=… anchor=…`、`capture-reason …=数字` 与 `capture-slow-observer N` 行。原因仅取 `CAPTURE_REASONS` 固定枚举；卡顿数为 historyTurn 单次超过 250ms 的 MutationObserver 回调次数。三类均为主进程内存计数，经 `polyask:capture-locate-counts` 读取，只认白名单枚举键与正安全整数，读取失败仅省略该行。**绝不包含对话内容、URL、账号、路径、token 或消息 key**——`check.name` 是本地化的 `diag_*` 词条不是页面文本，站点只写 key 与产品名不写 host。Drive 连接诊断另在设置页，同样走负向泄漏约束的白名单快照。

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

比较可就地展开，原文、两列比较及补充分析仅挂载当前面；各面和每个来源的阅读位置在会话内保留，换记录或明确新导航使旧上下文失效。人工对照按结论/依据/条件/成本保存会话内笔记和逐字来源，变化的来源需重新核对，笔记仍保留；形成决策仅填入草稿，用户明确保存才写库，不把字面相同或人工共识标为事实。

### 独立决策卡数据契约

- 编辑器按字段显示必填、长度、定稿结论和摘录校验错误，字符计数按 Unicode 码点计算；保存时聚焦首个错误，修改后即时更新提示，保存失败保留输入。来源未加载时只允许同一结果记录中未修改的已存摘录；客户端提示不替代主进程的原文核对。

- `shared/decision.ts`：DecisionRecord schema 2；标题≤160，结论/理由/待核实/下一步各≤4,000，证据≤9份、resultIndex唯一且0–8、逐字摘录≤4,000。每卡只有一个 archiveId，更新不可改来源；多张卡可引用同条结果。来源显示标题快照≤320、host/label≤256、id/deviceId≤128，均按码点；时间为非负安全整数。
- 状态只允许 `draft` / `verify` / `final`；`final` 必须有非空结论。标题与 archiveId 必填，证据摘录不能为空；`updatedAt` 不得早于 `createdAt`。
- 证据只由主进程从保存原文核对并补入 host/label/capturedAt。删除来源后保持独立卡片与原摘录；来源查不到时文案同时说明可能尚未同步，不把“未找到”武断视为已删除。可以修改决策正文和移除证据，不能伪造缺失来源的新摘录。所有删除/清空来源的确认提示说明摘录保留。
- 新实体 `decision:<id>` 独立 outbox；import 按 updatedAt/deletedAt 与 deviceId 整卡合并，版本与设备完全相同的 tombstone 优先。更新和删除时间单调增加；本机重置删除 decisions 表内容，保留 deviceId，断开 Drive 后执行。
- 旧客户端读取远端 decision schema 2 会沿用 future-schema 保护停止上传；新版若发现先前跳过的可支持格式则全扫补拉。已有只读锁只能在该文件成功导入或 listing+changes 确认其已删除时清除；文件损坏/下载解析失败不能解锁。持续存在的不支持 state schema 2 会保持只读并重复扫描，正常 decision 补拉后恢复增量。

### 任务文件夹契约

- 文件夹为单层，多对多关联结果和决策卡；不复制内容、不自动带入来源。名称去首尾空白，1–80 个 Unicode 码点，禁止控制字符；同名允许，id 区分。结果库采用文件夹导航＋混合列表＋阅读详情，主工具栏保持单行；窄窗口先收起文件夹，专注阅读临时隐藏导航和列表，不持久化。结果详情分阅读、对比和综合结果，比较根据详情容器宽度收为单列。标签备注显式保存，未保存时沿用导航确认；外部 Markdown 链接只经 shell 的可信打开通道。
- 标签按中英文逗号拆分并去首尾空白，原始非空数组最多 20 项、每项最多 32 码点，不先去重绕过服务上限；编辑器显示逐项计数、具体错误和失败保稿。归档弹框复述完整对象类型与标题，空态可就地创建合法文件夹，创建成功仅选中，最终保存才写关联；取消关联保留已创建文件夹。创建后使旧列表读取失效并重新刷新，不能被迟到空快照覆盖。
- `shared/task-folder.ts` 定义 schema 3 的 folder / folderMembership。folderId / targetId / deviceId 不超过 128 个 UTF-16 代码单元（`String.length`，不同于名称的码点计数）且不得含控制字符；关联以 folderId 长度前缀、targetKind 和 targetId 生成确定性 id，复合关联 id 不套 128 限额；每条关联独立版本，renderer 仅提交本次多选的差异，避免覆盖别的设备新增关联。
- 文件夹删除为终态，迟到的重命名不复活。关联按版本时间/deviceId 合并，同版本删除优先；可显式重新加入仍存在的文件夹。删除文件夹及本机已知关联写 tombstone＋outbox，保留结果、决策卡与其他文件夹关联。未知/已删除目标不展示；乱序到达的关联仍保留，待文件夹和目标拉到再显示。
- Drive 新实体文件名和元数据 id 使用正文 id 的 SHA-256，拉取校验哈希后按原 id 建索引；不放标题和摘录，避免复合或 Unicode id 超出 Drive 属性长度。schema 1/2 冻结 fixture 不改，新增 schema 3 样本。
- 数据迁移新增两表与索引，清空文件夹保留内容，清空结果或卡片保留文件夹。本机重置清两表，仍先断开 Drive 并保留 deviceId。文件夹界面与多选对话框不新增持久 UI 设置。
- UI 搜索覆盖正文和摘录；编辑为显式保存，失败保留内存草稿。工作区切换和全局命令经过未保存确认；确认默认取消、Escape关闭、焦点圈定。应用异常退出不承诺恢复尚未保存的编辑。导出为单卡 Markdown，不等同于可恢复备份。
- 混合列表搜索仍查询全部记录，前端稳定排序并每页显示至多 100 条，明确总数和范围，键盘可到最后一条。多选以 `kind:id` 区分对象，当前页选择与跨页数量可见；批量加入文件夹只添加关联，收藏仅对结果，混合导出保留各对象完整 Markdown。沿用已有单目标 IPC 串行处理，停止后等待当前请求结算、不启动下一项；部分失败可人工只重试失败项，导出不产生缺项文件。第一项 IPC 前同步阻断父导航，卸载后不继续写入或下载。
- 筛选后的选中记录仍匹配时保留阅读，最新回包排除记录时也须经过当时的未保存确认；发起新的导航意图即作废旧回包，确认时再核对请求、意图及选择。会话内只保存筛选、排序、页码、列表滚动和阅读标识，不缓存全部正文或持久化多选；返回重新取最新记录，删除、明确导航及本机重置不复活旧阅读。

### 业务备份与恢复契约

- `BackupService` 导出有效 history/archive/decision/folder/folderMembership/template/group/workspace/question/questionAnswer/preference/draft，独立 `polyask-backup` version 3（兼容读取 version 1 和 2）；不包含凭据、Cookie、设备身份、同步游标或 outbox。JSON 上限 32 MiB / 20,000 条。字段白名单及现有实体校验共同拒绝损坏数据，不导入删除指令。
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
- 已打开站点保留页面会话，不参与群发不回收；明确关闭且监控/采集具备结束证据后事件触发回收。监控连续 5 次读不到状态或到达 45 秒／15 分钟观察上限时显示 `generation_unconfirmed`；若采集在固定 15 分钟预算到期仍无结束证据，页面继续保留，以免关闭可能仍在生成的回答。已打开站点休眠及新的后台可见性策略尚未实施，需单独决策与真机验证。

### 提问历史存储与同步基础

逐次提问采用独立 `question` 和 `questionAnswer`（每站每次尝试）schema 4，SQLite version 4 新增 questions/question_answers。相同文字不同发送不合并，重试保留独立尝试；自动副本上限 200,000 码点，不改变手动采集上限。父子删除为终态 tombstone + outbox，迟到子记录遇已删除父立即转为 tombstone；本机重置清新两表且保留 deviceId。旧文字 history 仍为 schema 1。

Drive 新两类文件名/属性 ID 使用正文 ID 的 SHA-256，不带正文或会话 URL；最高支持 schema 4，旧实体保持原格式。业务备份导出 version 3、兼容读取 version 1 和 2；子记录依赖父记录，缺依赖不能静默恢复。恢复已删除提问派生新身份并映射选中的副本，重复导入不复活再次删除的内容。


提问历史 IPC 由 `question-history-ipc.ts` 注册并验证外壳身份；renderer 不接受任意导航地址，恢复只提交记录 ID / 尝试 ID，再用主进程生成的一次性预览令牌执行。实际导航前再次核对记录、站点选择及视图身份，受 OperationGate 保护；最多两站并发、单站 20s、总计 30s，缺地址不导航首页。快照轮询每 5s 启动，最多两个只读探针并发，探针 2.5s；提交成功或提交不确定的结果就绪后固定观察 15min，不依赖早期生成控件，后续进度不顺延；归属不明确时仅观察，不保存正文或地址。明确归属终止、取消或删除仍提前封存；未显示答案的记录可能等待完整观察期才标为未取得副本。切换会话前尽力在 2.5s 内保存：先等待在途采集；旧轮未覆盖的新 token 在同一剩余预算内补采，到期不阻塞导航。中间副本入 outbox 延后 30s，封存或首次文本立即可上传。运行时不把停止键缺失或正文静止当完成证据，无法正向确认结束的副本保留“完成状态未知”。“完整回答”唯一来源是外壳 `GenerationMonitor` 的收口确认（`onComplete`，`view-manager.ts` 的 `onGenerationComplete` 由 `question-capture-binding.ts` 接到 `QuestionCaptureService.complete`）：只认同 runId 且本次尝试已回包的条目，确认后立即补读（在途轮结束后马上再读），确认之后开始的归属、未结束、非生成中、带正文且未截断的快照先记候选，候选回包 ≥3s（`SEAL_QUIET_MS`，`question-history-service.ts`）后才开始的另一次读读到逐字相同的正文才封存为 complete（增长否决，防元宝草稿隐藏停止键的误收口与停止键消失后的尾部续长；采集服务按 `sealDelay()` 提前排复读）；没带读序号的快照不算确认之后；封存后不再被追问、取消或后续快照改写。不新增持久化键、不改 schema。

右侧历史面板宽 360 CSS px，与左侧面板互斥。共享最小站点列宽决定窄窗全页；阅读副本/确认操作时原位置隐藏原生站点视图，保持挂载、正尺寸与既有禁用后台节流设置，退出恢复可见性（BrowserWindow 默认外壳不是可重排子视图）。历史卡片点击始终读取副本；恢复原站走独立按钮，忙碌时仅保留阅读和复制等只读操作。结果库 surface 会 detach 站点视图，因此其顶部入口仍在发送/辅助操作期间禁用并说明原因。列表只传摘要和尝试元数据，正文仅按选中尝试读取；旧文字历史独立查询分页，顶部提问库的最近文字行为保持不变。错误提示由三语 `question-copy.ts` 提供。

历史再问只恢复文字，原图片不入库或同步；详情和列表显示请求附图数量（不等同于成功发送数量）。恢复带图问题或替换有附件的草稿须提示确认，并清除当前草稿附件与尚未完成的选图读取，防止与历史文字混用。

历史与结果库共用 `markdown-it` 分词、React 白名单元素渲染，禁止原始 HTML；URL 显示投影不修改快照或完整目标。纯 URL 标签从文字、简单强调/行内代码格式及换行中识别，裸域名沿用 linkifier 的整串匹配，不要求显示地址与目标相等。空标签、超长 URL 标签及带文字定位片段的 URL 标签按实际目标显示域名＋有限路径，可展开并复制完整地址；有意义的标题及独立代码里的 URL 原样保留。详情只保留副本信息下的一条工具栏：左侧「在应用中打开」传当前回答 ID，旁边菜单不传回答 ID，恢复本次提问各站最新尝试的会话；保留既有导航预览与确认。复制链接、系统浏览器打开及复制回答均为图标，取当前站点/尝试的地址或正文；缺失/不安全地址禁用会话操作，无地址仍可复制已存正文。右侧再次提问填入原问题，更多菜单删除整条提问及副本，保留确认。群发忙碌时仍可阅读、复制与系统浏览器打开，禁用应用内恢复、再问及删除；切换站点/尝试关闭旧会话菜单，Escape 只关闭菜单并归还焦点，窄窗口按两组换行。图表、链接文案三语在 `reading-copy.ts`，历史操作在 `question-copy.ts`，均并入 `DesktopCopy`。

Mermaid 仅在需要预览时加载本地依赖，串行绘制、最多缓存 12 个结果，strict 安全级别与禁用 HTML 标签固定；回答配置指令不参与绘制。源码超过 20,000 字符、按换行/分号/`&` 保守计算超过 250 段（标签内也计数）、边数超过 200，或生成 SVG 超过 2 MB/视框超限时退回源码。复杂度在布局前检查，单行大量孤立节点也不能绕过；离开回答后尚未开始的任务跳过。生成图经本地 SVG 检查后作为 data 图片展示，外壳不插入原始图表 HTML；错误、源码缺失、超限明确提示，复制始终取原始源码。预览支持代码切换和 0.5–3 倍缩放，图表区域自行滚动。源码变更/组件卸载后迟到结果不覆盖新内容；旧副本中有 mermaid 围栏即可预览，已丢失源码的旧副本不会自动补采。新增依赖的兼容修补版本以 package/lock 的 overrides 固定（lodash-es、KaTeX），生产依赖审计须检查；不新增数据库键、同步 schema 或采集完成证据。

分页发送统计：`SiteStatus.submission` 是运行期发送结果（runId/state/code），仅群发入口赋值；生成态更新保留它，页面故障仍覆盖站点表头但不覆盖发送结果。新 run 清除上一轮计数，同 runId 子集重试保留未重试站结果。生成监控同理：`GenerationMonitor.begin` 遇同 runId 时把**被重试的站**重置为 submitted、清掉旧的生成证据，未重试站的条目保留（2026-10-04 起；旧逻辑跳过同 runId 条目，Windows 实测重试后 1.2s 即显示 complete）。已知残留：重试时上一轮的生成探测若仍在途，回来后仍会被新条目接收，条目没有身份标识。分页绿色计数表示已提交，不宣称回答完成；失败、提交未确认、取消分别显示，逐站生成态与警告进入共享悬停提示和无障碍名称。该字段不持久化、不进入同步。

整轮摘要另使用 `SiteStatus.generation` 的 runId/state 与每站最新保存尝试元数据，严格区分已提交、生成中及完整副本。`question-run-progress` 为受信只读 IPC/事件，SQL 仅取至多九站的 ID、状态、版本及正文是否存在，不加载正文/会话地址、不新增轮询；删除和重置也推送最新摘要。完整副本必须非空、未截断、采集 complete 且已封存；pending retry 不继承旧生成。推送优先于迟到 get、新轮/卸载/重置隔离旧回复。摘要放在已有 32px 底部状态条，读取按钮固定在进度区右端，提示切换不移动按钮；原生视图仍只预留该反馈高度；工具栏分页显示紧凑范围、完整站名提示及异常数量。阅读入口传准确提问/尝试 ID，只读已保存副本。

首次两站提示与自动引导已移除，命令面板的手动使用指南保留。旧指南字段仅作为本机界面设置兼容读取，生产界面不再触发相关导航或完成记录；成功本机全重置仍清除旧字段，SQLite/Drive/schema 不新增键。

代码围栏先显示原代码和语言，逐块复制保留制表符和末尾换行，按需开启有限高亮；未知语言仍可完整复制。数学先显示完整源码，用户预览才在本地单 Worker 中解析，750ms 超时、4,096 字符/32 层/256 次展开界限及 `trust:false`，结果只接受有限安全 MathML；失败、超限或不支持保持源码，忙碌可手动重试，旧来源/卸载后的回复不回写。块公式缺少闭合标记的扫描按解析 state、容器行偏移及结束范围复用未命中，包含 paragraph silent lookahead，避免反复遍历全文；代码围栏、链接标签、货币及未闭合显式标记保持字面。正文未变化的父重绘复用组件内解析结果，不建立无界跨记录缓存。

历史列表每 5s 重读至已加载尾部，反映新增、删除与回答保存进度；以可见记录为滚动锚点。列表或详情请求未结束时不叠加轮询；返回、关闭、切换或删除使旧详情回包失效。

历史正文区分加载、读取失败、记录缺失和没有副本，失败可重读当前尝试。当前会话内按提问/站点/尝试保留阅读位置；隐式记忆的尝试已删除时回到本站最新尝试，显式传入的尝试不存在则报缺失。长原问题先显示摘要，展开按钮与标题同行；复制原问题位于右侧主工具栏，以无障碍名与提示区别回答复制。菜单图标居中，删除分隔线仅出现在普通操作之后。保存到结果库只提交提问 ID 与每站至多一个尝试的 ID/updatedAt；受信 `question-archive` IPC 在主进程重新核对未删除记录、归属、版本及非空保存正文，再生成新结果，source 为 null，不采当前网页或接受 renderer 正文。缺失/变化先重新读取并人工勾选，比较至少两站；结果可继续加入现有文件夹。新收集/比较目标覆盖先前历史目标，忙碌或迟到保存回包不能导航。

重试只对明确提交前失败使用默认批量入口。提交未确认、超时、未知/缺失回包及取消都需先查看本站，再逐站勾选确认；取消不证明未发送。核对/查看动作不发送，重试仍使用原 runId/text/tier/images。查看时核对最新选择，本站未选则不聚焦其它站、不自动改范围，具名提示人工重新选择也会加入后续群发；查看经受信 inspect-site IPC 在同一主进程事件内核对并聚焦，严格 true 回执才切回站点；拒绝或异常显示具名提示，等待回执期间核对框与根层命令保持锁定。已作废轮次的迟到回执不再导航。重新打开页面不作为未提交证据。执行时重新读取本轮结果，迟到同轮可信 sent 只升不降并移除重试选择；新轮和本机重置使旧选择失效，不改主进程重发策略或预算。

设置集中既有显示密度及站点默认比例，仅应用主进程接受的值，与菜单推送共用状态。高级数据操作默认折叠，可通过显式设置命令定位。清理确认的 `local-data-stats` 是受信只读单条 SELECT 快照，区分分类附带记录与 reset 的全部本机范围；执行前重读，相关数量变化须再次确认，执行结果以真实返回条数为准，两次 IPC 不构成原子快照。可先定位备份导出入口。破坏性本机/云端写入前同步阻断关闭与根层命令，成功或失败后释放；迟到重置结果不能清新会话。诊断按机器 kind/code 推荐安全手动首步，更明确的忙碌/未确认/登录/页面与控制证据优先，未知失败要求检查，旧健康快照不能宣称新失败已恢复；其它恢复操作按需展开，不自动重载或重发。

## 实验：最小化空闲节流（默认关闭）

仅启动命令显式设置 `POLYASK_IDLE_THROTTLING_EXPERIMENT=1` 时启用，不增加持久化键或用户设置。`runtime-gates.ts` 装配 `idle-throttling.ts`，纯策略在 `idle-throttling-policy.ts`。每 5 秒检查一次，仅在原生 `isMinimized()` 为真、所有已挂载站点正尺寸且未加载、外壳阶段均为 ready/complete、逐站生产 generation 回包均为 idle/complete/complete_observed 时，才对所有站点允许 backgroundThrottling。每个探针限 2.5 秒；提交未确认、未知、失败、取消或任一站生成中均不准入。异步返回后重验窗口、epoch、成员和阶段。

恢复/show 同步关闭节流。所有 submitPrompt 命令在通道 dispatch 前通知控制器并同步关闭全部站点节流；订阅按当时的视图成员核对，不能依赖周期登记，否则新建视图首个提交会漏唤醒。加载、主帧导航、同文档导航和视图增删也关闭节流；这些动作若发生于最小化期间，锁住直到下一次 restore/show。关闭窗口或释放控制器时清理监听、定时器、待回包及已设置的节流。默认关闭时不注册实验监听、不添加轮询。

这是采集证据用的实验分支，不承诺 CPU/内存收益。当前生成状态仍依赖站点 DOM，不能据此默认启用；不能以隐藏窗口实验替代原生最小化、用户后台操作或跨平台验收。
