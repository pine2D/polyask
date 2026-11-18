# 验证手册：离线门禁、原生视觉与 Desktop 真机

本文只保留**现行有效的验证规范、门禁命令、资源防护、真机纪律与待闭合真机事项**（上限 300 行，由 `scripts/verify.sh` 守卫）。历次按日验收记录统一归档在 `docs/verify-history.md`，证据总索引见 `docs/acceptance.md`。

## 界面与交互验收三关

凡涉及界面、表单、设置、菜单、布局或文案呈现的改动，必须依次通过以下三关：

1. **动工前两句话对齐**：新增按钮、输入框、开关、设置项或面板前，先用两句话向用户确认：① 入口归属哪个分类或区域（为什么符合直觉）；② 沿用哪套既有卡片/表单样式。严禁未经确认把新入口塞进不相关分类。
2. **原生自查实拍图**：严禁裸用浏览器默认简陋表单控件；所有控件须沿用 `theme.css` / `fields.css` 设计令牌与所在工作区样式，同步补入完整验证夹具（如 `test/ui/shell-fixture.tsx`），并在真实 Electron 原生环境自查三语、明暗主题、150%/200% 缩放、最小窗口（`960×680`）及空态/报错态**实拍截图**，不得仅凭测试退出码或“无横向滚动条”宣称通过。
3. **看图说话与试玩版同步**：交付时主动在对话附上最关键的 2～4 张明暗/窄窗实拍图供用户直观核验，并同步刷新本地隔离【Windows 试玩版】（独立测试数据目录，绝不触碰用户日常正式配置、登录态与历史记录）。

## 离线回归

**两条互不重叠的日常门禁，代码改动两条都要过**：

- **仓库级卫生（零 `node_modules` 依赖）**：根目录 `bash scripts/verify.sh`——检查 `.js/.mjs` 语法、JSON、`*.js` ≤300 行、`desktop/src` 的 `.ts/.tsx` ≤400 行（仅豁免 `shared/copy.ts`）、`docs/verify.md` ≤300 行、文档版本对齐、OAuth 凭据卫生、`docs/*.md` 与 `#anchor` 断链、`.github` 引用、workflow YAML（优先 `actionlint`，回退 PyYAML）及根 `scripts/` 七个跨端与哨兵测试。
- **Desktop 门禁**：`cd desktop && npm test`——统一经 `scripts/test-safe.mjs` 串行执行：先 DOM 断言静态扫描，再 `tsc --noEmit` 类型检查，随后带运行时内存保护跑 `test/**/*.test.ts(x)` 与 `scripts/*.test.{js,mjs}`（含九站适配器回放与打包脚本回归）。需要单独快速查类型时运行 `npm run typecheck`。
- **打包与离线启动冒烟**：动主进程窗口/视图/preload/构建配置时，在 `desktop/` 运行 `npm run package && xvfb-run -a npm run smoke -- --skip-package --offline`（Windows/macOS 去掉 `xvfb-run -a`）。`--offline` 通过 Chromium 主机名解析阻断外网，验证真实打包产物启动、`shell=1`、九站挂载且视口 `> 0`、同分区及沙箱隔离。
- **依赖审计**：`cd desktop && npm audit --omit=dev` 查应用生产依赖；`node scripts/audit-runtime.mjs` 单独审计 Electron 运行时依赖（`electron` 位于 `devDependencies`）。

编写离线测试的五条硬规则：

- **读源码一律走模块相对路径，禁止 `cwd` 相对**：`desktop/test/` 用 `test/fixtures.ts` 的 `readSource(...)`；`desktop/scripts/*.test.js` 用基于 `__dirname` 的 helper。
- **共享夹具放非 `.test` 文件**（如 `desktop/test/fixtures.ts`）：从别的 `*.test.ts` import 会把被引用文件的 `test()` 重复注册执行。
- **站点表与注入清单共用单真源**：由 `desktop/scripts/lib/desktop-anchors.js` 的 `desktopSites()` / `preloadRequires()` 抽取，禁止各写正则。
- **每个修复必须留离线回归**：把出事现场的 DOM 或消息流做成最小合成对象喂给源码（站点侧参考 `site-send-runtime.test.js` / `intl-runtime.test.js`，主进程侧参考 `broadcast-submit-recovery.test.ts`）。
- **测试登记口径分清两端**：根 `scripts/test-*.js` 必须在 `scripts/verify.sh` 显式调用（或标 `# verify-skip: <路径> <理由>`）；`desktop/` 下 `*.test.*` 由 `npm test` 自动收集，禁止写进 `verify.sh`。
- **脱敏 DOM fixture 回放**：`desktop/scripts/fixtures-dom/` 存放脱敏真站快照（采集工具 `capture-dom-fixture.mjs` 只读运行、超 20,000 节点或含敏感串拒落盘；`dom-fixture-scan.test.js` 强扫隐私与白名单属性；`dom-fixture-replay.test.js` 与 `dom-fixture-drift.test.js` 回放 `historyTurn()` 定位与选择器漂移接管）。

## 断言与测试内存防护

React/jsdom 测试若将 DOM 节点直接传给 `assert.equal(el, null)`，失败时 Node 会展开节点上的 React Fiber 耗尽内存。防护体系由 `desktop/scripts/test-safe.mjs` 强制执行：

- **安全断言写法**：只比较标量——`assert.equal(el === null, true, msg)`、`assert.equal(document.activeElement === btn, true, msg)`；严禁把 DOM/Window/节点集合直接交给断言或放进对象做 `deepEqual`。静态 AST 检查（`npm run test:assertions`）与运行时预加载（`scripts/lib/assertion-safety.mjs`）双重拦截。
- **串行与进程树内存边界**：`test-safe.mjs` 强制 `--test-concurrency=1`、单文件 60s 超时。Linux 有用户级 systemd（或外层已处于 cgroup v2 scope）时设置 `MemoryMax=4G` / `MemorySwapMax=512M`；无 systemd 的纯 Node 离线门禁回退到每进程 `prlimit` 2 GiB `RLIMIT_DATA` + 1 GiB V8 旧生代。
- **Linux 原生 Electron 专项必须处于 cgroup 边界**，不允许无界回退；CI 无用户 D-Bus 时用 `sudo systemd-run --scope --quiet -p MemoryMax=4G -p MemorySwapMax=512M --uid="$(id -u)" --gid="$(id -g)"` 包裹执行。子进程隔离会话总线防迁出 scope，并在结束时核对观测 PID 全部退出。

## 负向对拍

离线守卫写完必须先「改坏一处真源 → 跑测试必红 → 还原」验证真正在检查：

- 收紧归档 `label` 上限 → fixture 校验必红并指名样本；
- 往 `SITE_CODES` 加未映射码 → `npm run typecheck` 必红；文案表多写孤儿键 → `status-copy-coverage.test.ts` 必红；
- 删一站 `sites.ts` 或删一条 `preload/site.ts` require → `scripts/test-site-selection.js` 必红；
- 让任一非豁免 `desktop/src/**/*.ts(x)` 超过 400 行 → `scripts/verify.sh` 行数门禁必红。

## 外壳与设置页视觉回归

在 `desktop/` 运行 `xvfb-run -a -s '-screen 0 1920x1200x24' npm run test:shell-ui`（Linux 需 `xdotool`；仅跑草稿工具栏可用 `--toolbar-only`）。构建生产外壳组件 + `test/ui/shell-fixture.tsx` 合成数据，临时空白 profile、阻断联网，输出截图与 `report.json` 到临时目录：

- 覆盖三语 × 明暗 × 紧凑/舒适密度 × 960/1101/1280/1401/1600px 共 96 组布局、180 组命令栏文字与图标不溢出检查（收起提问框保底 ≥320px）、24 组草稿工具栏检查及 150% 设置页缩放。
- 子项涵盖：`workspace-entry-visual.cjs`（无障碍树名称、窄窗发送/取消、收纳菜单）、`settings-section-visual.cjs`（七分类 72 组布局切换、隐藏分类 `inert`、窄窗选择器）、`settings-interaction-visual.cjs`（IME Escape、`DELETE` 门槛、异步恢复）、`interface-polish-visual.cjs`（禁用态无按压反馈但保留键盘原因提示、10% 慢放页签指示器中断重定、减少动态效果、合成附图增删）、`site-order-visual.cjs`（键盘与原生拖拽重排）。

## 结果库视觉与交互回归

在 `desktop/` 运行 `xvfb-run -a -s '-screen 0 1920x1200x24' npm run test:library-ui`。构建生产 `ArchiveSurface` + `test/ui/library-fixture.tsx`，临时 profile、禁网，输出截图与 `report.json`：

- 覆盖三语 × 明暗 × 960/1280/1600px 布局、表格无障碍、长提问两行折叠与锚点保持、对比双栏/窄详情自动展开/同屏证据槽、粘性来源导航定位与标最佳零重排、长标题两行裁切、只读报错与六条空态路径、三态徽章对比度与色觉/高对比/强制颜色模拟、文件夹新建/重命名 IME `229`/`isComposing` 保护、4000 码点备注边界及 150%/200% 缩放。
- 按需运行的隔离原生专项（均在 `desktop/` 下执行，走 4 GiB / 512 MiB cgroup 与断网临时档案）：
  - 阅读网格与连续阅读：`node scripts/test-safe.mjs command node scripts/reading-experience-native.mjs`（仅跑网格加 `--grid-only`）
  - 页面独立缩放：`node scripts/test-safe.mjs command node scripts/page-zoom-native.mjs`
  - 专注阅读合栏：`npm run test:unit -- test/library-focused-toolbar-interaction.check.ts`
  - 取消新卡与失败重试：`npm run test:unit -- test/library-recovery-interaction.check.ts`
  - Markdown 长链接与 Mermaid：`npm run test:unit -- test/markdown-reading-interaction.check.ts`

### 星标交互专项

在 `desktop/` 运行 `npm run test:unit -- test/stars-native.check.ts`：三语 × 明暗 × 640/1400px 及 200% 缩放共 26 组，原生鼠标/Space 验证历史与结果库列表及详情加星、失败重试、单次写入、取消星标保持滚动位置、决策卡及混合批量星标。持久化与同步由 `starred-*.test.ts(x)` 覆盖。

## 提问历史原图的隔离原生验收

- 组件与真实服务链：`cd desktop && node scripts/test-safe.mjs command node scripts/history-images-native.mjs`（三语 × 明暗 × 150%/200% 缩放验证有效 PNG 解码、原图查看器、缺图备份选择键盘流、脏草稿保护再问且零发送、v4+ 原图备份往返）。
- 包内主进程/preload 离线冒烟与异常清理：`npm run package` 后运行 `node scripts/test-safe.mjs command node scripts/history-images-packaged-smoke.mjs` 与 `node scripts/test-safe.mjs command node scripts/history-images-cleanup.check.mjs`。

## 查找位置条与历史翻页的隔离原生验收

- 跨站查找与命令面板互斥：`cd desktop && xvfb-run -a -s '-screen 0 1920x1200x24' npm run test:unit -- test/site-find-native.check.ts`（九个本地合成页验证 `Ctrl+F` 命中高亮、滚动条橙色刻度、跨页循环、100/150/200% 几何及面板互斥）。
- 历史键盘翻页：`cd desktop && node scripts/test-safe.mjs command node scripts/question-paging-native.mjs`（可信 `PgUp/PgDn/Tab` 验证列表与正文实际 `scrollTop`）。

## 站点运行时引用回收

- 离线弱引用回归：`cd desktop && npm run test:runtime -- scripts/runtime-retention.test.js scripts/generation-runtime.test.js`。
- 原生 GC 专项：`cd desktop && node scripts/test-safe.mjs command node scripts/runtime-retention-native.mjs`（三块常驻 `WebContentsView` 加载本地合成页，验证路由终止、手动冻结与观察窗到期后旧 DOM 节点 `WeakRef` 全部回收）。

## 多段依据与判断事项的隔离原生验收

- 完整多依据与决策保存：`cd desktop && npm run test:unit -- test/multi-evidence-native.check.ts`（另有焦点子集 `POLYASK_EVIDENCE_FOCUS_NATIVE=1`、来源版本冲突子集 `POLYASK_EVIDENCE_CONFLICT_NATIVE=1`）。
- 静态与组合报告导出：`npm run test:unit -- test/report-export.check.ts test/report-combined.check.ts`（真实 Electron 内存 session 导出 HTML/A4 PDF、公式/图表与恶意输入清洗）。
- 偏好草稿同步、输入框激活与本机重置：`node scripts/test-safe.mjs command node scripts/preferences-drafts-native.mjs`、`npm run test:unit -- test/composer-activation-native.check.ts test/local-data-reset-interaction.check.ts`。
- SQLite/IPC 与多页资源基线：`node scripts/test-safe.mjs command node scripts/resource-baseline.mjs`（1k/5k/20k 真实磁盘库查询与 1/3/9 页挂载切换测量）。

## 会话内任务准备专项

- 单元回归：`cd desktop && npm run test:unit -- test/task-setup-command.test.ts test/task-setup-flow.test.tsx test/task-setup-component.test.tsx test/task-setup-prompt.test.ts`。
- 原生表单与任务准备视觉专项：`cd desktop && npm run test:unit -- test/task-setup-native.check.ts test/form-surface-native.check.ts`（覆盖三语 × 明暗 × 双密度、最小窗口 `960×680` 下 200% 缩放、高对比/减弱动态、迟到 ACK 保护与 IME Escape）。

## 真机环境（Desktop 开发态）

- **真机只读巡检铁律**：日常真机实测**只允许做零打扰只读检查**（在 `desktop/` 运行 `npm run tour` 跑九站只读 `diagnose()`，或加 `--check-menus` 在 `withPresetRestored` 保护下读取菜单并校验草稿、URL、18 项已存预设、当前档位及零残留菜单；`site-live-smoke.mjs` 须显式传入 `--confirm-live-send` 与单一 `--site <key>`，日常严禁调用）；**未经用户当轮明确点头授权（须先说明目标站点、非敏感测试句与轮数），严禁向任何真实 AI 站点发送提问、上传图片或写入测试预设**。过往会话的发送授权绝不顺延。
- **档案隔离红线**：Linux 开发态排障默认复用用户指定的 `~/.config/PolyAsk`（启动前先查是否已有运行实例，不复制凭据、不批量按进程名强杀）。**Windows 严禁触碰正式档案**，一切 Windows 开发态或试玩版实测一律使用独立目录（如 `%LOCALAPPDATA%\PolyAsk-Preview` 或 `%LOCALAPPDATA%\PolyAsk-TestLab`）。在 `desktop/` 运行 `npm run sync:win-preview` 可一键打包 `win32-x64`、核验 `EnableCookieEncryption` 与 `OnlyLoadAppFromAsar` Fuse、更新 `%LOCALAPPDATA%\PolyAsk-Preview\App`（原样保留 `Preview Data`）并刷新 Windows 桌面「【PolyAsk 试玩版】」快捷方式。
- **Cookie 加密 fuse 硬核验**：打开任何已有真实档案前，`EnableCookieEncryption` 必须与发行包一致（`true`）。必须通过 `cd desktop && npm start`（或 `npm run prepare:dev-runtime`）经 Forge `preStart` 准备并校验 `desktop/test-artifacts/dev-runtime/`，严禁直接用裸 Electron 打开真实档案。改动主进程、preload 或 `site-runtime` 后**必须重启 `npm start` 才生效**。
- **只认生产 `__AMS`**：开发态启用 `--remote-debugging-port=9223`（仅监听 `127.0.0.1`）后，在目标站点主帧的 `Electron Isolated Context` 调用生产 `window.__AMS`，禁止在临时脚本里手抄正则。所有已勾选站点均保持挂载与正尺寸视口；判“掉登录”须凭可见登录按钮与缺失头像/历史强证据，不得用 `[class*=login]` 弱匹配。
- **本机复现不出时先按序四问、再猜层次**：① 界面语言与系统缩放是多少？（词表/阈值余量）② 点了什么、屏幕上出现什么？（入口是否点中）③ 输入框里是否出现待发文字？（`composer` / `inject` 分界）④ `Alt+H` 站点状态与「复制诊断报告」内容是什么？（`submit` / `state`）。

## 探测坑

- **批量重载九站可能触发 Google 反滥用插页**：Gemini 被 302 到 `unusual traffic` 验证码页时，输入框与登录锚点均不在场；**必须先看当前 URL 判读**，勿误判成掉登录或站点改版。站点自身 DOM/时序坑统一记在 `docs/adapters.md` 站点卡。

## 工具

- **打包冒烟与长跑**：`npm run smoke -- --skip-package --offline`（见「离线回归」）；`npm run soak -- --minutes=<n>` 跑长时稳定性；`npm run configure-oauth` 写入本地开发态 `desktop/resources/oauth.json`（凭据规范见 `docs/desktop-oauth-security.md`）。
- **资源与窗口诊断采样**（均默认关闭，按需指定尚不存在的本地 `.jsonl` 路径，不含网址与对话）：`POLYASK_RESOURCE_TRACE` 每 5s 采样各进程指标（勿与 soak 同跑，勿把共享进程工作集直接相加当独占内存）；`POLYASK_WINDOW_TRACE` 记录最小化/恢复/缩放与站点 bounds；`node scripts/probe-performance.mjs 9223` 只读采样已加载站点同步探针耗时。
- **外围隔离实验**：`xvfb-run -a node scripts/test-safe.mjs command node scripts/background-throttling-lab.mjs`（后台节流机制）、`site-zoom-smoke.mjs`（单站独立缩放）、`runtime-process-smoke.mjs`（子进程退出诊断白名单）、`web-badging-native.mjs`（网页角标拦截）。

## 快捷键链路

加速器分 `desktop/src/shared/commands.ts` 的 `COMMANDS` 表与 Electron 菜单 `role` 自带项两类；快捷键速查直接读取 `Menu.getApplicationMenu()` 防止漂移。离线由 `test/menu-shortcuts.test.ts`、`test/keyboard.test.ts` 与 `test/site-find-native.check.ts` 守卫；跨平台物理按键与输入法仍须实机核验。

## 哨兵与报障

- **模型发布与底层安全双哨兵**：`.github/workflows/release-watch.yml` 每周一/四运行 `scripts/watch-releases.js` 轮询官方源（`web/model` 独立开单，`api/low` 按周聚合）；每周一及手动触发额外运行 `scripts/watch-security.js` 检查满 72 小时（`UPDATE_MIN_AGE_DAYS=3`）的 Electron 同大版本稳定补丁及生产/Electron 运行时依赖的 `high`/`critical` 漏洞，无风险零打扰，有风险合并为单条 `[security-watch]` 提醒（离线由 `scripts/test-release-feed.js`、`scripts/test-release-watch.js`、`scripts/test-security-watch.js` 守卫）。**哨兵只是闹钟：公告型号 ≠ 网页菜单文案，严禁未经真机核对直接改适配器正则。**
  - 百炼按发布日期合并各地区的模型记录，跨地区同日出现的同一模型只记一次。旧表格继续沿用原来的条目标识。
  - 已关闭的周报收到同周的新条目时，在原 issue 中追加并重开。重复条目不会触发写入。
- **双通道脱敏报障入口**：① `Alt+H`「复制诊断报告」（仅含版本/系统/缩放、阶段码、`name-kind-ok`、固定枚举计数与代理枚举行）；② `Alt+H` 单站详情页「导出脱敏快照」（只读采样本站 DOM 骨架与可见浮层菜单，抹除对话正文、URL、账号、Cookie 与本机路径，经 preload 与主进程双重扫描通过后才允许保存单个 `.json` 文件，可直接用 `node scripts/capture-dom-fixture.mjs --from-snapshot <file.json> --name <name>` 转入回归夹具），配合 `.github/ISSUE_TEMPLATE/site-breakage.yml`。

## 自定义代理：本地代理验证法与技术验证结论

契约见 `docs/desktop.md` §13「网络代理」；判定一律以代理端与源站端命中记录为准，不认客户端自报。

### 本地代理夹具

`desktop/test/support/local-proxy.ts` 仅用 Node 内置模块提供 `startHttpProxy({auth?})`（CONNECT/URI + 407 Basic）、`startSocksProxy({version: 4 | 5})` 与 `startOrigin()`（`/generate_204`、`/redirect`），记录 `kind`、`target`、`resolvedBy`（`proxy`/`client`）及 `authorized`。自测：`cd desktop && npm run test:unit -- test/local-proxy.test.ts`。

### 自动化覆盖

- `npm test` 覆盖 `test/proxy-*.test.ts`、`secret-file-store.test.ts`、`net-request-fetch.test.ts`、`settings-proxy.test.tsx`、`backup-proxy-exclusion.test.ts` 等单元与源码守卫。
- 原生端到端检查：`cd desktop && env -u DISPLAY -u WAYLAND_DISPLAY npm run test:unit -- test/proxy-native.check.ts`——打包生产代理服务，在两个隔离 Electron 进程中验证 `startup-closed-port`（端口未开报 `-130` `proxy_failed` 不直连）、`startup-no-direct`（app ready 前 `--proxy-server=http://127.0.0.1:9` 拦截 Chromium 拼写词典直连）、HTTP/SOCKS5/直连切换、407 认证与特殊字符密码、群发中挂起应用及同步待确认横幅。

### 技术验证结论（Electron 44.5.0，WSL2 + Xvfb）

- **关键行为（a–i 实测结论）**：`net.request` 跨源重定向须手动 `abort` 并剥离 `Authorization`（a）；Chromium 不支持带密 SOCKS5（b，校验拒收）；SOCKS5 远端解析 DNS、SOCKS4 本机解析 DNS（c）；切换时主动 `closeAllConnections()` 防旧连接复用（d）；`disable_non_proxied_udp` 对新建与已有视图即时生效（e）；`localhost`/`127.0.0.1`/`[::1]` 隐式绕过代理，仅固定追加 `<local>`（f）；`resolveProxy` 0–15ms 生效、首跳无直连泄漏（g/h）；错误密码 60s 内 2 次 `firstAuthAttempt=false` 即熔断（i）。
- **原生错误号映射**：端口未开 `-130` → `proxy_failed`；CONNECT 502 `-111` → `proxy_failed`；SOCKS5 拒绝 `-120` → `proxy_failed`；HTTPS 407 取消为 `-111`（凭熔断状态改判 `proxy_auth_failed`）；`polyask-net` 407 归类 `proxy_error`。

### 真机清单

以下均须在独立测试档案（Windows 用 `%LOCALAPPDATA%\PolyAsk-TestLab`）实测，未执行项保持 `[ ]`，涉发送/账号项须先获用户当轮明确授权：

- [ ] **W1–W3 / W8 / W10 / W11（Windows 基础与认证线路）**：跟随系统开关 Clash（W1）、自定义 `127.0.0.1:7890` 连通与退出报错（W2）、本地认证代理正确/错误/特殊字符密码与清密（W3/W11）、三种已存模式冷启动覆盖阻断开关（W8）、已存代理未运行时冷启动可进设置恢复（W10）。
- [ ] **W4–W7 / W9（Windows 交互、同步与零泄漏）**：群发中拒存挂起（W4，需发送授权）、Drive 同步经代理（W5，需测试账号授权）、跨端代理同步待确认横幅（W6）、每步诊断报告不含主机端口（W7）、Wireshark 冷启动验证无直连外网 TCP 与九站 DNS 泄漏（W9）。
- [ ] **L1–L3（Linux） / M1（macOS）**：GNOME 系统代理（L1）、无桌面 `https_proxy` 启停对照（L2/L3）；macOS 暂无真机（M1，未验前发版须如实注明限制）。

## 测试材料与收尾

- **严禁污染仓库**：原始 JSONL、日志、截图、抓包、堆快照、临时 profile 与打包产物一律放系统临时目录或已忽略的 `test-artifacts/`，严禁 `git add -f`。公开文档只写汇总指标与合成用例，不写机器用户名、真实会话 URL 或账号信息。
- **安全停机与清理**：结束真机或原生测试时，先核对 PID 的可执行路径与 `userData` 归属再退出，禁止按进程名通杀；确认进程全部退出后清理本任务自建临时目录（`runtime-runner.mjs` 带有限重试容忍短暂 `ENOTEMPTY`），长期独立测试档案保留登录态不清空。

## 待闭合真机事项

- **最高优先红线（Kimi 提交确认，闭合前严禁打开自动重发）**：`broadcast.ts` 的 `POLYASK_KIMI_RESUBMIT` 必须保持 `false`，直至真机闭合 **F067** 两条硬用例（① 新会话空态 `submitted(text)` 必返 `false`；② 末条用户消息为上一轮内容时必返 `false`）及 **F211** 关闭态/开启态对照。
- **站点 DOM 与共享阈值待取证项**（原 2026-08-31 审计顺延，详见 `docs/verify-history.md`）：`F049`（intl 700ms 等待余量）、`F055/F057`（Gemini <640px 菜单展开态）、`F098`（ChatGPT/Gemini 思考段排除复核）、`F072/F078`（DeepSeek/豆包/Kimi 停止键锚点）、`F068/F077`（豆包双语菜单层级）、`F059/F047/F046`（ChatGPT/Gemini 旧判据复核）、`F095/F096/F101`（upload/md/多图指纹阈值）、`F139`（便携版白名单校验）、`F089/F132/F037`（待核遗留项）。
- **跨平台与双设备长期缺口**：真实 Google 账号双设备 Drive 同步与 tombstone 收敛；Windows / macOS 实机系统缩放、物理输入法（IME）与读屏体验。
