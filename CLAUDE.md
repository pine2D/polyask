# PolyAsk · AI 众答

PolyAsk 是 Electron 桌面应用：同一问题群发到 9 个真实 AI 站点并排比较。**切档可报错，群发不能断。** 仅发五个未签名 Desktop 包；Chrome 扩展已停维并删除（tag `archive/extension-v0.25.1`）。

<!-- 最后与代码核对：2026-10-10 · desktop/package.json v1.17.0。发版前重核并更新。
     本文件 ≤11 KiB；新增硬约束先精简或外迁 docs/。 -->

## 按任务读取专题文档

| 你要做的事 | 先读 |
| --- | --- |
| 动 `desktop/src/site-runtime/`：注入/提交/切档/汇总、站点、图片、页面改版 | `docs/adapters.md`（契约、站点卡、图片限额、改版剧本） |
| 动 `desktop/src/{main,preload,renderer}/`：视图、IPC、预算、错误码、数据与同步、安全、布局 | `docs/desktop.md`（进程边界、预算表、错误码全表、数据边界） |
| 写回归测试、Desktop 开发态真机复现、负向对拍 | `desktop/AGENTS.md` + `docs/verify.md` |
| 发版/tag、改用户文案或三语词条、Release 正文 | `docs/release.md`（含 i18n 落点表） |
| 动 Drive OAuth 客户端、凭据注入 | `docs/desktop-oauth-security.md` |

**冲突以本文硬约束为准**，同步修正文档。站点 DOM/时序写 `docs/adapters.md`，工具与环境写 `docs/verify.md`。

## 硬约束

- **提交不确定 ≠ 可以重发**：命令超时、无回包、`submit_unconfirmed` 一律原样交给用户点 retry。**只有**实现了只读 `adapter.submitted(text)` 的站（目前仅 Kimi）、且 `wasSubmitted` 回包 `supported:true, ok:false` 明确确认「末条用户消息不是本次内容」，才允许自动重发一次；这条分支由 `broadcast.ts` 的常量 `POLYASK_KIMI_RESUBMIT` 拦着，**默认 `false`，F067 两条真机硬用例通过前不得打开**。回包形状不对一律按不支持处理（`normalizeSubmitted` fail-closed）。给没有 `submitted()` 的站加自动重发 = 同一个问题被问两遍且用户无从察觉。
- **删除一律 tombstone**：写 `deletedAt` + 入 outbox，不物理删；清空历史/结果库也要留标记，否则其它设备会同步回来。**唯一例外是「重置全部本机数据」**：先断开 Drive、再物理清空本机库并保留 `deviceId`（tombstone 比云端记录新，重连后会赢过云端副本并上传，等于把云端也删了）。本机重置不删 Drive 数据；要改先改承诺文案。
- **实测阈值留 ≥20% 余量**：`findComposer` 高度用 `>=16`，不用 `>=20`。标称 20px 在缩放机器上实测 19.999998px，曾筛掉唯一编辑器、群发空等 44s（v0.15.2）。
- **`deadline` 是绝对时间戳、全链路透传**：`shell-ipc.ts` 的群发入口（44s / 带图 90s）→ `broadcast.ts` → `site-command-channel.ts` → `preload/site.ts` → site-runtime `submitPrompt` → `adapter.submit`/`attach` → `confirmSubmitted`。**循环等待、以及 ≥1s 的固定等待，一律夹取**：`Math.min(x, Math.max(0, deadline - Date.now()))`。例外两处：「让渲染跟上」的毫秒级 sleep（单条 ≤500ms、不得叠成秒级）；提交后的只读确认窗（1.5s，deadline 到点才开始，夹了就归零）。切档 `think`/`fast` 同样接收绝对 deadline，群发内取总截止时间与 10s 切档上限的较早者；超时仅收菜单，不再选择模型或档位。
- **群发预算只有一个真源**：`shell-ipc.ts` 群发入口的 44s/90s；`main/index.ts` 辅助发送回调的 44s 必须跟随（硬编码、无带图分支）。改预算先改那一处，再改 `docs/desktop.md` 的预算表。
- **只产 `code`，不产用户可见文案**：site-runtime / preload / 主进程返回错误码，渲染层翻译；轮询认 `r.code`，**绝不正则匹配文案**。新增可见码三处落点：`shared/protocol.ts` 的 `SITE_CODES`、`shared/status-copy.ts` 的 `STATUS_COPY_KEY`（漏映射 typecheck 红）、`shared/copy.ts` 三语；`desktop/test/status-copy-coverage.test.ts` 双向对账。IPC 抛出的裸码经 `shared/ipc-error.ts` 剥掉 Electron 前缀后才到渲染层。
- **`diagnose()` 每条检查必须带 `kind`**（`reach`/`control`/`tier`/`probe`/`capture`）。仅 **`tier`、`capture` 之外**的红项影响可用性（`shared/site-health.ts` 的 `isAdvisoryCheck`）。`state()` 是偏函数，合法非预设档位返回 null 不算故障；`capture` 仅在会话路由检查第 ① 级定位，红了仍可群发。漏标按 `control` 误报；各站例子见 `docs/adapters.md`，回归在 `diag-runtime.test.js`。
- **适配器协议**：每站必需 `{think, fast, state, diagnose}` 四项，其余钩子可选、不实现 = 该能力静默降级。`state`/`selection`/`diagnose`/`answer`/`submitted` **只读同步，不得开菜单**。`return false` = 落回 core 通用链；`throw` = 通用链对本站不安全，core 直接失败**不回退**。全表与九站映射见 `docs/adapters.md`。
- **切档控件缺失一律 `throw`，不要静默 `return`**——静默 return 会让 `runMode` 误报「已切到」。例外只有 4 处（DeepSeek 首屏 radio、Gemini 两处、千问已确认日常页面的无模型入口分支），全部写死在适配器里；加新例外前先读 `docs/adapters.md` 的例外清单。
- **站点 UI 三条通用规则**（反例见 `docs/adapters.md`）：① 控件在下沉到二级子菜单，默认「顶层找不到 → 展开子菜单 → 再找」；② 同一 role 可能承载不同语义的列表，取列表必须校验语义，否则「最高档」被点成末位模型；③ **每个菜单动作自己 `escMenus()` 收尾**。
- **群发取消（epoch）**：`broadcast.ts` 的 `epoch`。新写的长流程必须在每个 `await` 后核对 epoch，否则用户取消了、主进程还在往站点输入框里打字；`AbortSignal` 不替代 epoch 核对。
- **站点视图内不产用户可见反馈**：site-runtime 的 `toast` 是 no-op，切档结果/失败原因走外壳状态通道与 `feedback-provider.tsx` / `bootstrap-state.tsx` 两处 sr-only `aria-live`（圆点变色对读屏不可见，这是唯一进度通道，不可删）。
- **诊断报告是唯一报障入口**：`Alt+H`「复制诊断报告」（`shared/site-report.ts`）只含版本/系统/缩放/阶段码/`name-kind-ok`、每站定位/采集原因的固定枚举计数及卡顿数（详见 `docs/desktop.md`）、白名单进程类别/退出原因/数值错误码；**可复制，不含对话、网址、账号、路径、token 或消息 key**。
- **新增持久化键要同时登记**：SQLite 仓库（`main/*-repository.ts`）、同步投影（`sync-repository.ts`）、本机重置（`database.ts` 的 `resetLocalData`）、线格式 fixture（`desktop/test/fixtures/` 只增不改）。漏一处，同步/重置/回填会静默失效。
- **图片限额改任何一个数**，落点以 `scripts/test-image-limits.js` 的对账项与 `docs/adapters.md`「图片载荷」为准，别凭记忆列。
- **加站点 / 新开适配器分卷**：登记落点见 `docs/adapters.md`（站点表 `main/sites.ts`、分卷注册键、`preload/site.ts` 的 require 顺序、issue 模板站点下拉），`scripts/test-site-selection.js` 与 `desktop/scripts/desktop-shared-runtime.test.js` 会红。
- **行数门禁**：`.js` ≤300 行；`desktop/src` 的 `.ts/.tsx` ≤400 行，越界的三个文件走 `verify.sh` 里的棘轮只降不升，豁免只有 `shared/copy.ts`。动手前用 `wc -l` 检查余量，要加行超限时按站点或职责拆分，不要靠压行/删注释续命。
- **真机验证不可省，本机全绿 ≠ 用户环境可用**：适配器/切档/发送 bug 须重启开发态（`cd desktop && npm start`），在目标站点视图里用生产 `__AMS` 回归。**本机不能复现时先要现象再猜层次**（composer / inject / submit / state），四问话术见 `docs/verify.md`。
- **已发布 tag 不覆盖**，改内容必须升版；推任何 `v*` tag 前先在 GitHub 手动跑一次 Release workflow 的 `dry_run`。版本真源是 `desktop/package.json`；Release 从 Repository Variable 注入 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID`，缺 `resources/oauth.json` 拒发；五个包均未签名、无自动更新。
- **`desktop/` 自包含 = 构建与测试自包含**（preload 只 require `desktop/` 内文件，干净 clone 上 `npm ci && npm test` 全绿）；仓库级动作（tag、CHANGELOG、发版、跨端 5 个测试）留在根。已**否决**把 `desktop/` 扁平到仓库根（收益全部来自 site-runtime 迁入）。

## 命令

```bash
bash scripts/verify.sh               # 零依赖仓库卫生：.js/.mjs 语法 + JSON + 300 行 + desktop/src 400 行棘轮 + OAuth 卫生 + 文档/.github 引用 + workflow YAML + 根 scripts 五个跨端测试 + diff --check
cd desktop && npm test               # Desktop 门禁：断言检查 + tsc + 串行 TS/运行时测试（含九站回归）；受限入口，verify.sh 不跑它
cd desktop && npm run typecheck      # 与 npm test 编译检查重叠，CI 单独再跑是刻意的双保险
cd desktop && npm run package && xvfb-run -a npm run smoke -- --skip-package   # preload 的 require 仍解析、九站视图挂上
bash scripts/prepare-release.sh auto # 推导版本、晋升 CHANGELOG、同步 Desktop package/lock（只改文件不 commit）
bash scripts/release.sh --publish    # 推 tag 并触发五个 Desktop 包发布（--build-only 只校验源码并提取 Release 正文）
```

## 架构（先在这里定位入口文件）

- **主进程**：`desktop/src/main/index.ts`（装配）→ `view-manager.ts`（站点视图树/状态）、`broadcast.ts`（群发编排、deadline、epoch、Kimi 只读确认）、`shell-ipc.ts` + `sync-ipc.ts` / `site-health-ipc.ts` / `data-admin-ipc.ts`（IPC，全部过 `trustedShell`）。
- **站点适配**：`desktop/src/site-runtime/`：core/tier 编排、selection-match 候选匹配、send/upload 提交与附件；intl/intl2/cn/cn2/cn3/cn4 按站分卷；注入顺序以 `preload/site.ts` 为准，classic script、`__AMS` 全局；语言由 `shared/locale.ts` 解析后 `setLang` 注入。
- **数据与同步**：`main/database.ts`（SQLite）+ `*-repository.ts`、`sync-engine.ts` / `sync-pull.ts` / `drive-client.ts`（Drive appdata，旧实体 schema 1 / 决策卡 schema 2 / 文件夹及关联 schema 3 / 逐次提问及回答 schema 4，fixture 在 `desktop/test/fixtures/`）、`data-admin-service.ts`（本机数据管理）、`backup-service.ts`（预览与事务恢复）。
- **渲染层**：`desktop/src/renderer/`，所有 IPC 只经 `shell-api.ts` 的 `shell`（测试用 `setShellApi` 注入桩）。
- **共享契约**：`desktop/src/shared/`（protocol、copy、locale、site-report、ipc-error）。

## Git

- 提交用 `git-commit` skill（Conventional Commits，可带 AI 署名 trailer）；仓库无 user 配置，用内联身份提交。
- 持续维护 `CHANGELOG.md` 的「未发布」段，所有用户可感知变更都要记。发版流程见 `docs/release.md`。
- `docs/` 默认忽略，公开契约须登记 `.gitignore` 白名单及 `docs/README.md`；设计/实施记录仅本地保存。入库文档不得引用未入库文件；`verify.sh` 按 `git ls-files` 检查。
