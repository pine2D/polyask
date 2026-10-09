# 验证：离线回归 + Desktop 真机

**离线回归清单、测试写法（行为测试 / 源码守卫 / 模块相对路径 / 共享夹具）、Desktop 开发态真机流程、工具与坑都在这里**；`CLAUDE.md` 只留门禁命令和「改适配器/切档/发送必须真机复现」一句硬约束。冲突以 `CLAUDE.md` 为准。

**顺序不能反：先离线（`bash scripts/verify.sh` + `cd desktop && npm test && npm run typecheck`），再真机。** 反过来会得到「真机试通了但 CI 红」的返工。

## 测试材料与收尾

- 仓库保留可复用的测试/测量源码和人工合成夹具；原始资源 JSONL、标准输出/错误日志、截图、DOM/网络抓包、CPU/堆转储、临时运行时与解包目录不入库。使用系统临时目录，或已忽略的仓库根/desktop 下 `test-artifacts/`；不得用强制添加绕过忽略。
- 公开验证记录只写必要的汇总指标、合成问题说明与局限；路径使用环境变量或通用占位符，不保留机器用户名、账号/历史条目计数、真实会话链接及正文。测试源码中的假 token、示例域名和合成回答不等同于真实凭据或抓取记录。
- 停止真机测试时，先核验测试进程的可执行文件与 userData/sessionData 归属，再正常退出该实例、确认调试端口关闭；不得按进程名批量结束正式程序。确认退出后才清理本任务可重建的临时产物。
- 长期独立测试 `profile` 含用户手动登录的数据，保留复用；关闭测试不等于授权清空档案。正式档案不参与收尾扫描、复制或清理。本机原始记录保持库外；是否继续保留或删除，与是否提交 Git 分开处理。
- 提交前同时核对工作树及本轮历史提交的文件清单、可疑凭据/个人路径和二进制产物。若真实敏感信息已进历史，删除当前文件并不消除历史，须另行说明暴露范围和处置；不擅自改写已存在提交。

## 断言与测试内存防护

2026-10-07，React/jsdom 测试将 DOM 元素直接与 `null` 比较；失败时 Node 24 展开节点上的 React Fiber，再计算巨大差异，耗尽 WSL 内存。自定义断言 message、`--max-old-space-size` 都不能限制这部分原生数组分配。不得用真实大 DOM 或多 GiB 分配重演事故。

`npm test` 统一经 `scripts/test-safe.mjs`：先静态扫描，再 typecheck、TypeScript、运行时两套测试。单文件使用 `npm run test:unit -- test/example.test.tsx` / `npm run test:runtime -- scripts/example.test.js`；保护本身使用 `npm run test:assertions`。测试单 worker、每文件 60 秒超时、每阶段 15 分钟超时；每个 Node 测试进程预加载 `scripts/lib/assertion-safety.mjs`。静态检查分析 AST，只识别已知节点来源及简单别名，不能穷尽数据流；运行时保护在 Node 格式化前拒绝 DOM、Window、节点集合及嵌套节点，不展开 React Fiber，拒绝普通 getter/Proxy 或超过检查预算的对象（原生 Error.stack 除外，其它附带字段仍检查）。大数据比较先投影成必要的标量。

安全写法保留原有严格语义：`assert.equal(el === null, true, message)`、`assert.equal(document.activeElement === button, true, message)`；回答文本、disabled、checked、数量仍直接比较对应标量。`assert.equal(el, null, message)`、直接比较两节点、把节点包入数组/对象后 deepEqual 都不允许。失败路径不得打印 DOM 或 Fiber。

Linux 有可用的用户级 systemd 时，入口自动创建临时 scope，整个测试组 `MemoryMax=4G` / `MemorySwapMax=512M`；退出后不保留系统配置。离线 Node 门禁在无 systemd 的环境使用 `prlimit` 继承每进程 2 GiB `RLIMIT_DATA`，并限制 V8 旧生代 1 GiB；它覆盖原生匿名分配，但不是整个进程树的总内存上限。`prlimit` 不可用则失败退出，不自动无限额重跑。Windows/macOS 保留断言保护、串行及 V8 旧生代限制，OS 级原生内存上限尚未实现，不宣称与 Linux cgroup 等效。

Linux 原生 Electron 专项要求 cgroup，不能降为仅 V8 或每进程限额；`test:shell-ui` / `test:library-ui` 已统一接入。其它专项经 `node scripts/test-safe.mjs command node scripts/example.mjs`；`.check.ts` 经 `test:unit`。从受限 scope 运行脚本不等于整个 Codex/其它程序已受限；Codex 包装脚本、earlyoom、全局安装和持久系统配置另需明确授权。

## 结果库视觉与交互回归

在 `desktop/` 运行 `npm run test:library-ui`；无显示服务器的 Linux 使用 `xvfb-run -a -s '-screen 0 1920x1200x24' npm run test:library-ui`。脚本构建生产组件＋隔离内存夹具，使用临时 Electron profile，不读取用户数据库、不连接站点或 Drive。输出路径包含截图与 `report.json`，由脚本每次打印；临时产物留供检查，不入库。

覆盖简中/繁中/英文、明暗主题、960/1280/1600px 的 18 组布局；另以 Electron 鼠标与按键输入检查菜单选项、Escape/Tab 焦点、删除确认、备注保存失败、决策卡未保存保护、文件夹多选搜索、对比容器断点及 150% 缩放。几何断言之外要看截图，尤其决策卡详情是否真正占满可用列。它不替代 Windows/macOS 原生字体、输入法和系统缩放验收。

## 外壳与设置页视觉回归

在 `desktop/` 运行 `npm run test:shell-ui`；无显示服务器使用 `xvfb-run -a -s '-screen 0 1920x1200x24' npm run test:shell-ui`。与结果库回归一样，构建生产组件并使用合成数据和临时 Electron profile，禁止网络连接，不访问用户资料。

覆盖简中/繁中/英文、明暗主题、紧凑/舒适密度、960/1280/1600px 的 72 组基础布局，以及外壳 1101/1401px 的 24 组断点边界布局；960/1101/1401px 使用混合发送状态、附件与重试的拥挤场景；检查主按钮及异常状态文字对比度、按钮溢出、外壳高度契约，验证提问框展开/快捷发送/Escape、诊断展开和 150% 设置页缩放。输出截图与 `report.json`。站点标题是生产组件，但不含真实 WebContentsView，不能替代原生站点叠放及 Windows/macOS 字体/缩放验收。

设置页专项 `scripts/settings-interaction-visual.cjs` 同属该命令：验证输入法组合 Escape、嵌套删除确认框的悬停样式、模拟异步清空/同步/云端删除的进度与恢复、DELETE 确认门槛、三语诊断换行及窄窗数据区布局。所有写操作由合成夹具拦截，不访问真实账户或用户数据；输入法事件模拟不替代 Windows/macOS 真机验收。

细节回归 `scripts/interface-polish-visual.cjs` 由同一命令运行：以真实鼠标按压验证不可用操作无反馈但键盘可读原因、高频档位按钮尺寸稳定；对账三页选中底板边界，以 10% 播放速度检查过渡并中途反向；验证减少动态效果及本地合成图片预览/逐张删除到空的状态。输出明暗截图与 `details-report.json`。允许 `data:` 图片仅用于隔离夹具，仍禁止网络连接；不是上传或群发链路测试。

站点排序回归 `scripts/site-order-visual.cjs` 同属该命令：覆盖三语键盘 ↑/↓、焦点保留、上下移按钮和首尾禁用、选中勾选标记；以真实 Chromium 鼠标输入启动拖动，截获原生拖动数据后完成放置，核对最终选站及页签说明顺序；检查 150% 缩放并输出截图。`workspace-order-ui.test.tsx` 补取消拖动、外部放置、连续选择的旧广播/回包及恢复快照迟到；`workspace-order-sync.test.ts` 以真实 SQLite 仓库验证跨设备投影、分组保序、旧客户端兼容、未知主机位置和重置后恢复；`view-reclamation.test.ts` 验证有序启动、布局及重排时保留视图和生成状态。

2026-10-06 本轮：完整 Desktop 门禁 885 个 TypeScript 用例及 369 个运行时用例、独立 typecheck、仓库卫生门禁通过；隔离 Linux Electron 外壳全部 96 组布局及排序专项通过，已检查截图。一次并行运行在既有悬停提示检查超时，单独完整重跑通过，未修改该测试。未执行真实 Drive 双设备联网或 Windows/macOS 原生交互；合成外壳截图没有真实站点视图，视图复用由离线主进程回归覆盖。

## 离线回归

- 输入框展开意图专项：`npm run test:unit -- test/composer-activation-native.check.ts` 编译生产外壳、preload 和 ViewManager，以临时档案及五个真实本地网页视图验证 Esc 后换页/恢复窗口、已聚焦重点击/聚焦命令、Tab、取消关页、附件单层 Esc、模板和历史回填；受控发送 IPC 核验按钮/快捷键成功后收起、部分成功、失败/取消/未确认保留，以及等待期间新草稿和清空后重输同文的保护。明暗主题比较搜索、编辑、设置及门户菜单等文字输入的焦点，并检查错误、只读、禁用、强制颜色与减少动态效果。`test/composer-activation.test.tsx` 另覆盖被阻止、组合态及失效 Tab 和选区恢复；`test/draft-send.test.ts` 覆盖发送结果和草稿修订的组合。截图与报告只留临时目录；这不替代 Windows 原生分组切换焦点、物理输入法或读屏验收。

- 历史阅读专项：`npm run test:unit -- test/markdown-reading-interaction.check.ts`（无显示服务器自行使用 Xvfb）。构建生产 `QuestionHistoryReader`、`ArchiveDetail` 与合成数据，临时 Electron 档案、禁止联网，不访问用户数据库；三语各在历史与结果库核验六种长链接的短显、原目标打开、完整地址展开/复制及 Escape 关闭，验证 Mermaid 实际成图、源码复制、代码切换、缩放、缺失/无效/超限/配置指令回退、迟到源码切换、完整来源链接打开/复制及会话地址动作。截图留在系统临时目录，不入库。普通 `npm test` 的阅读和会话动作回归覆盖解析、当前尝试、缺地址及繁忙状态；`test/markdown-link-labels.test.tsx` 补充格式、换行、裸域名、显示/目标差异、Kimi 形态 DOM 经生产 Markdown 采集到共用阅读器的回归，以及有意义标题/文件名/独立代码的保真；`scripts/md-diagram.test.js` 通过九站生产 `historyTurn()` 定位夹具验证共用提取、隐藏非图表排除、只读及空行保真。图形专项不替代九站真实 DOM 形态验收。

- 本机重置的真实 Electron 外壳交互：在 `desktop/` 运行 `npm run test:unit -- test/local-data-reset-interaction.check.ts`；测试自行编译合成夹具、在临时页面验证旧输入与综合状态清理，不访问真实站点、Drive 或用户档案。普通 `npm test` 不运行这项图形检查。
- 单站缩放回归：在 `desktop/` 运行 `xvfb-run -a node scripts/test-safe.mjs command node scripts/site-zoom-smoke.mjs`（需要 Python 3、libX11、libXtst）。使用生产缩放控制器、布局与界面状态存储，两个同源本地自定义协议页面和临时 profile，拦截 HTTP/HTTPS 请求；键盘经 Electron 输入，Ctrl+滚轮经独立 Xvfb 的 XTest 系统事件验证（`sendInputEvent` 的合成 wheel 不触发 Chromium 原生缩放路径）。检查本站缩放、其它站点与外壳不变、共享登录域导航、布局及刷新保留、文件保存恢复和本机重置。不能替代 Windows/macOS 原生输入设备验收。
- 进程诊断桥接实测：`xvfb-run -a node scripts/test-safe.mjs command node scripts/runtime-process-smoke.mjs`，在两个临时离线 Electron 窗口运行生产 runtime-gates、preload 与 site-health IPC。合成 `child-process-gone` 事件核对可信窗口取数、其它 sender 拒绝、报告白名单过滤及释放清理；不使实际 GPU/网络进程崩溃，不代表 Windows 原生启动失败复现。

- `test:shell-ui` 另覆盖 Windows/macOS/Linux 的确认按钮 DOM 顺序、取消默认焦点、Tab 圈定、IME Escape、焦点恢复，以及强制颜色与减少动态效果的 Chromium 媒体模拟。截图与断言来自 Linux Electron，不能证明 Windows/macOS 的原生字体、系统菜单、输入法候选窗或读屏行为；这些仍需对应实机验收。

**两条互不重叠的门禁，顺序与职责写死**：`bash scripts/verify.sh` 是零 node_modules 依赖的仓库级卫生（`.js/.mjs` 语法、JSON、`.js` 300 行、`desktop/src` 的 `.ts/.tsx` 400 行棘轮、OAuth 凭据卫生、文档与 `.github` 引用、workflow YAML、根 `scripts/` 的五个跨端测试）；`cd desktop && npm test` 是 Desktop 门禁（先 DOM 断言静态检查，再 `tsc --noEmit`，其后带运行时保护、串行跑 `test/**/*.test.ts(x)` 与 `scripts/*.test.{js,mjs}`——九站适配器离线回归及打包脚本测试就在后者里）。`verify.sh` 不跑 `npm test`，两条都要过；`npm test` 已含 typecheck，仍单跑一次 `npm run typecheck`（CI 也分两步，失败点更清楚）。动窗口/视图/preload 的改动另加 `npm run package && xvfb-run -a npm run smoke -- --skip-package`（在 `desktop/` 下运行，先打包当前源码，避免验证旧产物；运行时专项同样遵循上述临时 scope 规则）。

- 测试包含三种手法：直接调用生产模块的行为测试（含内存 SQLite 的仓储/备份/同步测试）、`vm.runInNewContext` 配 DOM 桩执行站点运行时、读取源码文本的契约守卫；React 组件还用 `renderToStaticMarkup` 检查输出。**不能把执行行为的测试都归为源码字符串断言**。只有守卫类测试依赖正则 / `indexOf` 等文本匹配，改 UI 的 class/id/顺序/CSS 数值可能打断这些检查。`verify.sh` 另跑 `node --check`、JSON parse、两档行数门禁、Desktop OAuth 凭据卫生、文档引用与测试登记检查、workflow YAML 解析、`git diff --check`。
- **workflow YAML 检查**优先用 `actionlint`（连 `runs-on` 拼错、`needs` 指向不存在的 job 都查），没装则退化到 python3 + PyYAML 的纯语法解析，两者都缺时打印警告跳过（不阻断 verify）。本机想拿最强校验就装一个 actionlint（apt/brew 都有）——YAML 错误只能在推 tag 后由 GitHub 暴露，而 tag 不可覆盖 = 烧掉一个版本号。
- **读源码一律走模块相对路径，禁止 cwd 相对**：`desktop/test/` 的守卫测试用 `test/fixtures.ts` 导出的 `readSource("src/main/view-manager.ts")`（内部按 `__dirname` 拼出 `desktop/` 根）；`desktop/scripts/*.test.js` 用同形状的 `source()` helper 指向 `../src/site-runtime`。裸 `readFileSync("…")` 会让同一份测试从仓库根跑绿、从 `desktop/` 跑红，是历史上最费时间的一类假绿。
- **共享夹具放 `desktop/test/fixtures.ts`，不要从 `*.test.ts` 里 import 夹具**：`tsx --test` 每个用例文件一进程，从别的 `*.test.ts` 取夹具会把那个文件的 `test()` 在每个引用方各注册一遍（曾让 4 例跑 5 遍）。`fixtures.ts` 故意不以 `.test.ts` 命名，就是为了不被 glob 捡走；`readSource` / `archiveFixture` 都在那里。
- **站点表与注入清单只有两处真源**，由 `desktop/scripts/lib/desktop-anchors.js` 的 `desktopSites()` / `preloadRequires()` 统一抽取，根 `scripts/` 与 `desktop/scripts/` 共用——**别各自写正则**，抽错了两边会一起假绿。
- **每个 fix 必须留一个可离线跑的回归。** 适配器与主进程改动无法在 CI 复现真机，所以回归的形式是：把出事那一刻的 DOM / 消息流做成假对象喂给源码。站点侧模板看 `desktop/scripts/` 的 `site-send-runtime.test.js`、`send-runtime.test.js`、`intl-runtime.test.js`、`image-runtime.test.js`、`md-runtime.test.js`（自带最小 DOM 桩）；主进程侧看 `desktop/test/broadcast-submit-recovery.test.ts`。真机验证**不能替代**它——只有它能防住下一个人改回去。
- **脱敏 DOM fixture 回放（采集定位/序列化）**：真实对话区快照经脱敏后入库在 `desktop/scripts/fixtures-dom/`（每例一对 `.html` + `.json`，格式、元数据键与脱敏规则见该目录 README）。它与 `desktop/test/fixtures/` 的同步线格式 fixture 无关，可随站点改版重采替换。
  - **采集**：开发态 `npm start -- -- --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`，在目标站点打开一条已生成完的合成问答（纯 ASCII 短句、不含个人信息），在 `desktop/` 运行 `node scripts/capture-dom-fixture.mjs --host <host 或站点 key> --name <用例名> --prompt-file <问题文本> [--root <CSS>] [--dry-run]`。脚本先在主帧 `Electron Isolated Context` 只读调用生产 `historyTurn()`，只回传计数、布尔和元素路径；再在主世界注入 `scripts/lib/dom-fixture-sanitize.js` 输出脱敏 HTML，按路径打 `data-polyask-expect` 期望标记。两段之间 DOM 有变化、快照未绑定该问题、原文在 DOM 中找不到、超过 20000 个节点或扫描不过时，一律不落盘；同名文件需 `--force` 才覆盖。脚本不发问、不点击、不切档。
  - **脱敏**：标签名保留，属性走白名单（`class`/语义 `id`/`role`/`aria-hidden`/`contenteditable`/`hidden`/`data-testid`，以及 site-runtime 按值匹配的角色类 `data-*`：`data-message-author-role`/`data-turn`/`data-conversation-role`/`data-markdown-text-style`/`data-message-role`/`data-author-role`/`data-role`/`data-author`/`data-sender`，值须是短标识符），其余 `data-*` 值换成同值同占位的 `id-N`，`aria-label` 换 `label-N`；文本换 lorem 占位，与问题原文逐字相等的文本节点换成 token（默认 `POLYASK_PROMPT`，多行为 `-L1`、`-L2`…）。活页面 computed `display:none` 补 `hidden`，回放时 `md.js` 的剔除才不失真。
  - **门禁**：`scripts/dom-fixture-scan.test.js` 扫描整个目录，拒收 URL、邮箱、≥11 位电话形数字、UUID、≥24 位 hex、≥32 位 base64 形串、JWT 与常见 token 形状（前缀须带各家真实分隔符，如 `sk-`、`sk_live_`、`ghp_`、`xoxb-`；裸前缀曾误伤 Claude 的 `skill-arg-hint-sr` 类名），以及白名单外属性、非占位文本、注释和未配对文件。文本节点须是 FILLER 词表词序列（末词可为长度档截断出的前缀），全小写真实英文也会红；属性按实体解码后的值复核（`class` 逐 token 复用脱敏器 `safeClass` 判据，其余整值再扫敏感串）；`meta.path` 只许 `sanitizeRoute` 产出的形状（每段为空、纯字母短横 ≤24 或 `id-N`，查询串只许 `?cid=id-N`）。规则本身有负例自测。
  - **回放**：`scripts/lib/dom-replay.js` 用 jsdom（devDependency，只用于测试，不进安装包）装载 fixture，`location` 取元数据的 host 与脱敏 path，按 `preload/site.ts` 的真实 require 顺序逐文件运行 site-runtime，返回 `__AMS`、`adapter` 与走 `core.js` 消息入口的 `send()`。`scripts/dom-fixture-replay.test.js` 逐个 fixture 核对 `historyTurn()` 的 `userCount`、token 文本及被标记的 user/answer/answerRoot 节点，新入库的 fixture 自动纳入；`scripts/dom-fixture-drift.test.js` 对 `source: captured` 的真站 fixture 在 jsdom 内存里把 `history-adapters.js` 两张选择器表换成不存在的名字，逐站断言第 ②③ 级接上的级别、userCount 与正文关系，并在首页路由上模拟空会话首轮走 begin/snapshot（新采集的 fixture 须先在该文件的期望表登记，否则红）。jsdom 没有布局：`innerText` 退化为 `textContent`，`getBoundingClientRect` 恒为 0，停止键可见性这类几何判定不在回放范围内，仍以真机为准。
- **新测试的登记口径两端不同，别串**：根 `scripts/` 的五个跨端测试仍走 `verify.sh` 的登记自查（每个 `scripts/test-*.js` 都要在脚本里有一行 `node scripts/test-<名字>.js`，否则直接红；确属被别的用例 `require` 的，加一行 `# verify-skip: <路径> <理由>`——理由不能省，脚本按 `verify-skip: <路径> `（含尾空格）匹配）。`desktop/scripts/*.test.{js,mjs}` 与 `desktop/test/**/*.test.ts(x)` 由 `npm test` 的 glob 自动收，**不需要也不能**登记进 `verify.sh`——登记了会因为路径不在根 `scripts/` 而直接红。
- **`CLAUDE.md` 路由过去的 `docs/*.md` 少一份是纯静默事故**（读文件失败不报错，下个会话空手上阵）。`verify.sh` 从 `CLAUDE.md`、`README.md`、`CHANGELOG.md`、**已入库的** `docs/*.md` 正文里正则提取所有 `docs/*.md` 形式的引用，逐个断言存在且非空、**且已被 Git 跟踪**——只判「工作区存在」会让本机留着未 `git add` 的同名文件时假绿，而 CI 走干净 checkout 才红，卡在一个本机复现不出的失败上。新增引用自动纳入，不用维护清单；反过来，正文里别写 `docs/` 加真实文件名样式的占位符，会被当成真引用（占位用 `docs/<名字>.md`）。
- **站点两处登记已有防线**：`scripts/test-site-selection.js` 双向对账 `desktop/src/main/sites.ts` 的九站 `{key, host, label}` 与 `desktop/src/preload/site.ts` 的 require 列表（适配器分卷清单从后者派生，漏 require 一卷会红），并反查僵尸适配器与孤儿站点；同一份测试还循环断言九站 `think/fast/state/diagnose` 均为 function。加站点漏一处直接红，读断言消息即知补哪份文件。

## 负向对拍

**离线测试写完必须先证明它真的在检查**：改一处真源 → 跑测试 → 必须红 → revert。已验过的模板：

- 把结果库归档校验的 label 上限从 256 收紧到 64 → fixture 校验必须红并**指名被拒的样本**，且归档列表断言仍绿（证明读路径不再二次过滤，收紧只红在显式关口上、不会静默吞记录）。
- 往 `SITE_CODES` 加一个不映射的码 → `npm run typecheck` 必须红；往文案表加一个源码里不存在的 case → 反向断言必须红。
- 从 `desktop/src/main/sites.ts` 删掉一站、或从 `desktop/src/preload/site.ts` 删掉一条 adapters require → `node scripts/test-site-selection.js` 必须红（仍绿 = 锚点没接上，测的是两个空集合相等）。
- 任一 `.ts` 写 `const n: number = "x"` → `npm test` 必红；在 `desktop/test/` 新建子目录放一个 `.test.ts` → 用例总数不得下降（证明 glob 真收得到——文件没被捡到时运行器照样 exit 0）。
- 行数门禁：给越界文件加一行空行必须红（棘轮只降不升）；同一 commit 里连基线一起改才不红。

## 真机环境（Desktop 开发态）

- **本机登录档案默认使用 `~/.config/PolyAsk`**（用户于 2026-09-28 明确指定并授权用于真机排障）。后续站点排障直接复用该档案，不重复询问路径或要求重新登录；不复制登录资料。启动前检查已有实例，避免并发占用；调试端口仅监听本机。该约定不包含发送提问、删除数据或对外传送登录资料的授权。
- **Windows 正式档案不得再用于测试**：2026-09-29 登录态事故后，后续 Windows 测试仅用独立测试档案，不读取、复制或修改用户正式档案，不启动指向正式档案的测试实例。此前使用该档案的授权不作为后续测试授权；加密 fuse 一致也不能豁免此约定。本次临时测试进程已确认全部退出，临时运行时、应用副本及启动控制脚本已移除，原安装程序未修改。
- **真实档案启动前必须核对 Cookie 加密 fuse**：先用 `@electron/fuses.getCurrentFuseWire` 读取原程序与测试运行时的 `EnableCookieEncryption`，必须一致后才能打开档案。项目发行包为 true，官方下载的裸 Electron 默认为 false；版本相同、userData/sessionData 路径相同仍不够。不得先启动再修开关；关掉加密打开已有加密档案可能使 Cookie 不可用，事后重新打开加密不保证恢复。核对不了就使用空白临时档案，不碰真实档案；可恢复性方案须在启动前明确，复制凭据或覆盖恢复不能默默进行。依据：[Electron Cookie encryption fuse](https://www.electronjs.org/docs/latest/tutorial/fuses#cookieencryption)。
- **真机 = 开发态 Electron**：`cd desktop && npm start`。**改动要重启进程才生效**（主进程、preload、站点运行时都在启动时加载），别在跑着的实例上等热更新，那是最常见的「改了没反应」。
- 复现只认**目标站点视图里的生产 `__AMS`**：站点运行时挂在站点视图的隔离上下文，`__AMS.getState()` / `_isOn()` 是唯一可信断言源。**不要在临时片段里重写正则**——转义会把 `\s` 变成 `\\s`，产生「幽灵失败」（实战吃过亏）。
- **直接在真实页面上跑真实适配器（CDP，2026-09-16 起首选）**：`cd desktop && npm start -- -- --remote-debugging-port=9223`（`main/index.ts` 只在打包后移除这个开关，开发态可用；同一 userData，站点登录态照用）。`curl -s http://127.0.0.1:9223/json` 拿站点视图的 `webSocketDebuggerUrl`，用 `desktop/node_modules/ws` 发 `Runtime.enable`，从 `Runtime.executionContextCreated` 里取名为 **`Electron Isolated Context`** 的上下文（`auxData.isDefault === false`），在该 `contextId` 上 `Runtime.evaluate`（`awaitPromise`）就能直接调 `window.__AMS.adapters["<host>"].think()` / `.fast()` / `.state()`，返回值带按钮文本与 `[role=menu]` 残留数即是证据。主世界（默认上下文）看不到 `__AMS`，但能 dump DOM、试各种合成事件——元宝模型子菜单「只认 mousemove」就是这样定的。
- **未挂进视图树的站点视图视口恒 0×0**，`findComposer` 恒返回 null。当前实现把所有已勾选站点都挂载并保持正尺寸，后台页可以正常探测；取证前先确认目标仍被选择、已挂载且视口非零，不能仅凭“当前是否显示”判断探测有效性。
- **判「掉登录」要用强证据**：可见头像 / 会话历史列表非空、**没有可见的**「登录/Sign in」按钮文本；弱类名匹配（`[class*=login]`）只能当线索——登录弹窗容器常驻 DOM，在水合窗口里探测必误判（曾据此错判 Kimi 掉登录）。另：Kimi 停在非预设档（如 Instant）时 `state()` 按既有语义返回 null，属正常态不是故障。
- **开发机与用户机不等价**：开发机是 WSL2 + Linux Electron（实测 `devicePixelRatio=1.5`，**不是无缩放**——缩放类量级问题本机可复现；界面英文），用户机是 Windows（缩放比例可能不同、界面可能非英文），layout 数值不同。本机跑通不构成「已修复」的证据。
- **本机复现不出时先要现象、再猜层次**，四问按序问，答案直接落到四层：① 界面语言与显示缩放各是多少？（→ 词表 / 阈值余量）② 点了什么、屏幕上出现了什么？（→ 入口是否被点到）③ 输入框里有没有出现要发的文字？（→ composer / inject 的分界）④ `Alt+H` 站点状态怎么说、把诊断报告贴一份？（→ submit / state）。**没拿到①②就直接猜第三、四层，是返工的标准起手式。**

## 2026-09-29 自适应切档验收

- 使用用户指定的 `~/.config/PolyAsk` 重启 Linux 开发态，通过目标视图隔离上下文的生产 `__AMS.runMode` 与只读 `selection` 验证；没有发送测试提问。
- 千问常规视口约 467px：从 Qwen3.7-Max 切回 Qwen3.7-千问，随后快速/思考来回切换，全部复读为 `preferred`。实际模型菜单为 DIV 卡片，使用真实菜单事件序列和对话框内标签匹配，结束恢复原模型与快速档。
- 千问临时缩窄至 `innerWidth=267`：模型入口从 DOM 消失，快速/思考各两次仍成功，结果为 `mode_only`；模型入口检查保留 `tier=false` 提示，输入框和模式控件正常，菜单残留为零。随后恢复视口。这只能证明同类无入口布局，不证明另一台 Windows 机器的原因也是宽度。
- ChatGPT：从 Latest/Medium 实际切到 GPT-5.6 Sol，最高/最低档回读 4/4 与 0/4。打开菜单可确认精确模型，关闭后仅 `mode_only`，不借用旧证据；结束恢复 Latest/Medium，待菜单动画结束后诊断正常。
- 九站只读巡检：Claude、ChatGPT、Gemini、DeepSeek、千问、元宝、智谱的非 tier 检查通过；Kimi 非 tier 通过、当前档位不可读。豆包输入框正常，但模型按钮仅有图标、无可读模式标签，重启后仍未被现有适配器识别，保持 control 异常，未宣称已适配或已完成九站切档。
- 离线回归覆盖未知/矛盾切档证据、菜单歧义/隐藏/禁用、慢提交确认窗口、同文旧消息、取消/迟到回包、Kimi 只读恢复保留切档警示。提交证据是页面观察结果，不能推导服务器持久接收；没有新增自动重发。
- 已运行仓库门禁、完整 Desktop 测试、独立 typecheck、当前源码 package 与 smoke。Windows 150% 缩放远端页面、九站真实群发和五种发行包未在本轮验收。

## 探测坑

- **批量重载站点视图会触发 Google 反滥用插页**：九个视图同时刷新属于短时间集中请求，Gemini 可能被 302 到「unusual traffic」验证码中转页而不是站点首屏。**认它要看当前 URL，不能看 DOM**——此时 composer 与登录锚点全不在场，极易被误判成掉登录或站点改版（同上面的强证据原则）。同一个反滥用中转也是导航策略必须登记 `transit` 域的原因，见 `docs/desktop.md`。
- 站点级的 DOM/时序坑（豆包中英文间插空格、chatglm 水合期 ~30s、Kimi 换模型跳 `/agent`）写在 `docs/adapters.md` 的站点卡里，本节只记真机环境与工具本身的坑。

## 工具

- 设计技能：impeccable、make-interfaces-feel-better、native-feel-cross-platform-desktop 自 2026-10-02 起为用户级安装（`~/.agents/skills`，Claude Code 与 Codex 共用，由本机更新脚本维护），不再随仓库安装或锁定版本；Impeccable 在本项目生成的 `.impeccable/` 运行时产物仍由 `.gitignore` 排除。
- 资源归属记录：启动前设置 `POLYASK_RESOURCE_TRACE` 为尚不存在的本地 JSONL 路径，默认每 5 秒一笔，最长 30 分钟，关闭窗口即停止；不自动退出应用。启动期单列，CPU 首笔和每个新 PID/创建时间的首笔无有效区间，按 `cpuIntervalValid` 排除。进程数组按 PID 一笔，站点只关联主帧；不可把共享 PID 分别归到各站后再次求和，也不可将工作集总和称为独占内存。与 soak 分开运行，两者都读 `getAppMetrics` 会影响 CPU 采样区间。日志不含对话或网址。
- 只读探针耗时：开发态按上文启用本机 9223 调试端口后，在 `desktop/` 运行 `node scripts/probe-performance.mjs 9223`。脚本串行对已加载站点的生产隔离上下文各采 5 次 `generation()`、`answer()`、`toMarkdown()`，仅返回耗时、布尔值、状态和视口，不发送提问、不切档、不保存正文；结果写入打印出的临时目录。无回答时 Markdown 项为 null，不能据此宣称长回答处理很快。它测同步函数耗时，不包含生产 IPC 往返；零毫秒可能只是计时精度不足。缺适配器/执行失败会非零退出，尚未加载的站点不会凭空计入覆盖。
- 后台节流机制实验：在 `desktop/` 运行 `xvfb-run -a node scripts/test-safe.mjs command node scripts/background-throttling-lab.mjs`（有原生显示时仅去掉 Xvfb 前缀，保留受限入口）。临时档案、三个重叠且正尺寸的本地页面，拦截 HTTP/HTTPS；窗口先隐藏，再按关闭→全部允许→混合→恢复关闭→再次全部允许→再次恢复切换，直接覆盖 Electron 44.5.0 修复的「已隐藏时重新允许节流」路径。测动画帧、定时器与可见性；输出原始报告，不以特定节流比例作通关条件。此工具不触碰生产策略，不能替代九站后台生成、最小化和 Windows/macOS 验收。

2026-09-29 资源研究验收：Linux/WSL、Electron 43.4.0 开发态复用已授权档案，九站当前页面均无回答正文；约 165 秒共 34 笔资源样本，60 秒后进程工作集合计约 3.83–3.95 GiB，不能与此前 Xvfb 新档案样本作优化前后比较。九站生产生成探针各测 5 次，中位约 0–0.4ms；未测到 Markdown 转换，不能外推长会话性能。没有发送测试提问或切换模型，日志有部分网络解析/连接失败，不据此证明全部站点网络正常或已登录。

同日隔离隐藏窗口实验：关闭节流时每视图 3 秒约 180 帧/60 次定时器；全部允许节流时三视图均为 0 帧，但两视图仍约 60 次定时器、一视图约 3 次，可见性状态并不一致。恢复关闭后帧与定时器恢复，而隐藏状态也不全同步。这仅确认当前 Linux Electron 的机制及回退，不是九站兼容性或节电百分比证据；正式策略保持 `backgroundThrottling:false`，真实生成、长会话与 Windows/macOS 验收仍待完成。

2026-09-29 真实生成补测（源码 `18bfd81`）：用户随后明确授权九站各一次测试提问。Linux/WSL 开发态复用既有档案，从生产 `polyask:broadcast` 入口发送“请用中文写约 300 字，介绍如何整理日常工作笔记”，`tier:null` 保留当前模型/档位，不带图、不重发。发送前确认各站无正在生成的回答、无草稿；千问非零文本来自 Slate 空态占位节点，检查时仅在离线 DOM 副本中排除，未清空真实输入框。

| 观测区间（相对调用群发） | 5 秒采样数 | 进程工作集合计范围 |
| --- | --- | --- |
| 前 60 秒 | 12 | 3.912–4.016 GiB |
| 0–45 秒发送及生成 | 9 | 4.405–4.769 GiB |
| 60–180 秒后续观察 | 24 | 4.322–4.470 GiB |

以上是同次运行的阶段差异，不是优化前后对比或独占物理内存；不能据单轮会话保留的增长判定泄漏。九站提交均返回 `ok:true`，但 ChatGPT 仅有 `composer` 证据，后续未识别到本轮用户消息/回答，也未见可见登录按钮、错误提示或对话框，仍属未确认，未再次提交。其余八站只读 `historyTurn()` 可匹配本轮问题且出现包含笔记主题词的回答；七站提取正文 342–428 字符，豆包仅 60 字符，未达到约 300 字的测试要求。字符数含 Markdown，不能当作严格字数。

生产外壳仅 Claude/千问/Gemini/智谱进入 `complete`（约 10.9/7.5/24.8/35.4 秒）；DeepSeek/豆包/Kimi/元宝已有回答、只读探针为 `complete`，外壳仍为 `submitted`。现有监控要求先观察到 `generating` 才能确认完成；本轮未确定未观察到该阶段的具体原因，不应据此自动重发，也不能直接拿外壳阶段当自动节流的充分条件。ChatGPT 同样保留 `submitted`。

八站有回答后的生产函数各采 5 次：生成探针中位约 0.1–0.5ms，回答节点查找中位约 0ms，Markdown 转换中位约 0.1–0.6ms、单次最高约 0.7ms。计时为同步函数，不含 IPC，零值受计时精度影响；未发现这批短回答的明显序列化瓶颈，因此保持轮询频率和适配器接口。真实多轮长会话、后台节流下的生成及 Windows/macOS 仍未验收；本轮不启用生产节流，不宣称已完成九站生成验收或节省资源。

- 窗口恢复取证：启动前设置 `POLYASK_WINDOW_TRACE` 为**尚不存在**的本地 `.jsonl` 路径。`window-trace.ts` 从外壳就绪后记录 minimize/restore/maximize/resize 等事件、窗口尺寸/缩放、当前布局、站点视图 bounds/缩放/加载状态，并在 restore 后 0/50/250/1000ms 追加快照。首条含版本、GPU 功能状态及显示器缩放，不含网址、对话或账号信息。最多 2 分钟或 4096 条；写盘失败/背压停止采样，不影响应用。默认不建文件、不挂监听；不替代 Alt+H 的站点诊断报告。采样改变时序的可能性仍需考虑，日志只能证明尺寸/事件，不能单独证明画面没有闪动。

- `xvfb-run -a npm run smoke -- --skip-package`——真实 Electron 起一次，断言 shell=1、九站全部 attached 且 bounds > 0、同一 session 分区、sandbox + contextIsolation + 无 nodeIntegration。它是「preload 的 require 链仍解析」的唯一离线证据（打包期断链在别处不暴露）。
- `npm run soak -- --minutes=<n>`——长跑稳定性；`node scripts/audit-runtime.mjs`（在 `desktop/` 下跑）——Electron 本体的运行时依赖审计，`npm audit --omit=dev` 结构性看不到它（electron 按 npm 惯例永远是 devDependency）。
- `cd desktop && npm run configure-oauth`——用 Development Desktop Client 写出本地 `desktop/resources/oauth.json`，是涉 Drive 真机项的前置（凭据表见 `docs/desktop-oauth-security.md`）。
- 站点 DOM 取证回到**开发态 DevTools 手工看**：菜单展开前后各看一遍、比对差异，得出「展开后才存在」的锚点候选。隐私硬规则不变：侧栏 / 会话列表 / 消息容器整体排除，**产物外发给任何模型前先人工过目**。

## 快捷键链路

Desktop 的加速器分两类：`desktop/src/shared/commands.ts` 的 `COMMANDS` 表（`Alt+K/S/H/Q/T/Y/C/R/N`、`Alt+1..3`、`Alt+←/→`、`CmdOrCtrl+(Shift+)PageUp/Down`、`Control+,`），与**菜单 `role` 项自带的**那批（重新加载、缩放、全屏、撤销/复制/粘贴、退出）——后者不写在模板里、也不在 `COMMANDS` 表里，所以快捷键速查直接从 `Menu.getApplicationMenu()` 读真实菜单，菜单与速查从此不可能漂开。教训：**扫源码字面量的断言全绿 ≠ 用户看到的东西对**。离线由 `desktop/test/menu-shortcuts.test.ts` 与 `keyboard.test.ts` 守；**物理按键仍要人工按一遍**。

## 当前未发布改动的验收边界（2026-09-20）

- 决策卡、任务文件夹、备份恢复已有临时 SQLite、fake Drive 和隔离 Electron 回归；真实账号双设备的同步、冲突与删除恢复仍待验证。
- 引文报告、变量模板和定向追问已做生产模块及组件检查；真实模型是否遵守引文要求、登录站点的完整任务流程仍需实测。
- 资源基线仅覆盖 WSL2 / Xvfb 未登录环境的短时观测；进程工作集相加不是独占内存。登录后的生成态、长会话及原生 Windows/macOS 性能仍待测量，不能据现有样本宣称整体内存优化或长期稳定。
- 真实用户首次使用与完整任务测试尚未完成。本地设计记录不随仓库分发，以上验收缺口保留在本文件供后续维护。

## 1.0.0 发版前的真机清单（历史验收口径）

以下保留 1.0.0 准备期的检查要求，不代表本次已执行，也不凭版本已发布推定通过。当前源码版本为 1.0.2（2026-09-20 核对）；后续发版按改动范围与 `docs/release.md` 安排验收，未闭合事项继续保留。

门禁全绿只是前提。下面每条都在开发态 Electron 上真跑；涉 Drive 的两条先跑 `cd desktop && npm run configure-oauth`。

- **辅助综合**：从结果库发一次辅助综合，目标站应在**数秒内**进入 sending，而不是停在 submitted 走满 44s（终态码按 `timeout` 判读，不是 `composer_not_found`）。
- **本机数据四条**：① 清空提问历史后重启——历史为空、结果库仍在，库里 history 行仍在且 `deleted_at` 非空、outbox 有对应行；② 在一台连了 Drive 的机器上清空后，另一台同账号机器上对应条目也消失（证明 tombstone 真同步过去，不是本机物理删除）；③ 跑一次「重置全部本机数据」，确认 Drive 上的文件未减少、且另一台设备上的未知 host 选择未丢失；④ `Alt+H` 点「复制诊断报告」，粘贴内容含九站 check 的 `name/kind/ok`，不含对话内容与网址。
- **Kimi 提交恢复（最高优先，次序写死不许颠倒）**：第一轮开关 `POLYASK_KIMI_RESUBMIT` 保持默认 `false`，跑下节 F067 的两条硬用例，外加常规①——Kimi 单站发一段长文本，在提交确认窗口（约 3s）内制造 `submit_unconfirmed`，**页面不得出现重复的用户消息**；与常规③——其余八站 `supported:false`，行为不变、原样交用户。两条硬用例通过后，才在**单独一个 commit** 里把开关改成 `true` 并补跑常规②：确实未提交时只重试一次，重试后页面上只有一条该内容的用户消息。未跑或未过 → 开关保持 `false` 发版，`CHANGELOG.md` 不写「自动恢复」。
- **九站带档位群发**：Gemini 深度思考档、千问 / Kimi / 元宝三站的档位切换都成功，且 `Alt+H` 的 `tier` 项可读。
- **界面语言**：系统语言切到 zh-TW 启动一次，`Alt+H` 站点状态面板的 11 条 `diag_*` 检查名必须显示繁体，再切 en 复验；同一轮确认九个站点视图上不再出现横幅。
- **群发主链路**：九站群发一次带档位提问、再一次带图提问（6 个支持图片的站），收尾看一次 `Alt+H` 九站状态（全绿，或只剩 `tier` 提示项）。
- **CI 侧**：推 `v*` tag 前先在 GitHub 上跑通一次 `workflow_dispatch(dry_run=true)`——tag 不可覆盖，流程或 YAML 错一次就烧掉一个版本号。

## 2026-08-31 审计遗留：原 23 条真机事项

2026-08-31 那轮全仓体检留下 **23 条只能靠真机取证的未闭合项**（9 条「待真机取证后修」+ 14 条「存疑待真机」），编号沿用当时的 `F0xx`。其中一条在原始记录里就没有编号、无从追溯，下面能枚举的是 **22 条**。当时要求每条在 1.0.0 发版前落到「已勾掉」或「明确顺延」之一；以下保留既有状态，不能据此推定当前仍恰有 23 条未完成，也不能未经证据销号。

**最高优先——涉「提交不确定 ≠ 可以重发」红线，必须闭合**

- **F067 · Kimi `submitted()` 的空态语义**：新会话（页面无任何用户消息）时 `submitted(text)` 到底返回什么，从未真机确认过；判错就是同一个问题被问两遍。判据是两条硬用例——① 新会话空态下 `submitted(text)` **必须返回 false**；② 末条用户消息是上一轮内容时**必须判「未提交」**（返回 false）。
- **F211 · Desktop 侧 Kimi `wasSubmitted` 恢复**：只读确认已移植进主进程（回包的 `supported` / `ok` 两字段 fail-closed，绝不塌成单个 `ok`——塌了就会对没有 `submitted()` 的八站触发自动重试），重发开关 `POLYASK_KIMI_RESUBMIT` 是模块级常量、**默认 `false`**。判据：关闭态下走完上一节的常规①③；F067 两条硬用例真机通过后，才在**单独一个 commit** 里打开开关并补跑常规②。

**适配器 DOM 取证（8 条；取证手段是开发态 DevTools 手工看 DOM）**

- F049 · intl 三处 `sleep(700)` 是拍脑袋定值：量一次菜单展开实耗，确认 700ms 有 ≥20% 余量，否则改成夹取 `deadline` 的等待。
- F055 / F057 · Gemini 菜单判据缺窄屏证据：把窗口拉到 640px 以下复现窄屏分支，看菜单节点的 `aria-expanded` 是否真的翻转。
- F098 · ChatGPT / Gemini 的 `answer()` 可能把思考段一起收进来：两站各出一次带思考过程的回答，收集结果里不得含思考段。
- F072 / F078 · DeepSeek / 豆包 / Kimi 的停止键锚点未取证：三站各发一次长回答，生成中读停止键节点的 role / aria / 文本，与适配器锚点逐一比对。
- F068 / F077 · 豆包文案与菜单结构未复核：中英文界面各开一次档位菜单，核对词条与层级（控件下沉到二级子菜单是常态）。

**判据取证（3 条）**

- F059 / F047 / F046 · ChatGPT 与 Gemini 的若干判据是从旧 DOM 推来的：真机逐条对照现状，改锚点前先留证据再动手。

**共享运行时阈值（3 条；随迁移只变路径、不变内容，现都在 `desktop/src/site-runtime/`）**

- F095 · upload 阈值、F096 · md 前瞻窗口、F101 · 多图指纹：三条都要真机样本才能确认取值合理，离线用例只锁住了当前行为。

**其它（5 条）**

- F041 · 2026-09-23 已为切档路径透传绝对 deadline，覆盖轮询、等待、交互前检查与菜单超时清理；离线及开发态验收边界见本文件本轮记录。
- F139 · 便携版白名单不对称：发版前跑一次便携版产物解包校验（跨平台 CI 已有该步），据结果勾掉或顺延。
- F089 / F132 · ux 两条、F037 · 存储键序：原始审计报告已不可得，**端别判不出的一律按「与切除无关」顺延**，不得默认已随扩展一起消失。
- F121 · popup ux：随扩展删除消失，就地销号。

## 哨兵与报障

- **模型发布哨兵**：`scripts/watch-releases.js` + `.github/workflows/release-watch.yml`，每周一/四轮询官方 changelog/RSS/状态快照页，有新条目自动开 issue（label `release-watch`）。定位是闹钟——公告名 ≠ 网页 UI 标签，**禁止直接抄进适配器正则**（先真机核对）。真机/联网脚本**不得用 `test-` 前缀命名**：verify.sh 会强制把 `test-*.js` 登记进无浏览器无网络的 CI。仓库 60 天无 push 时 GitHub 会停用 scheduled workflow，Actions 页点一下即可重新启用。**`release-watch` label 是去重依据**（脚本按它拉已见标题集），分流整理时不要从旧 issue 上摘掉，否则对应条目会被重复开单。openai/gemini-blog 两源的宽 filter 混进大量营销/案例稿或月度回顾，标题带 `highSignal` 词表二次分级：未命中的**仍然开 issue**，只是标题加 `/low` 标记（正文首行提示多半非模型公告），不会静默丢条目；bailian 源反过来用 `NEVER_HIGH_SIGNAL`（只匹配空串）让整源恒为低信号，`lowSignalNote` 覆盖成「API 侧上线不代表网页已变」而非 openai 那句「营销/案例文」。claude/gemini/deepseek 三个 `datedSections` 源标题原本只是日期（deepseek 还把「Date: …」与型号名拆成两个独立 heading），现改成「日期 — 摘要」拼接（deepseek 因此天然把两个 heading 并成一条）；改格式前开的旧 issue 是纯日期/无 `/low` 的旧标题形态，去重逻辑对新旧两种形态都测，不会因为改格式而重复开单。
  - **源清单（2026-08 复核）**：openai（`openai.com/news/rss.xml`，rss）、claude（`support.claude.com` 消费端 release notes，datedSections——**2026-08 从 `platform.claude.com` 纠偏**：原源是开发者 Console/API/SDK changelog，窗口内 5 条 issue 全是 API 基建噪音、零命中过消费端变化；新源是服务端渲染的 Intercom 文章页，日期是「月份大标题 H2 + 日期小标题 H3」两级结构，`datedSections` 第四参 `groupHeaderRe` 负责把月份大标题从摘要来源里整条剔除，否则会产出「Aug 6, 2026 — July 2026」这种把下月月份名回收成上月摘要的糊涂账）、gemini（`gemini.google/release-notes/`，datedSections，官方渠道但被证实漏记选择器级变更如 3.7 Flash 换档）、**gemini-blog**（`blog.google` 的 Gemini Models 专栏 `/rss/`，rss，highSignal 抓「Introducing …」标准开头，弥补上一条的漏检）、deepseek（`api-docs.deepseek.com/updates/`，datedSections）、zhipu（`docs.bigmodel.cn` 功能更新页，zhipu 专用解析）、**kimi**（帮助中心「模型与模式怎么选」，**kind `snapshot`**——不是 changelog，是当前 UI 状态的一手快照，见下）、**bailian**（阿里云百炼「模型上线表」，**kind `bailian`**——跨厂商 API 上线信号，Qwen/GLM/Kimi 等经百炼平台上线的型号，表格倒序，`adapter` 字段说明按行内 Model type 对应站点，不是单一文件）。
  - **kind `snapshot` 方法论**：changelog 记录「发布了什么」，但 PolyAsk 真正关心的是「选择器现在长什么样」——两者不总是同步（公告可能没提 UI 变化，UI 变化也可能没有公告）。帮助中心一类「怎么选 / 模式说明」页往往是当前状态的一手快照，比 changelog 更贴合这个需求。`parseSnapshot` 只产 1 条 entry，正文（锁定 `<article>` 容器，防止抓进导航/侧栏噪音）摘要不变则不重复开单，摘要一变就当新条目——首轮自动登记为基线，不需要人工预置。目前只有 kimi 有这类页面；其余站点若发现同类「状态说明」页，同样值得优先于 changelog 纳入。
  - **历史联网结论（2026-08，本次未重新联网核实）**：元宝 / 千问（qianwen.com）/ 豆包官网都是需登录的 React SPA，纯 GET 拿不到渲染后 DOM，UI 变化只能靠巡检 diagnose 与真实群发失败信号兜底；腾讯混元「研究动态」页同样是 SPA（内容是模型动态、不是元宝产品本身），2026-08 复核仍无 RSS 或可穿透的 GET 路径，评估后未纳入哨兵——需要时得走渲染穿透而非本脚本的纯 GET；豆包无任何一手可轮询信号，只能靠真机巡检。openai 官方消费端页面（`openai.com/products/release-notes/`、`help.openai.com/en/articles/6825453-chatgpt-release-notes`）2026-08 复核仍对本环境返回 403（多种 UA 一致），维持现状不纳入。
- **用户报障出口**：`Alt+H` 站点状态里的「复制诊断报告」——内容是版本 / 系统 / 显示缩放、各站的 `phase` 与 `code`、以及逐项 check 的 `name`-`kind`-`ok`，**不含对话内容与网址**；配 `.github/ISSUE_TEMPLATE/site-breakage.yml`（按上面的四问预置问题）。


## 提问历史验收

自动化覆盖 SQLite version 4、schema 4 上下行、备份格式 2/旧格式读取、终态删除、选择性恢复、归属 token、重复文本、草稿复用与 UI 结构。针对性命令：`cd desktop && npm run test:unit -- "test/question-*.test.ts" "test/question-*.test.tsx"`；运行时：`npm run test:runtime -- scripts/question-history-runtime.test.js`。

开发态须逐站检查新会话、已有会话连续两轮、相同提问、流式期间保存、瞬间完成、网页直接追问、登录重定向及地址恢复。另测打开副本期间原站视口保持正尺寸、切换页后生成继续、关闭/重启后副本仍可读。测试资料应标明合成数据；检查截图不能代替消息归属证据。Drive 用两台授权测试设备验收新增、删除、迟到副本与旧客户端 schema 保护，不向未授权账户上传测试内容。

### 2026-09-21 登录站点合成验收

环境为 WSL/Linux 开发态 Electron；将已有站点登录分区复制到独立测试目录，应用数据库新建、Drive 未连接。原始资料目录未用于写入。通过外壳顶部输入框和发送按钮运行合成标记问题；只记录副本长度、标记匹配、轮次数量和脱敏路由，不导出账号或既有私人对话。

| 范围 | 证据与边界 |
| --- | --- |
| Claude、ChatGPT、Gemini、DeepSeek、豆包、千问、元宝、智谱 | 最终 K 轮正确保存 22 字符合成标记与会话地址；不能据此宣称长回答、所有模型/档位全部通过。 |
| Kimi | 首屏漏存已专项复现：空基线的同一用户节点在回答前经历临时与正式 `/chat/<id>`。限定一次迁移后，重启开发态首屏正确保存 24 字符标记与地址；思考回答最终保存 2,488 字符，图片回答保存 42 字符。旧会话不匹配仍拒绝归属。 |
| 相同提问分次保存 | 从顶部先群发 G，再向 Claude/千问/智谱发送相同文字；产生两条独立记录，参与站点分别保留，网页已有会话继续新增轮次。 |
| 网页直接追问 | Claude 真实输入事件后直接发送新的合成问题；旧副本正文保持不变、已封存，未混入后续回答。 |
| 重启与原站恢复 | 重启后读取副本，并恢复 K 轮八站及 L 轮 Kimi；实际页面的原问题、回答标记均匹配。批量恢复中 ChatGPT 页面已出现正确内容但 loadURL 超过单站预算，后续智谱因总预算取消；单站补验分别为 already_open/opened，状态未伪装成功，过程中没有重发提问。 |
| 实际采集数据备份 | 格式 2 导出后恢复到新库：12 条提问、78 次尝试（45 份有正文），逐条比对正文和会话地址一致；此项是本地备份验收，不是 Drive 同步验收。 |
| 自动完成判定 | 停止键缺失、回答节点出现、文本静止均不足以证明完成；当前历史副本保留“完成状态未知”，不截断暂停后的流式正文。 |

本轮真机暴露并修复了用户消息选择子、读屏重复文本、乐观消息重挂、空回答占位、Markdown 子节点重绘、ChatGPT 临时 WEB 路由、元宝双段路径与智谱 cid 参数问题。独立审查追加了生成暂停/立即重新生成、同文本旧会话导航、绑定前浏览器后退的离线负向回归。

### 2026-09-21 追加自动验收

| 场景 | 实际结果 |
| --- | --- |
| 九站相同文字连续两轮 | 全部实际提交；八站两轮分别保存，Kimi 首屏路由缺陷按上表修复并补验。新发送保留旧记录。 |
| 快速 / 思考预设 | 九站均执行。快速轮千问提交成功但返回 tier_unconfirmed，不冒称切档成功；Gemini 初轮 submit_unconfirmed，后续遇到 Google `/sorry/index` 验证页。思考轮其余八站取得带标记正文；Gemini 在触发验证页前已保存 3,784 字符思考回答。 |
| 长思考与分段代码 | Claude 持续生成后保存 6,115 字符；Kimi 最终 2,488 字符。智谱旧代码曾把思考当正文、最后只留 361 字符；修正正文容器及 `.enter.searching` 后，174 秒时仍持续采集，保存 2,153 字符，代码与结尾齐全，正文容器不含思考节点。 |
| 真实重新生成与副本保护 | Claude、ChatGPT、DeepSeek、豆包、千问、Kimi、元宝、智谱使用可信鼠标或键盘执行重生成入口/菜单；八站旧副本均封存且正文不变。ChatGPT 实际选择 Try again；元宝实际选择 Regenerate；自定义 div/i 控件与普通按钮均覆盖。Gemini 此项被站点验证页阻塞。 |
| 网页分支 | ChatGPT 实际进入 Open new branch → Branch in new Chat；旧副本保持封存与原文。直接追问已有 Claude 真实输入证据；输入/编辑与同文本导航的否定分支另有运行时回归，不据此宣称每站所有版本控件都通过。 |
| 六站图片 | 同一张本地生成的蓝/绿合成图：Claude、ChatGPT、DeepSeek、Kimi 正确描述颜色并保存对应标记、地址。豆包、元宝在已有会话与独立新会话均返回 submit_unconfirmed，未捕获本轮用户消息，副本不可用；没有自动重发。这是修复前记录；后续专项复测结果见下文。 |
| 历史面板与后台生成 | 打开历史面板后九站视口均为正尺寸；期间采集持续，返回原站后长回答继续保存。 |
| 未登录原站恢复 | 新建无站点登录分区的隔离实例，仅复制合成应用库；九站有地址记录均能发起打开，实际页面均出现登录提示，原问题不可见但本地副本可读。opened 仅表示打开网页，不表示账号已授权读取；缺地址记录返回 missing_url，提问数量不变。未使用第二套真实账号。 |
| 本地门禁 | 649 项 TypeScript/React + 71 项运行时测试通过（720 项）；verify.sh、Linux package 与 smoke 通过（shell=1、sites=9、attached=9）。新增测试覆盖首屏迁移边界、自定义控件封存、智谱正文与思考隔离、纯思考固定预算以及迟到正文拒收。 |

后续专项复测前明确未通过/受阻的是：豆包与元宝图片提交未确认；Gemini 后续网页操作被 Google 验证页阻塞；没有第二套授权账号，未测试切换真实账号访问旧会话。真实 Drive 双设备/旧客户端与 Windows/macOS 原生仍在本轮范围之外。以上与已执行的本地同步、备份及未登录恢复分开记录，不以本机测试替代云端或原生验收。不开启 Kimi 自动重发开关。

### 2026-09-21 豆包、元宝图片专项复测

继续使用仅复制站点登录态的隔离开发资料。重启开发态，经外壳真实 broadcast → 生产 `__AMS` 验证，不替换适配器实现、不自动重发不确定提交。

- 豆包：图文分气泡导致轮数误计；连续提问时虚拟列表又会回收旧节点。修复逻辑轮次分组，并用同路由下稳定的前驱消息 ID 校验连续归属。不同新消息 ID、精确文本及前驱匹配缺一不可。
- 元宝：新版拖放失效，须 Add → Upload Image 创建/激活文件输入。仅复用残留 input 的第二次上传仍失败；每轮重新打开菜单后恢复。菜单轮询和上传前均检查绝对 deadline，finally 关闭菜单并移除临时选择窗拦截。
- 最终 E/F 两轮：同会话先一张、再两张本地合成蓝绿图片。两站四次提交全部确认，四份副本分别包含对应 E/F 标记、正确颜色描述和会话地址；发第二轮后首轮副本正文保持不变。副本完成状态仍为未知，不凭停止键缺失冒称完成。
- 修复前 B/C/D 探测保留失败事实：首轮单图可用，连续两图曾出现豆包已发送但未采集、元宝提交未确认；最终结果不将这些失败改写为通过。
- Gemini 正常打开后仍重定向到 Google `/sorry/index`，需用户人工完成验证。未绕过验证，也未将此环境阻塞报告为已修复。真实 Drive 双设备及 Windows/macOS 原生验收仍未执行。
- 本轮门禁：649 项 TypeScript/React 与 81 项运行时测试通过；类型检查、verify.sh、Linux package 和 smoke（shell=1、sites=9、attached=9）通过。原资料目录数据库与 Cookies 的大小及修改时间保持不变。


### 2026-09-21 Gemini 恢复访问后的专项复测

用户反馈恢复可访问后，重新启动同一隔离开发资料；页面正常进入 gemini.google.com，未跳转 Google 验证页。本轮未修改运行时代码，也未绕过站点验证。

- 生产群发快速档 G、思考档 H 均返回 ok；本地历史分别保存对应合成标记的完整正文与会话地址，完成状态仍保守标记未知。
- 使用可信键盘事件执行原站 Redo → Try again，页面出现 Previous version / Next version 控件并显示新回答；G 的旧副本已有冻结时间且正文仍等于原标记。
- 先新建会话离开，再通过历史 previewQuestion → restoreQuestion 恢复 G：返回 opened，真实页面中 G/H 两轮问题及回答均可见；历史提问数量不变，没有重新发送。
- 因此此前 Gemini 验证页阻塞的快速档、重生成及历史恢复项目已补验通过。该结论仅适用于本轮隔离 Linux 开发态，不保证 Google 验证页不会再次出现；真实 Drive 双设备、切换第二套账号及 Windows/macOS 原生验收仍未完成。

### 带图发送与历史回归（2026-09-22）

重启开发态，使用已登录档案和真实外壳 `broadcast`（生产 `__AMS`），向九站各发送同批 4 张 128×128 的红/绿/蓝/黄测试图。最终验收九站均 `ok:true`，逐站读取历史回答均确认 4 张且颜色顺序一致，记录附图数量为 4、回答保存数为 9/9。该用例包含已有对话中的后续提问，守住附件栏展开后旧消息图片移出锚点的边界。回答副本仍按现有只读完成策略标为“完成状态未知”，不伪造完成信号。

真实外壳验证历史再问：附图提示与当前草稿附件清除提示都出现；取消保留附件；确认只恢复文字并清除附件。自动回归覆盖独立预览计数、同源图片重数、透明祖先内 spinner、超过 5 秒仍忙碌、部分上传失败、重试复用及原生残留附件拦截。两个 SQLite 实例经真实同步引擎和模拟 Drive 验证 schema 4 的文字、回答与附图数量往返；未声称实测两台电脑或原图同步，当前格式不包含原图片。

真实 Kimi 另验：同批已确认附件再次调用上传入口不会增加附件；换批次返回 `attachment_conflict`。通过生产 `clearUploadReceipt()` 清除内存确认记录后，保留的原生附件仍被拦截（1 张 → 1 张）。隐藏入场动画中的原生附件也有独立自动回归，拦截不依赖透明度。验证结束只按明确测试文件名或测试图片哈希清理附件，不按通用删除按钮批量清理。

### 分页发送计数（2026-09-22）

重启开发态后，经真实外壳向九站发送简短计数测试。4–6、7–9 页各三站已提交，均显示 `✓3`，即使其中站点仍停在 submitted、未确认回答完成。1–3 页此次 Gemini 超时，显示 `✓2 ×1`，逐站提示包含超时原因，没有自动重发。真实组件另覆盖全失败 `×3`、失败与取消、已发送/未确认/取消混合、发送中；独立 Electron 中浅/深主题 × 紧凑/舒适密度 × 五种状态共 20 组徽标边界检查通过。新一轮清旧计数、子集重试保留其他结果、页面故障保留发送结果由离线回归守住。

### Claude Opus 5.5 档位（2026-09-23）

重启开发态 Electron 后，在 Claude 站点的隔离上下文调用生产 `__AMS`，完成 fast → think → fast，以及额外一次 think → fast：按钮分别为 `Opus 5.5 Medium` / `Fable 5.1 Max 3.5× or more usage`，`getState()` 分别为 fast / think。菜单退出动画结束后，无残留 `[role=menu]`，模型入口 `aria-expanded=false`。环境为 Linux 开发态、英文、592×1068 站点视口；没有发送提问，不代表已比较回答质量、生成速度或额度消耗。旧版 effort 子菜单与新版平铺 group 的语义归属、缺少入口及点击未生效分支由离线回归覆盖。

### 2026-09-23 可靠性与查询优化

- 真实内存 SQLite 与延迟探针覆盖：切换前等待在途回答、2.5s 总预算、取消后拒收、旧轮进行中新 token 的补采。
- Drive 使用真实同步引擎、内存库与模拟时钟/网络覆盖到期唤醒、连续编辑、revision 冲突、拉取故障退避、Retry-After、断开与重连；不等于真实双设备验收。
- 历史真实 React 组件交互命令：`cd desktop && npm run test:unit -- test/question-history-interaction.check.ts`。测试自行构建临时夹具并启动隔离 Electron，覆盖返回/Escape/关闭/切换/删除、多页刷新、慢列表与慢详情；详情菜单首个 Escape 只关闭菜单，原生 Tab/Shift+Tab 关闭菜单并保持历史页焦点顺序。阅读专项另验三语 1100/640/420px 工具栏布局、当前副本与整条提问的操作范围及图标复制完整正文；不连接站点或 Drive，不纳入普通 npm test 的无图形门禁。
- 查询性能取 WSL/Linux 内存库 1,000 条合成结果、每条 34,500 字符正文、每题两站副本，11 次查询中位值。选择性结果搜索从约 343ms 降至约 133ms；并行开发负载下仅作该样本参考，不代表真实大库或原生 Windows 性能。历史每页 SQL 次数由 51 降为 2，但本轮耗时约 9.5→12.6ms，未测得延迟收益，不据此宣称加速。结果库未筛选全量列表仍有规模上限，后续分页需独立测量。
- token 原子替换用真实临时文件与旧 inode 硬链接验证，另测替换失败时临时文件清理；未验证断电或原生系统密钥环故障。
- 重启隔离 Linux 开发态，在真实九站的生产 `__AMS` 验证切档：Claude、ChatGPT、Gemini、DeepSeek、豆包、Kimi、元宝、智谱的快速→思考通过；九站均拒绝 1ms 到期预算下的切档。千问思考成功，快速仍报模型缺失：当前约 8.331s、独立基线约 8.346s，实际菜单仅提供 Qwen3.7-千问、Qwen3.7-Max、Qwen3.6-Flash，均无既定目标 Qwen3.8-Max；两版返回后等待 500ms，menu/dialog 节点均为空。此为已复现的原有模型不匹配，本轮未修改模型策略，不能宣称九站正常切档全部通过。本轮没有发送新提问；“切档预算耗尽后群发仍继续”由离线生产运行时回归验证。
- 历史组件八类真实交互通过；结果库 18 组布局及交互通过，重新生成的十张截图均非纯色，并目视复核浅/深色 1600 阅读界面。截图工具新增字体与渲染帧等待、空白像素检查，持续空白会失败，不再将截图文件存在当作有效视觉证据。
- 最终门禁：694 项 TypeScript/React 与 113 项运行时测试通过（共 807 项）；独立 typecheck、verify.sh、Linux package 和 smoke（shell=1、sites=9、attached=9）通过。真实 Drive 双设备及 Windows/macOS 原生验收未执行，Kimi 自动重发仍关闭。

### 2026-09-24 千问日常聊天预设

按用户最终选择，两档统一 Qwen3.7-千问：快速档为“快速”，思考档为“思考研究”。不再寻找日常菜单中没有的 Qwen3.8-Max，也不尝试为 Qwen3.7-Max 开启网页不支持的“思考研究”。

重启隔离 Linux 开发态后，在真实千问页面调用生产 `__AMS.runMode`，快速→思考→快速→思考四次均成功；模型始终为 Qwen3.7-千问，按钮及 `getState()` 对应快速/fast、思考研究/think，每次返回后等待 500ms，menu/dialog 节点均为 0。本轮未发送提问，不据此判断回答质量。694 项 TypeScript/React 与 113 项运行时测试、独立类型检查通过；离线另覆盖非预设模型拒绝识别、真实模型选择与点击未生效分支。

### 2026-09-28 v1.7.0 发版回归

- 700 项 TypeScript/React 与 113 项运行时测试、独立 typecheck、仓库校验及两项运行时依赖审计通过。
- Linux package 与 smoke 通过（shell=1、sites=9、attached=9）。当前 WSL 桌面会话下 smoke 等待诊断文件超时，移除 WAYLAND_DISPLAY 仍超时；使用 `env -u WAYLAND_DISPLAY xvfb-run -a dbus-run-session -- npm run smoke -- --skip-package` 的独立会话后通过。此结果指向桌面会话环境差异，未修改应用或放宽 45 秒超时。
- 隔离 Electron 外壳 96 组、结果库 18 组布局及界面细节、三平台确认框分支回归通过；已抽查截图。
- Windows/macOS 原生字体、系统菜单、输入法及读屏、五种发行包原生安装仍未验收；本版未重跑九站群发、真实 Drive 双设备同步，未核验 Google Cloud 控制台授权状态和监控指标。

### 2026-09-28 ChatGPT 新版入口修复

- 在用户明确授权后，直接使用 `~/.config/PolyAsk` 登录资料启动 Linux 开发态 Electron，CDP 仅监听 `127.0.0.1`。未复制登录资料、未发送提问。
- 修复前生产 `__AMS` 复现：输入框可达，Intelligence 入口检查失败、state=null。新版入口已无 `__composer-pill`，实际带 `data-codex-intelligence-trigger="true"`；隐藏测量文字使 textContent 为 `Thinking effortMedium`，innerText 为 `Medium`。
- 修复后重启开发态，生产 `__AMS.runMode` 快速→思考→快速均成功，分别为 `5.6 Sol Instant` / `5.6 Sol Pro` / `5.6 Sol Instant`。每次等待 400ms 后入口 aria-expanded=false、role=menu 数量为 0，三条诊断全绿。结束时恢复测试前的 Latest / Medium 并关闭调试实例。
- 701 项 TypeScript/React 与 113 项运行时测试、仓库 verify.sh 通过；新增回归先在旧代码下失败，再验证新版与旧版入口、中文标签、隐藏测量文字、展开态及入口缺失分支。
- 真机环境为 Linux、英文页面、465×1011 站点视口；Windows 150% 中文原生环境未实测，中文「最新 - 中」由离线回归覆盖。本轮未执行实际群发或 Drive 同步验收。

### 千问缺少模型入口的修复前排障（2026-09-28）

- 使用 `~/.config/PolyAsk` 直接启动 1.7.3 开发态，指定 `--user-data-dir="$HOME/.config/PolyAsk" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`，在千问隔离上下文调用生产 `__AMS`。正常首页为日常 / Qwen3.7-千问 / 快速；思考→快速均返回 true，`getState()` 与按钮对应，诊断全绿。
- 临时 CDP 视口变化后，实测 `innerWidth=355` 时入口存在，`267` 时入口从 DOM 消失；后者诊断与用户报告相同，`runMode('think')` 返回 false。恢复至 `519` 并等待布局后，入口恢复，思考→快速再次成功。数字仅为本次采样，不作为产品判定阈值。有效 `devicePixelRatio` 始终约 1.35（页面缩放参与计算），不是 Windows 150% 的等价验证。
- 工作页会同时缺少模型和思考入口，与用户报告不一致；已恢复日常和快速。用户补充的另一台 Windows 电脑截图是宽页面日常首页但没有模型入口，本机宽页仍有；本机窄栏只能复现失败链路，远端差异原因尚未确定。
- 本次没有发送提问，不据此断言群发或回答已通过；未修改适配器逻辑。远端无入口页面的切档适配仍未完成。


### 千问无模型入口兼容验收（2026-09-28）

- 在上一节证据基础上，经用户同意新增“确认日常页就绪后只切模式”的分支；有入口继续选 Qwen3.7-千问，无入口不承诺底层模型。新增 16 项行为回归覆盖成功切换、工作/未知页、未选中或不可见日常标签、输入框/模式按钮缺失、选项缺失、点击被吞、截止时间、正文模型名干扰及入口恢复；先观察失败再修改生产代码。
- `bash scripts/verify.sh`、`cd desktop && npm test`（701 项应用测试、129 项运行时测试）及独立 `npm run typecheck` 均通过；独立代码审查发现正文模型名可能冒充入口，已将文字回退限定在真实顶部 `.desktop-no-drag` 区域并补回归，复核通过。
- 重启使用 `~/.config/PolyAsk` 的开发态，先确认旧调试端口释放，再确认隔离上下文加载新版 `_modeOnly`。正常视口 `innerWidth=467` 和真实站点移除模型入口后的 `267`，各调用生产 `__AMS.runMode` 思考→快速→思考→快速，8 次全部返回 true；模式按钮与 `getState()` 一致，每次等待 650ms 后可见 menu/dialog 均为 0。
- 无入口时模型检查为 `ok:false, kind:tier`，其余检查通过；有入口时四项检查全绿。恢复原先宽度及日常/快速状态。有效 `devicePixelRatio≈1.35`，不把 Linux/CDP 验证称为 Windows 150% 原生验收；另一台电脑宽页无入口版本仍需用户环境验收。本轮未发送提问或验证九站群发。

## 2026-09-29 生成状态与新版 ChatGPT 复核

继续测试时，对异常五站各发一次新通用问题采集状态变化；ChatGPT 输入注入成功且发送按钮点击时仍有文本，随后出现 Stop 与回答操作控件，本轮排除“注入先被回滚为空”的假设。ChatGPT 新版轮次/正文属性、四站停止键漏匹配均有实时 DOM 证据；豆包补采后确认停止控件是无 button 角色的 break-btn 容器。首轮未保留足够 DOM，不能倒推首轮 ChatGPT 的实际回答情况。

修复后的 Linux/WSL 开发态测试使用生产群发入口，保持当前模型、无图片、无重发。ChatGPT、DeepSeek、Kimi、元宝均依次上报 submitted/generating/complete，完成约为 15.4/4.3/17.2/10.6 秒；各站本轮用户数为 1，提问精确匹配，提取正文分别为 354/382/272/420 字符。豆包在此轮尚未应用最终停止键修复，有 59 字符正文但仍 submitted；补齐后再次重启开发态单站验证，约 1.0 秒 submitted、1.1 秒 generating、14.2 秒 complete，本轮提问匹配、用户数为 1。测试问题的约 300 字要求不是站点准确遵守的保证。

新增隔离验证命令：仓库根运行 `xvfb-run -a desktop/node_modules/.bin/electron desktop/scripts/generation-dom-smoke.cjs`（有显示服务可省略 xvfb-run）。临时 profile 内拦截 HTTPS 返回合成页面、阻断 HTTP；不访问账号、不发送提问。真实 Chromium 选择器覆盖五站停止键/发送键对照，以及 ChatGPT 旧答→新用户→思考→新正文、同根 Markdown 替换、新旧用户标记去重和直接追问归属终止。它补足 VM 选择器字符串桩的局限，不替代生产站点验证。

此修复是后续资源策略的可靠性前提，不是 CPU/内存优化收益；生产 `backgroundThrottling:false` 与探针频率保持。跨平台、长会话及启用后台节流后的兼容性仍待验证。

最终离线门禁：727 条 TS/TSX 测试及 179 条脚本测试通过，独立 typecheck、仓库 verify 与真实 DOM 隔离 smoke 通过；Linux 打包成功，产物 smoke 确认 shell=1、sites=9、attached=9。

## 2026-09-29 空闲节流实验准备

实验开关为 `POLYASK_IDLE_THROTTLING_EXPERIMENT=1`，与 `POLYASK_RESOURCE_TRACE=<新的本地jsonl路径>` 同时传给开发态启动命令。默认不开启，也不写入用户设置。策略与接线测试覆盖未知/未确认/发送/生成/取消等阶段拒绝、恢复同步关闭、提交前同步唤醒全部站点、新视图首个命令、同文档导航、过期探针与成员变化、部分设置失败的回退、IPC及监听销毁。复审实证发现并修复了 SPA 导航未唤醒、新视图首个命令漏登记两条竞态。

实际发送共 25 次：首轮九站，后两轮各八站；三轮均为无个人信息的通用工作方法写作题、保留当前模型档位、不带图。Gemini 首轮超出脚本的 120 秒观察窗仍为 generating，未重发；重启后该页未恢复出对应轮次，不计作成功回答或多轮样本。其余八站完成三次新提问，后两轮均出现本轮回答；豆包每轮仅约 60 字符，不能算长回答。其它站最后一轮正文约 1359–2314 字符，页面可见文本约 3461–7525 字符（含界面文字，非严格对话 token 数）；Claude/DeepSeek 的当前可见用户计数仅为 1，未据 DOM 计数倒推实际发送总轮数。此规模不覆盖几十轮或超长文档。

测量工具另修复主帧选择：Electron 同进程子帧也可能有同名 isolated context，现通过 `Page.getFrameTree` 的主帧 frameId 精确匹配，缺失时不借用子帧。首轮旧脚本误读 Claude/ChatGPT 子帧产生的“不可用”结果已排除，不作为站点故障证据。

当前 WSL 桌面两次调用 BrowserWindow.minimize()（第二次等待 2.5 秒）均保持 isMinimized=false、isVisible=true，因此不能在本机宣称原生最小化自动策略通过。门槛没有放宽为隐藏窗口；后续手动隐藏对照只检验 Chromium 机制，需原生 Windows/macOS/Linux 桌面另验最小化、后台发送、取消与恢复操作。

### 同进程隐藏窗口对照结果

保持同一批九站页面，不重载、不发送，手动设置全部站点的 backgroundThrottling 为关闭→允许→关闭，各段 90 秒；每段舍弃前 15 秒，剩余 15 个有效样本。自动策略开关保持关闭，这不是其端到端验收。

| 隐藏阶段 | CPU 指标中位数 | 进程工作集之和中位数 |
| --- | --- | --- |
| A1：关闭节流 | 4.124 | 4.694 GiB |
| B：允许节流 | 3.675 | 4.698 GiB |
| A2：再次关闭 | 4.274 | 4.684 GiB |

CPU 指标为 Electron 各进程 cpuPercent 之和，非系统归一化占用率或耗电量。B 相对 A1/A2 分别降低约 10.9%/14.0%，但仅单轮短时实验，区间重叠，尚不能视为稳定收益。工作集包含共享页重复计数，非独占物理内存；未观察到内存降低。

三段资源采样均完成；随后并行帧响应检查在 Gemini 页面执行异常，未获得完整恢复延迟数据，恢复后 30 秒采样未执行。finally 及后续独立检查确认窗口可见、九站标志全部为 false。重新连接主帧后九站输入框存在且为空，八站为 complete、回答长度与此前一致，Gemini 为 idle 且无回答；生产只读性能工具九站各五次采样通过。该补查不等价于恢复延迟、视觉完整性或后台发送验收。

最终验证：751 项 TS/TSX 与 182 项脚本测试通过，独立 typecheck、真实 Chromium DOM smoke、仓库 verify 通过；Linux 打包成功，默认状态及开启实验环境变量两次产物 smoke 均为 shell=1、sites=9、attached=9。开关开启的 smoke 仅证明装配和启动正常，不证明最小化策略实际触发。完成测量后正常退出开发态。当前结论是保留默认关闭，原生平台验收及多次对照完成后再决定是否启用。

## 2026-09-29 Windows 原生验证与登录态事故

使用用户指定的 Windows 便携版档案，临时 Windows Electron 43.4.0 加载提交 `067ddb2` 的已验证 bundle；运行期确认 platform=win32、isPackaged=false、userData/sessionData/站点 partition 均指向指定档案，显示缩放为 150%。未替换原安装程序或复制登录凭据。此方式为开发运行时，不是 Windows 发行包验收。

**本轮发生登录态丢失，不能作为无副作用验收通过。** 首次启动前漏查 Cookie 加密 fuse：原安装程序为 true，裸 Electron 为 false，且未先建立可恢复副本。发现多个站点未登录后，才将临时二进制该项改为 true 并重启；用户随后确认原先九站已登录，而原装程序也已掉登录。运行时不兼容操作是本轮事故，不能归因于用户档案不可复用或要求用户重新登录来替代事故处理。性能测试已停止，临时实例及复核用原装实例均正常退出。

恢复阶段执行了只读检查，未找到可用的恢复来源；部分系统历史副本检查未完成。用户选择停止恢复并自行重新登录，因此未执行提权查询，也不再访问正式档案。恢复阶段未重置、清空或改写 Cookie 数据库，登录态未恢复；这不等于所有恢复途径都已排除。

Cookie 开关对齐后取得的有限功能证据：

- 三轮普通/最大化窗口的真实最小化均使九站自动允许节流，恢复调用后九站标志全部为 false；每轮恢复后站点边界与该轮最小化前一致。恢复 1 秒后测双帧回调，27 次均成功，约 4.6–31.9ms；这不是从点击恢复到可交互的完整延迟，也不证明视觉、输入法验收。
- 仅在当时确认有头像与历史入口的 Kimi 发出一条合成通用问题，保留原模型、不带图。发送前窗口真实最小化且九站标志为 true；在生产通道实际 dispatch 处观察到全部为 false，整个生成期间保持关闭；约 22 秒完成，末条用户消息精确匹配、正文 700 字符、输入框为空。提交回包证据为 composer，完成后的消息匹配是独立补查。
- 另发起一次合成请求，在 sending 通知时立即取消。返回 cancelled，16 秒观察期内全部不节流；取消替换了 Kimi WebContents，旧 CDP 上下文最终检查超时，重新连接后用户消息仍为 1、取消问题不匹配、此前 700 字符回答保留、输入框为空。未自动重发。
- 最小化期间刷新专项的初始采样未保持最小化，该轮不能计作导航唤醒通过。九站真实后台群发、Windows 资源收益、macOS 均未完成；保持实验默认关闭。

### 后续：独立 Windows 测试档案（用户已同意）

长期测试环境位于 Windows `%LOCALAPPDATA%\PolyAsk-TestLab`，`profile` 专供用户手动登录，保留复用，不从正式档案复制凭据。入口为该目录的 `Launch-Test.cmd`（调用同目录 PowerShell 启动器），窗口标题固定为“PolyAsk · 独立测试档案”。程序、运行时与日志分目录保存；升级程序时不得删除或替换 profile。当前先仅选择 Kimi、focus 布局，Drive 未配置且未连接；等待用户登录后再做真实站点验证，本轮搭建未发送问题。

临时开发入口在加载生产 bundle 前固定 userData/sessionData；启动器和入口拒绝目录链接、非预期根目录或数据路径、变更后的运行时。初次搭建的 manifest 记录 Electron 43.4.0、已开启 Cookie 加密的二进制 SHA-256 与当时源码提交 `067ddb2`，不以版本相同代替二进制校验。运行时更新必须先复核加密设置，不能直接更新指纹绕过检查。仅回环调试端口 9224/9231，实验开关只存在于本次测试子进程环境；正式程序默认策略未改变。

已执行 7 项入口隔离检查（正常独立路径，以及加密标记、运行时指纹、版本、缺失/错误路径参数、目录链接的拒绝分支）；实际 Windows 启动后再次核验 Cookie 加密 fuse 为 true，userData、sessionData 和站点 partition 全部落在上述 profile，窗口标题正确、Drive connected=false。此轮未访问正式档案。测试工具保存在该 Windows 本地目录，未作为发行程序或跨机器通用测试命令入库。

### 独立档案登录 Kimi 后的原生验收

用户手动登录后，先核对运行时、userData/sessionData、窗口标题与 selectedSites=['kimi']，再走生产群发入口，保留原模型、不带图。首条通用问题发送后约 22 秒，窗口在仍上报 generating 时恢复前台，原因未确定；该次不计作全程最小化通过。只读补查确认提问匹配、回答 754 字符、输入框为空，未重发。

另用不同的新问题补验：最小化后自动允许节流，实际 submitPrompt dispatch 前已关闭节流，全部生成采样保持 minimized=true、backgroundThrottling=false；submitted/generating/complete 距 sending 约 0.661/1.566/18.845 秒。末条提问匹配、用户轮次数为 2、正文 461 字符、输入框为空。另一次合成请求在 sending 通知时立即取消，返回 cancelled，16 秒观察期持续不节流；新视图的用户轮次仍为 1，取消问题未出现。取消后的首次编辑器检查不可见，不能据默认长度 0 宣称输入框为空；后续生产刷新、恢复及下一条发送前已确认编辑器存在且为空。

三轮普通/最大化窗口恢复均同步关闭节流，恢复后视图边界与各轮最小化前相同；恢复 1 秒后测双帧约 20.6–32.4ms，均未超时，不等同于完整恢复延迟。最小化期间经生产入口刷新 Kimi，立即关闭节流，8 秒后仍保持关闭；恢复后再次最小化可重新允许节流。本次补齐该导航用例，没有手动改写生产节流标志。

最后正常退出并经原隔离启动器重启同一测试档案，重新核对路径；Kimi 输入框可用且为空，登录态检查通过。测试窗口保留供后续使用，未访问正式档案。整轮共两条不同的正常问题及一次取消请求，没有自动重发；本轮仅验证 Windows/Kimi 的控制链与一次登录持久性，不代表九站兼容、长期登录稳定或 CPU/内存收益，实验默认关闭不变。

### Windows 单站 CPU 重复对照与内存归因

独立测试档案、同一 Electron 进程及已登录 Kimi 空白首页，禁用自动策略及资源日志以避免多个 getAppMetrics 采样器互相干扰；真实最小化，手动关闭/允许节流按 A1/B1/A2/B2/A3 各 60 秒，每段舍弃前 15 秒、保留 9 个样本。全程站点 PID 不变、最小化与节流标志符合预期，结束恢复可见及关闭节流；未发送问题。

| 阶段 | CPU 指标中位数 | 私有内存之和中位数（MiB） |
| --- | --- | --- |
| A1：关闭 | 0.0868 | 729.0 |
| B1：允许 | 0.0808 | 716.5 |
| A2：关闭 | 0.0844 | 721.6 |
| B2：允许 | 0.0938 | 731.7 |
| A3：关闭 | 0.0941 | 727.4 |

CPU 仍为 Electron 进程指标之和，不是任务管理器整机百分比；本次空闲值低、区间重叠，B2 高于 A2，未证明稳定节省。上述内存采用 Windows privateBytes，不与此前 Linux 工作集直接比较。该测试是机制对照，排除了自动策略自身探针开销，不能视作完整策略收益。正式程序继续默认关闭实验。

复用此前 Linux 九站隐藏对照的资源记录，九个站点主帧进程的工作集中位数合计约 3.1 GiB，外壳约 137 MiB；共享页可能重复计数，未归属的子帧/进程不能强行分配到站点。说明页面生命周期是内存优化重点，不代表 Windows 九站的实际占用，也不能将 Gemini 当作已完成多轮回答的样本。

针对内存回收检查实际 ViewManager 代码的隔离运行桩：生成中取消勾选时保留 3 个视图，标记完成后仍为 3，再次选择操作才降到 2。这是修复前的延迟释放复现；后续已在 `7052a82` 修复。释放须同时确认未选中、无发送/生成任务及答案采集结束；UI 的 complete 不代表历史副本已封存，实际历史完整性约束及原生结果见下文。

同一空闲 Kimi 页面另做可见视图尺寸/释放顺序实验，每阶段舍弃前 15 秒：1576×907 原宽、846×907 窄宽、恢复原宽的应用私有内存中位数分别为 715.5/842.8/743.0 MiB，GPU 部分为 403.0/532.0/429.8 MiB；本次未证明缩小绘制面积能降低内存，不据此修改后台视口。随后经生产选择入口取消全部站点，私有内存降至 497.0 MiB（相对恢复原宽减少约 246 MiB），再选 Kimi 为 824.5 MiB；重载期间的短窗不作为稳定常驻值。各阶段为 30 秒，窄宽为 45 秒，未发送问题或清理缓存/登录数据。

五段采样均结束，但脚本 finally 访问已关闭的旧视图对象时报错，不能把脚本退出标记为通过；独立补查确认重新勾选的 Kimi 输入框存在且为空、节流 false，登录态检查通过。正常退出测量实例后恢复原隔离启动器配置。该实验只证明本次空闲页面关闭后的回收，不代表生成中释放、九站或长会话验收。

### 未选站点回收实施与验收边界

实现按状态变化和采集落库事件检查回收，没有新增空闲定时器。未选但忙碌/仍在采集的站点保持挂载、隐藏且保留正尺寸；已选站点不回收。独立审查发现并修复跨轮监控被清除、辅助综合缺少监控/待保存保护、辅助监控干扰群发重试身份、取消新派发误清旧回答采集四条边界。未确认生成结束的站点继续保守保留，不以超时推断生成结束。

Windows 独立 Kimi 首轮验收只发一条合成问题，提交成功并进入 generating 后取消勾选，再调用取消（此时已提交），验证旧回答监控和采集仍继续。隐藏视图保持 1576×889 正尺寸，最终读取到 529 字符。但脚本原先错误期待 120 秒内 capture=complete 并释放，实际 capture=unknown、未封存，因此该脚本失败。复核确认 site-runtime/history.js 刻意只传 generating/null，禁止将通用“无停止键但有回答”当作历史完整证明；不修改此安全判据。需等原有有限采集预算自然结束再核验自动回收，内存收益可能延迟约 15 分钟，不能宣传为生成结束立即省内存。

在上述等待期间使用 V8 Profiler 做只读汇总：主进程 20.03 秒，idle 19995.9ms、应用 bundle 1.5ms、GC 1.1ms、运行时/未归属 30.4ms；Kimi 渲染进程 30.27 秒，idle 29904.1ms、站点脚本 12.4ms、GC 33.5ms、运行时/未归属 318.6ms。仅是当前单站空闲场景的采样时长分布，不是整机 CPU 百分比，不包含 GPU 等其它进程；匿名执行与运行时开销无法完整归属，不能由此宣称 PolyAsk 零开销或九站也如此。未发现支持主进程大改的热循环证据。生成监控在结束后停轮询，答案采集无目标后停轮询，实验关闭时不注册节流探针；本轮不盲目降低频率或开启默认节流。


CPU 后续定位顺序参考此前 Linux 九站样本的进程中位数：Gemini 1.55、元宝 0.725、豆包 0.525，Browser 主进程约 0.05、外壳约 0；GPU 约 0.55。这些是 Electron 原始指标，站点子帧归属不完整，Gemini 未完成多轮回答验收，不能当作平台固有排名。下一轮应针对用户实际高占用场景采样这些站点与 GPU；本次 Windows 单 Kimi 空闲结果不足以支持普遍 CPU 降幅承诺。


延长观察最终通过：同一合成问题约 15.19 分钟后，原采集预算自然结束，数据库副本 sealedAt 已落库、正文仍为 529 字符、submission=submitted、capture=unknown，未改成 complete；未选视图自动关闭，无额外选择操作。回收前约 8.5 秒/回收后约 36.5 秒的单次 Windows privateBytes 快照合计为 826.9/489.1 MiB，减少 337.8 MiB，进程数由 6 降至 4；这是当前单站实例的观察值，不是九站或稳定百分比承诺。回收后再勾选 Kimi，视图 ID 更新；补查输入框可用且为空，测试登录保留。整轮只发最初一条问题，没有重发，没有访问正式档案。

最终离线门禁为 765 项 TS/TSX 与 182 项脚本测试通过，独立 typecheck、仓库 verify、Linux 打包及产物 smoke（shell=1、sites=9、attached=9）通过；代码独立复审无剩余阻塞。新增预算回归使用模拟时钟，原生验收则等待真实时间自然结束，二者不混称。Windows 原生只验证 Kimi；跨轮、辅助综合和重试/取消的组合由离线回归覆盖，未宣称九站及辅助综合原生全覆盖。正式安装程序未更新，节流实验仍默认关闭。

### 性能工作收尾（2026-09-30）

按用户要求停止性能测试与后续优化。核对 `18bfd81` 至 `7052a82` 的 8 个提交、47 个变更路径与 66 个不同历史文件版本，并检查当前已跟踪文件的产物清单；未发现真实凭据、登录数据库、原始日志、截图、性能转储或临时运行时入库。可复用测量脚本和合成回归夹具保留，此结论仅覆盖上述检查范围。

验证文档沿用的早期本机用户名路径改为环境变量，删去不必要的账号页面计数及个人恢复环境细节；事故原因、影响与验收限制保留。旧提交未改写，当前去个人化不代表历史内容已消除。新增测试产物目录忽略规则，并同步修正文档版本和已实现回收行为的状态。

独立 Windows 测试实例已正常退出，回环调试端口 9224/9231 均确认关闭；长期测试档案及隔离运行环境保留，本机原始测量记录仍在库外。收尾未访问正式档案，也未清空用户手动登录的测试档案。上述功能门禁为此前实施结果，本次仅维护文档与忽略规则，不重新启动 Electron 或发送问题。

## 2026-09-30 ChatGPT 回答副本修复

Linux/WSL 开发态复用已授权档案，三条不同的合成短问题均经生产 `polyask:broadcast` 入口，`tier:null`、无图、无重发；第三条在追加授权后发送。前两条用于复现：第一条出现新用户与真实回答，但 `/c/local-chatgpt%3A<id>` 转正式地址被旧路由规则视为切会话，最终空副本；提交回包为 `submit_unconfirmed`，未据此重发。第二条在路由修复后提交成功并先存 16 字符；正文随后新增 selection-message 包装，旧历史根由 Markdown 本身变为新包装，采集误判替换并封存开头。

最终修复重启后，第三条提问只出现一个用户轮次，精确匹配测试问题，输入框为空，生成探针为 complete。历史快照保持 owned，正文从 34 更新到 154 字符；生产 `getQuestion` 返回的数据库副本与生产 `collectAnswers` 读取的最终页面 Markdown 完全一致，正式会话地址已保存。副本 `capture=unknown`、未提前封存：仍不把通用“无停止键且有回答”当作历史完整性的正向证明，未修改原 15 分钟预算。旧空副本与旧截断副本不自动回填。

回归先红后绿：明确临时路由转正式路由、未知前缀和浏览器导航拒绝；真实 Chromium 合成页面验证 selection 包装晚于首 token 插入、同根 Markdown 替换、旧答案及思考段排除、手动追问和其它会话拒绝。765 项 TS/TSX 与 187 项脚本测试、独立 typecheck、仓库 verify、真实 DOM smoke、Linux 打包与产物 smoke（shell=1、sites=9、attached=9）通过，独立代码审查无阻塞。打包与开发态共享 `.webpack` 输出，打包完成后须重启开发态再做站点实测，不能并行假定 preload 文件仍为开发产物。

实测仅覆盖 Linux/WSL ChatGPT 的本轮页面；Windows/macOS 原生及长会话尚未重验。测试前布局已恢复，测试实例正常退出、调试端口关闭；没有访问 Windows 正式档案，也未清空既有登录资料。

## 2026-09-30 Electron 44 能力接入与机制复测

Electron 44.5.0、Linux/WSL、空白临时档案，未使用已有登录资料或发送真实问题。缩放先红后绿：同源测试桩复现其它视图被同步修改；真实 Chromium 对生产 `SiteZoomController`、布局和 UI 状态存储验证 Ctrl 快捷键、XTest 原生 Ctrl+滚轮、两个同源页面及共享登录域导航、外壳比例不变、刷新/重建恢复、本机重置。生产 preload/IPC smoke 另以合成 child-process-gone 事件验证可信 shell 取数、非可信 sender 拒绝、诊断报告白名单字段及监听释放；没有制造真实 GPU 崩溃或 Windows 启动错误。

已隐藏的三个重叠页面直接切换节流，按 baseline → all-throttled → mixed → restored → all-throttled-repeat → restored-repeat 重复观察，每段预热 1.5 秒再测约 3 秒。关闭时各页约 180 帧、60–61 次定时器；两次全部允许时各页均 0 帧、3 次定时器、visibility=hidden；混合时允许的两页 0 帧/3 次、未允许的一页约 180 帧/60 次；两次恢复均回到约 180 帧/60–61 次和 visible，视口始终正尺寸。该结果说明 Electron 44.5.0 下此切换路径符合预期，没有测量真实站点 CPU、能耗或长期稳定性；不与旧版不同切换步骤直接计算优化比例。

772 项 TS/TSX 与 187 项脚本测试、独立 typecheck、仓库 verify、Linux 当前源码 package 与 smoke（shell=1、sites=9、attached=9）通过；独立代码审查无重要问题，数值边界、全部类别上限及真实 soak failure summary 回归均通过。真实站点最小化生成/恢复后再次发送、九站组合以及 Windows/macOS 原生设备仍未验收；节流实验继续默认关闭。全部离线测试实例已退出，原始报告留在系统临时目录，不入库。

### 后续：ChatGPT 两轮真实生成回归

用户追加授权最多两条无个人信息短问题。启动前读取此前 Linux 开发运行时的 Electron 43.4.0 归档二进制与本次 44.5.0 二进制的 Cookie 加密 fuse，两者均为 false；未使用发行包的 true 配置打开开发档案。重启 `npm start`，复用已授权 Linux 档案，实验环境变量仅作用于测试进程，实际版本与数据目录在主进程核验。只选 ChatGPT，经生产群发入口发送两条不同的合成问题，`tier:null`、无图、无重发；生产隔离上下文 `__AMS` 用于只读检查。

当前 WSL 桌面调用 `BrowserWindow.minimize()` 后等待 2.5 秒仍为 `isMinimized=false`、可见；第一轮生成期间再次调用也未进入原生最小化。因此自动最小化节流路径仍未验收，未伪造 minimize 事件或放宽生产门槛。第一轮改用 `hide()` 作有限后台验证：已观察到 generating，窗口隐藏且站点节流为 false；随后真实回答完成，数据库副本与生产 `collectAnswers` 的页面 Markdown 完全一致，均为 454 字符。关闭节流时页面 visibility 仍为 visible，不把它混称为允许节流后的结果。

`show()`/`restore()` 后窗口可见、站点节流仍为 false；第二轮在同一会话连续追问，提交确认来自 message，观察到 generating 后变为 complete，末条用户消息精确匹配，用户轮次仅增加一次、输入框为空。第二轮数据库副本与生产页面 Markdown 完全一致，均为 290 字符；第一轮原有 454 字符副本仍保留。第一轮在追问后 capture=interrupted 且封存，第二轮 capture=unknown 且未提前封存，未将通用生成探针 complete 当作历史完整性的证明，也未修改原 15 分钟采集预算。

恢复测试前选站、布局、焦点站与页码，正常退出已核验可执行文件和数据目录的测试实例，回环端口均关闭，登录档案保留。本轮没有代码改动，没有测量 CPU/能耗，也未完成原生最小化、允许节流下的真实生成、九站组合或 Windows/macOS 验收；实验继续默认关闭。原始取证留在系统临时目录，不入库。

## 2026-10-01 三站回答副本排障

Linux/WSL 开发态复用既有授权档案；启动前核对此前 43.4.0 与本次 44.5.0 裸 Electron 的 Cookie 加密 fuse 均为 false，不访问 Windows 正式档案。用户授权 ChatGPT/Gemini/豆包各最多两条无个人信息短问题。两轮均经生产 `polyask:broadcast`，`tier:null`、无图片、无自动重发；在主帧生产隔离上下文 `__AMS` 取证。

第一轮三站均提交成功。ChatGPT/豆包数据库完整副本与生产 `collectAnswers` 分别为 149/109 字符且完全一致，没有复现原报告中的失败。Gemini 先观测到生成控件，但用户轮次未渲染；旧快照丢弃未归属生成信号，数据库约 46 秒封存为 unavailable。后续真实页面出现用户轮次及完整回答，运行时快照可归属，但主进程采集已结束，不自动回填已封存记录。

修复后未归属快照仅透传未结束的 generating，用于将观察延长一次至既有 15 分钟上限；不透传正文或地址。归属检查、取消和完成未知语义不变。新增运行时与内存 SQLite 回归在旧实现上出现预期失败；修复后完整 Desktop 测试通过（777 个 TypeScript/TSX、188 个运行时/脚本测试），仓库门禁与独立 typecheck 通过。

重启后第二轮 ChatGPT/Gemini/豆包副本分别为 159/86/110 字符，逐站按尝试 ID 读取，与页面生产 Markdown 完全一致；均保存会话地址，capture=unknown，未提前封存。ChatGPT/豆包在用户节点出现前也观测到生成，窗口始终正常。Gemini 第二轮及时渲染，延迟超过 45 秒的路径由第一轮取证与离线回归覆盖，不能称为第二次重现相同延迟。历史详情默认仅加载选中尝试正文，其他站点需按 answerId 加载，不能将摘要中的 null 判为丢失。

本轮只发六条已授权合成问题，未回填或删除旧记录；测试实例正常退出，调试端口关闭。ChatGPT/豆包原故障仍需用户补充版本、具体操作入口及失败现象；Windows/macOS 原生环境、长会话和连续追问未在本轮验收。原始时序与 DOM 留在系统临时目录，不入库。

## 2026-10-02 深度思考首问副本排障

用户在 v1.11.1 的九站深度思考首问中报告 Claude、ChatGPT、豆包空副本；三站原站均有完整回答、用时未超过 15 分钟、等待期间没有原站操作。本轮获授权三站各最多两条无个人信息的合成问题，复用已授权 Linux 档案；启动前复核旧、新运行时 Cookie 加密 fuse 一致，不接触 Windows 正式档案。生产 `__AMS.history` 外仅记录实际调用回包及只读 DOM 元数据，不额外高频调用 snapshot，不改生产归属逻辑；原始记录留在库外。

修复前第一轮请求 think，三站从新会话开始。ChatGPT 确认思考档，约 236 秒回答完成，1955 字符副本与生产 `collectAnswers` 页面 Markdown 完全一致，未复现漏采。Claude 确认思考档，进入检索及生成文件过程，超过 15 分钟仍未返回最终正文；归属及生成信号持续有效，原预算正常封存空副本，不等同于用户报告的完整回答漏采。豆包在约 469px 窄视口没有可读模型按钮标签，返回档位未确认和提交不确定；直到约 275 秒才显示生成、约 279 秒显示用户轮次，原采集已在提交结果后的约 45 秒窗口封存。后来原站回答完整，1624 字符。其用户气泡在汉字与英文、数字间自动插入空格，原文匹配失败；这是独立于迟到生成信号的第二条漏采路径。放大视口可读取专家档；本轮没有据此修改模型切档适配器。

修复将提交结果就绪后的副本观察固定为 15 分钟，进度不顺延；缺早期停止控件不再提前结束，归属、取消、删除、明确结束及旧 token 保护保留。仅豆包归一化汉字与 ASCII 英数边界的排版空格，不抹去英文词间、数字间空格或实质字符。新增失败回归在旧实现中分别因 45 秒提前封存、气泡不匹配而红；包括 Claude 新版锚点修复后的完整 Desktop 测试通过（779 个 TypeScript/TSX、197 个运行时/脚本），独立 typecheck、仓库门禁、package、smoke（shell=1、sites=9、attached=9）通过。独立审查未发现代码阻塞问题。

重启修复版后第二轮请求 think，限制为约 150 字、不联网不生成文件的新会话首问。三站档位均确认；回归使用约 850–944px 视口，不能称为九站窄列组合验收。ChatGPT、豆包分别保存 162、269 字符，按尝试 ID 读取，与生产页面 Markdown 完全一致，均保存会话地址、完成状态未知且未提前封存。豆包显示文字仍含新增排版空格，修复后的生产 snapshot 可持续归属。第二轮没有再次出现第一轮豆包的四分半延迟，迟到无生成信号的固定预算路径由首轮取证及内存 SQLite 回归覆盖。Claude 第二轮返回提交不确定，合成草稿留在输入框、发送按钮禁用，未出现用户轮次；超过旧 45 秒窗口仍保持观察，没有重发。随后通过生产恢复入口查看已封存的首轮 Claude 合成会话，原站已显示完整正文，但旧 `answer()` 仍为 null，`.font-claude-response` 命中为零；已确认新版 `[data-testid="assistant-message"]`、`[data-perf-reply-text]` 及 `data-turn-key` 锚点失效路径，修复正文读取及稳定容器。原轮耗时超过 15 分钟，不能将其时长等同于用户报告；旧记录不回填。用户 ChatGPT 的失败仍未复现，需结合环境诊断继续确认。Windows/macOS 原生九站组合、真实 Drive 同步及五种发行包原生安装未在本轮验收；旧空副本不自动回填。

Claude 新版适配器重启后，仅复读首轮已有页面：生产 `answer()` 命中最终 `data-perf-reply-text` 块，`historyTurn()` 命中现代助手容器并读取稳定轮次键，生产 `collectAnswers` 返回 2765 字符 Markdown，不含工具摘要。会话恢复后先等待真实正文水合完成，再检查；立即读空窗口不作为失败证据。三站各两条额度已用完，额外一条 Claude 新首问回归尚未获授权，未追加发送；新版 Claude 完整发送到历史保存链路仍待验证。正常关闭已核验 Linux 测试实例，不回填旧空副本或删除测试档案。

## 2026-10-03 豆包、元宝提问历史副本排障

用户报告同一首问：豆包原站完整回答，副本「未取得副本」；元宝副本「完成状态未知」，正文停在第一段后半句（保存于发送后约 6 秒）。用户正式档案不可读，复用已授权 Linux 开发态档案（同一账号，可打开用户的原会话），Drive 未连接，测试问题不外同步。获授权向两站发送原问题。

- 豆包：原会话 DOM 用户气泡为 `英文中有没有 "in the lee of pines" 的用法？`，在汉字与引号之间插入空格；原归一化只处理汉字与英数边界，文本不匹配，始终未绑定。未绑定期间页面内任一可信点击会直接终止采集，故封存为「未取得副本」而非持续等待。修复后用生产 `historyTurn()` 与归一化对原会话真实 DOM 绑定成功，snapshot 归属并读到 1060 字符。本机豆包注入后发送键始终禁用（含可信 `Input.insertText`），PolyAsk 正确返回提交不确定且未重发；完整「发送→保存」链路未在本机复现，需用户环境复验。
- 元宝：中文界面（`--lang=zh-CN`）停止键为 `#yuanbao-send-btn[aria-label="停止回答"]`、类名 `SendButton_sendStop__*`，旧探针只认英文 `Stop Answering`，整个生成期读作非生成，副本只能显示完成状态未知。英文界面完整一轮可持续采集到 1853 字符，未复现截断；截断只能来自交互冻结分支（生成中在页面里点按钮类控件或输入草稿，冻结当时的半句）。用户是否在该时刻操作了元宝页面未经确认。
- 修复后中文界面两轮回归：生成中经 CDP 可信 `Input.insertText` 向输入框写草稿，副本继续增长，最终 1154 字符与页面一致；第二轮写草稿后元宝隐藏停止键（探针读 complete），再次可信输入仍不冻结，最终 1551 字符完整入库。元宝深度思考期间思考段会暂时以 `.hyc-common-markdown` 出现并被快照读到，最终正文替换后副本正确；`cot__think` 过滤器已过时，留待单独处理。
- 未验收：Windows 原生、其余七站生成中交互、豆包完整发送链路；旧截断/空副本不回填。

## 2026-10-03 采集定位 spike（九站，未发送）

目的：核对提问历史定位分级（① 逐站选择器、② 语义信号、③ 原文锚点）在真页面上是否拿到同一节点，并采集脱敏 fixture。环境：Linux/WSL 开发态，`--user-data-dir=~/.config/PolyAsk --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`，Drive 未连接，英文界面、站点视图约 469–944 px 宽。**全程未输入、未发送**：只从各站侧栏打开已有的单轮测试会话（问题均为此前测试用的 `英文中有没有"in the lee of pines"的用法？`），Gemini 为露出侧栏用 CDP 可信点击了一次菜单键，其余只读；隔离上下文里重新求值过工作区的 `history-locate.js`/`md.js`/漂移版 `history-adapters.js`（内存，结束时恢复原版选择器表并关闭实例）。

- **① 选择器**：九站 `historyTurn()` 均 userCount=1、locate=selector、文本与问题一致、有回答；`diagnose()` 的两条 `capture` 检查九站全绿。DeepSeek 首次读为 0：其会话区是虚拟列表（`ds-virtual-list`），后台视图未绘制前不渲染消息，截图触发绘制后正常。
- **模拟改版**：只把内存里的两张选择器表换成不存在的属性名（不碰页面）。此时 `capture` 两条变红，`reach`/`control`/`tier` 不变。整链结果（与 ① 比较）：Claude、Gemini 由 ② 接上，节点与正文完全一致；豆包由 ② 接上，用户/回答节点是 ① 的外层，正文多带搜索卡标题与时间戳（1091 对 1060 字符）；DeepSeek、千问、Kimi 由 ③ 接上，正文与 ① 一致（锚点用户节点在 ① 节点内、回答根为 ① 的外层或同一节点）；ChatGPT 的 ③ 回答正确但其后有「ChatGPT can make mistakes」等实质内容，userCount=2，`bind()` 会拒绝；元宝（③ 禁用，② 无信号）、智谱（会话区类名 `conversation-list-outer` 命中会话列表排除，② 无信号）为 null。**不一致为 0**；全部非空结果的用户文本与 ① 一致。
- **spike 中发现并已修**：① Kimi 用户气泡下的「Edit / Copy / Share」是 div 拼的操作条，③ 先把它当成回答根（userCount=2 时被拒，但回答未出现前的瞬间会被当成本轮回答）——改为类名以 `-action(s)`/`-action-row|bar…` 收尾的纯标识符和 `role=toolbar` 不算实质内容（Tailwind 任意变体、`px-toolbar` 这类工具类不算，Claude/ChatGPT 实测曾误伤后收紧）；② Gemini 用户气泡含读屏副本 `h5.cdk-visually-hidden`（「You said」+原文），③ 因同文两处恒为 null、② 的文本也对不上——读屏工具类名子树不参与锚点计数，②③ 的用户文本去掉它；修后 Gemini ② 文本一致，冻结为 ③ 时节点一致但 userCount=2。③ 智谱 `li > blockquote > ul` 的序列化：引用内列表沿用了外层缩进，第二项起变成 `>    -`——引用块改为从零缩进起算，真机复核为 `   > - …`。④ 扫描门禁的 token 规则误伤 Claude 类名 `skill-arg-hint-sr`，收紧为带分隔符的真实前缀；脱敏白名单补上 ChatGPT 回答定位依赖的 `data-conversation-role`/`data-markdown-text-style` 等角色类 `data-*`（否则回放对真站 fixture 零命中）。
- **耗时**（单轮、已完成页面，`performance.now()` 每站 5–6 次）：① `historyTurn` 首次 0.1–1.3 ms、其后多为 0–0.4 ms；② 0.1–2.5 ms；③ 首次整页遍历 1.8–6.6 ms，缓存命中 0.1–2.1 ms（仍含回答根上溯）。只测了同步调用，不是逐个 MutationObserver 批次在流式中的耗时；长会话未测，500 ms 遍历间隔仍是性能取舍而非实测阈值。
- **md.js**：九站答案均无 KaTeX，公式还原未在真站验证；原生嵌套列表只在智谱出现（含上面的引用块问题）；表格仅智谱。Claude 有个别行首多一个空格（既有行为，不影响渲染）。
- **fixture**：九站各采一份 `desktop/scripts/fixtures-dom/<站>-single-turn`，采集根取「包住会话与输入框、不含侧栏」的容器（Claude `div.pt-12`、ChatGPT `div.MainContentFrame-*`、Gemini `chat-window`、DeepSeek `div.ds-virtual-list`、豆包 `main`、千问 `#qw-chat-content`、Kimi `div.chat-page`、元宝 `div.agent-dialogue__content`、智谱 `div.conversation-container`），8–45 KB，扫描门禁通过；人工逐份核对过 id、`data-testid`、角色类 `data-*` 与类名，无账号名、头像地址、会话标题或正文。回放中 ① 九站全过，漂移结果与上面真机逐站一致。
- **未验证**：流式过程中 ③ 根身份是否漂移、ChatGPT 首 token 前后换根、Gemini 生成信号早于气泡、同一会话同文连问与 retry 后的归属、提交失败后输入框残留原文时的排除、会成为会话标题的短问题（本次侧栏标题都与问题不同）——这些都要真发送，本轮均未做。DeepSeek 是否应加入 ③ 的虚拟列表禁用名单待定。Windows 原生、中文界面未测。

## 2026-10-03 采集定位真机发送验证

用户授权九站各 3–4 条测试提问。Linux/WSL 开发态复用 `~/.config/PolyAsk`（`--remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`），Drive 未连接，英文界面，站点视图 469–944 px 宽。问题均含 `PolyAsk` 与唯一标签（T1-1003a / T3-1003c / T3b-1003d），要求三点列表加两行代码，不含个人信息。全部经外壳 `polyask.broadcast`（`tier:null`、无图片）发送，不手动切档，`submit_unconfirmed` 不重发。站点视图的生产隔离上下文里装了只读记录器：包装 `history.begin/snapshot` 与 `adapter.historyTurn`（每次调用计时，按 WeakMap 编号记录用户、回答根、回答节点），另每 300 ms 用 ctx 副本采样定位级别、Markdown 长度和 `generation()`。副本用 `getQuestion(questionId, answerId)` 逐条读取，与页面原版选择器的 `toMarkdown` 比较——两边用的是同一个 `S.toMarkdown`，「一致」只证明归属与时机，不证明 Markdown 转换忠实（见下文 ChatGPT、千问代码块）。原始 JSON 存在会话临时目录，不入库。结束后对九站执行 `newSession`，清掉记录器和漂移表，再按 PID 正常退出实例；调试端口已关闭。

- **T1 新会话首轮（九站同发）**：七站提交即绑定，locate 均为 selector。Claude、ChatGPT、Gemini、千问、Kimi、元宝、智谱的副本分别为 151/98/187/210/123/178/211 字符，都与页面最终正文的同一转换结果一致（归属正确）；但 ChatGPT 代码块丢了围栏（`Python` 单独成段、代码逐行成段），千问代码块围栏里混进行号「1」「2」和空行，两边错得一样，不能记为内容通过（2026-10-04 已修，见下节）；capture 为 unknown（无完成正向证据，符合设计）。回答文字锁定后，根身份不再变化。DeepSeek 返回 `submitted/composer`，生成信号在 1.1 s 出现，但其虚拟列表（`ds-virtual-list`）在后台视图里始终没渲染消息，8 分钟内 userCount=0，副本一直 waiting。CDP 截图触发一次绘制后，消息立刻插入，① 绑定，副本 137 字符与页面一致。**DeepSeek T1 不算产品通过**：没有人为绘制时产品链路 8 分钟采不到（dbCapture=waiting、prodFinal 为 null）。豆包注入后发送键 `#flow-end-msg-send` 保持 `disabled`，返回 `submit_unconfirmed`，草稿留在输入框，没有重发（与此前一致）。
- **根身份与时序**：千问先绑定空占位卡 `.answer-common-card.answer-receiving-card`，3.4 s 时换成正式卡；当时正文仍为空，属于设计内的「空回答占位不锁定」，副本正常。Gemini、Kimi、智谱在出正文前替换过一次用户节点（乐观节点重挂），副本正常。Kimi T1 的 300 ms 采样里路径从 `/` 直接到最终 id，从没出现临时路由 `/chat/pd…`，① 多半在首页路由下绑定（routeId 为空），`checkRoute` 的迁移分支 T1 根本没走到，不能据此说「首屏路由迁移通过」。Kimi、元宝回答根不变，但根内正文节点中途被替换过：Kimi T1/T2/T3 思考阶段 `answer()` 退回整条助手项，推理文本作为归属正确的中间副本写进了库（T1 7.45 s 写入 376 字符、结尾是英文推理，12.9 s 回答节点换了才降回 123；T2 4.99 s 正文以「Thinking」开头），若此时封存为 interrupted 就留下推理过程；元宝 T2 5.0 s 正文被写成「[image]」，T1 的 md 从 201 掉到 9 又恢复（2026-10-04 已修 Kimi/千问思考段，元宝占位未处理）。ChatGPT 生成信号比用户气泡早约 1.6–2.0 s（T1：1.07 s 对 2.69 s）。首个 token 时绑定的根（`fallback-turn-0:1:assistant`）一直保持到完成，未复现首 token 前后换根。元宝的生成信号也早于气泡（1.16 s 对 2.46 s），Claude 则晚于气泡（3.4 s 对 2.6 s）。Gemini 三轮的气泡与生成信号都落在同一 300 ms 采样窗内，没有出现未归属的 generating 快照，「生成早于气泡」的迟到路径本轮未复现。
- **T2 同会话同文再问**（八站，复用 T1 的 runId，即重试路径）：八站都绑定了新增的第二个用户轮次，userCount 为 2，`submissionEvidence` 七站为 message、元宝为 composer。attempt 2 的副本都等于页面第二个回答（DeepSeek 靠每 3 秒截图强制绘制，同样不算产品通过）。七站正文与 attempt 1 不同。Claude 两次回答逐字相同（各 151 字符），但绑定的回答根是第二轮（`data-turn-key` 不同），不是旧回答。attempt 1 在重试开始时被封存为 interrupted，正文保留首轮内容。豆包没有 T1 会话，记为阻塞。Gemini 第二个回答中有一句被截断后重新开头，从服务端重新加载的页面也一样，属于模型输出本身，副本与页面一致。
- **T3 模拟改版（九站同发，另对 Kimi、智谱补发一轮 T3b）**：发送前在隔离上下文里按 `dom-fixture-drift.test.js` 的 DRIFTED 规则重新执行 `history-adapters.js`，把两张选择器表换成不存在的属性。装表后的 level1AfterInstall 是在空的新会话上测的，没装漂移表时同样是 0，不能证明漂移生效；能证明的是 T3 统计里九站 selector 调用 n=0。
  - Claude、Gemini 由 ② 接上，副本 237/377 字符，与原版选择器算出的页面正文一致。千问由 ③ 接上：回答根没有 key，见到停止键后，停止键消失且回答容器 2 秒无变动，于 11.4 s 读取一次后结束本轮，179 字符与页面一致。
  - ChatGPT 的 ③ 命中了真实气泡，但其后另有实质内容，userCount=2，`bind()` 立即停止，记 unavailable。ChatGPT 当前 DOM 里已没有 `data-message-author-role` / `data-turn="user"`，只剩 `[data-user-message-bubble]`，② 无信号。
  - DeepSeek、元宝（③ 禁用、② 无信号）为 null。T3 跑完时库里这两站与智谱仍是 waiting，变成 unavailable 是后来 T3b/收尾的 newSession 封存造成的，不是采集链自己收口。豆包提交不确定，记为阻塞。
  - **Kimi 首轮丢失**：③ 在临时路由 `/chat/pd60…` 下绑定了乐观用户节点并冻结为 anchor。约 50 ms 内路由迁移到服务端 id，节点也被替换，于是 stop，记 unavailable，没有保存错误内容。根因不是 500 ms 节流：`bind()` 先跑 `checkRoute`，其单次迁移要求「同一个仍连接的用户节点」，旧节点已断开、新节点不是同一个，不节流也照样 stop（采样器 2945 ms 用全新遍历拿到的正是新节点）；① 若在临时路由期间绑定也会同样丢失（2026-10-04 已修）。T3b 中 Kimi 提交后页面在后台 4.6 分钟没有渲染，截图触发绘制后整段会话一次插入；原始证据只有 T3b-kimi-dbcheck.json 证明最终 anchor 副本 106 字符与页面一致（dump 只有一条首页 sample、没有 turn 事件，「带 key 的回答根」无证据）。
  - **智谱：③ 认错了用户轮次（高风险）**：两轮都绑定了顶栏会话标题 `div.chat-top-section p.conversation-name`（新会话标题先显示为问题原文）。真实气泡在 `conversation-list-outer` 内，被会话列表排除。回答根取到了标题测量副本 `span.measure-span`，其中的文字也是问题原文。根没有 key，只读一次的条件为：见过停止键、停止键消失、根 2 秒无变动。两轮都在标题改名、缓存失效之后才到 5 秒一次的快照，所以没有保存内容（副本 unavailable，只记下会话地址）。T3 的逐次调用记录没保存，只能确定标题在 21.4–26.4 s 之间改名（原记「26.3 s」无原始证据）；测量副本在流式期间没有任何变动，`changedAt` 从未赋值，按当时的 `once()` 窗口从生成结束（约 23 s）就打开、一直到改名，约 3 s 以上（原记「约 1.2 s」偏小）。T3b：生成在 11.1 s 结束，标题在 11.4 s 改名。只要站点没给会话自动改标题，下一次快照一定会把问题原文当作回答保存。误绑能撑住全靠锚点缓存：1086 ms 起测量副本已是第二处同文，采样器的全新遍历一直返回 null（2026-10-04 已修）。
  - 九站绑定的用户节点都不在输入框内，输入框没有被误认。侧栏会话列表没有被误认；被误认的是上面智谱的顶栏标题。
- **调用耗时**（生产 `historyTurn` 每次调用，含 MutationObserver 回调，单位 ms）：
  - T1 ① 各站 p50 为 0.2–0.8，p95 为 1.6–16.9，最大 16–135（Claude 135、Gemini 109、千问 89）。T2 ① p50 为 0.1–1.3，p95 为 1–16.4。
  - 智谱有单次 1253 与 1463 的长尾（T3 锚点缓存路径、T2 选择器路径各一次），主线程在 MutationObserver 回调里卡顿超过 1 秒，未定位原因，疑为热路径上 `innerText` 的强制布局，待 performance trace。
  - T3 ② p50 1.5–1.7，p95 11–18.5。③ 整页遍历每次 0.8–57（ChatGPT 最高 57），缓存/节流路径 p50 0.9–2.6，p95 1.4–22.6。
- **T4 已有会话（只读）**：从侧栏链接打开最近和较早的会话（原记 DeepSeek 7 个、Kimi 7 个，原始 T4-deepseek.json 只有 1 个候选、T4-kimi.json 只有 3 个；Claude 3 个、ChatGPT 3 个、豆包 3 个），Gemini、千问、元宝、智谱的侧栏没有可用链接，只测了当前页。账号里最长的会话为 ChatGPT 5 轮（1940 个节点），其余为 1–2 轮。① 每次 0–1.0；② 0.1–2.1；强制 ③ 整页遍历（内存里去掉虚拟列表禁用后计时）首次 2.9–8.2、其后 1.1–5.3，其中 DeepSeek 与智谱强制 ③ 的结果都是 null，计时是失败遍历的耗时；缓存命中 0–2；回答 `toMarkdown` 0–2.4。**没有长会话（≥20 轮）可测**，长会话耗时仍未验证。
- **环境说明**：本机窗口在后台时，DeepSeek 虚拟列表与 Kimi 首屏路由要等一次绘制才渲染（CDP `Page.captureScreenshot` 即可触发）。T2/T3 期间每 3 秒对 DeepSeek 截图一次，以模拟可见视图，这会改变这两站的时序。DeepSeek T1/T2 因此只能记「需人为绘制」，用户可见窗口下的表现未验证。另：T1 前 Claude 输入框里有一份用户既有草稿，群发把它覆盖且没有恢复（草稿内容另存于会话临时目录，未入库）；之后真机发送前须先确认各站输入框为空，非空就停下交给用户。
- **结论与未验证**：
  - 已验证：① 健康时新会话首轮和同会话同文再问都归属正确；所有快照都没有把旧回答或另一会话的正文存成本轮。内容忠实度未验证（同一 `toMarkdown` 对照），Kimi 思考阶段的推理文本进过库。
  - 改版兜底：② 在 Claude、Gemini 上可靠，③ 在千问上可靠。③ 在 Kimi 上会因首屏路由迁移与用户节点同批替换丢失首轮，在智谱上会把顶栏标题当作用户轮次，本轮靠时机才没有错存——2026-10-04 修复与复测见下节。
  - 未验证：豆包的完整发送链路（本机发送键禁用）、长会话耗时、Windows 原生、中文界面、网页内直接追问与重新生成、提交失败后输入框残留原文时的排除。

## 2026-10-04 采集审计缺陷修复与复测

针对上节审计确认的缺陷修代码，回归用例全部在修复前的代码上失败（`desktop/scripts/capture-audit-regress.test.js`、`md-runtime.test.js` 新增两条；`question-history-locate.test.js` 与 `question-history-runtime.test.js` 各改一条旧期望——旧用例把「静止根可读」「Kimi 旧节点断开即拒绝迁移」写成了规则）。

- **智谱 ③ 认错用户（high）**：读正文的那次定位（`snapshot()`/交互冻结，`ctx.fresh`）不用锚点缓存、不节流，重新确认同文唯一；回答根候选的正文等于问题原文时视为回显跳过（测量副本 `span.measure-span`）；`once()` 要求回答根被观察到变动过（`changedAt` 非空），静止根不读，交互冻结与约 12 分钟软到期照旧降级读；会话列表类名只在位于输入框列左右两侧时排除（量不到布局时照旧排除），智谱真会话区 `conversation-list-outer` 与输入框同列，不再被挡。
- **Kimi 首轮迁移（medium）**：空首屏首轮、尚无正文时，路由在 `/chat/<id>` 之间迁移的同一批里旧用户节点已断开，新节点文本与问题完全一致、轮次数仍为 1、且在绑定后 10 秒内（实测约 50 ms）时，迁移并换上新节点；路由已变但暂时定位不到用户时挂起不终止。仍连接的另一个节点、文本不符、第二次迁移、超时仍终止。① 与 ③ 同样适用。
- **思考段进库（medium）**：Kimi、千问 `answer()` 只有思考段时返回 null（千问空占位卡仍返回卡本身）；③ 的回答根只有思考段 markdown 时不给正文。元宝 `[image]` 占位与过时的 `cot__think` 过滤未处理。
- **代码块（ChatGPT medium、千问 low）**：真机取证（只打开已有会话，未发送）——ChatGPT 代码块是 `div[data-markdown-copy="code-block"]`，头部条 `data-markdown-copy="exclude"` 放语言名，正文有两种形态：`display:block` 的 `code`（T1 会话）与 CodeMirror 逐行 `div.cm-line`（`data-language="python"`，T2 会话）；千问是 react-syntax-highlighter，块级行 + `span.linenumber`（user-select:none）+ 行尾 `\n`。`md.js` 认这种容器为围栏、吸收语言名，代码正文逐文本节点拼接并跳过行号栏。真页面上新旧序列化对比：ChatGPT 两份由「`Python` 段落 + 行内代码/逐行段落」变为 ```` ```python ```` 围栏，千问去掉行号与空行；Gemini、Kimi、元宝、智谱、DeepSeek 的已有回答新旧输出逐字相同；Claude 未比（CDP 导航到旧会话后该视图渲染进程无响应，重启前未恢复）。原始取证在会话临时目录 `live-verify/fix/`。
- **Kimi 提交确认（审计记 medium，结论被推翻）**：T5 用一版「Kimi 输入框清空须有路由变化或新消息佐证」的中间代码发送，结果报 `submit_unconfirmed`：视图当时不出帧（rAF=0），输入框已清空、地址仍是首页、没有消息。触发一次绘制后会话一次出现且回答已完成；重载页面读 `GetChat`/`ListMessages` 响应，会话 createTime 16:26:54.65Z、消息 16:26:55Z、回答完成 16:27:05Z，与群发（16:26:53–58Z）同秒，绘制约在 16:29。问题在提交当时就已送达，只是渲染推迟，`composer` 证据在这种情况下是真的，这条佐证要求已撤回，提交确认逻辑保持原样。**副作用**：未出帧时 `adapter.submitted(text)` 读不到末条用户消息，会判「未提交」——`POLYASK_KIMI_RESUBMIT` 打开前必须先解决，否则会把已送达的问题再发一遍。
- **后台视图不出帧（DeepSeek medium）**：同一开发态里各站视图 `visibilityState` 都是 visible、视口为正，但部分视图 1.5 s 内 rAF 为 0（某时刻 Kimi/千问/元宝/智谱；重启后仅智谱，T5 期间 Kimi 又停），CDP 截图后恢复；与是否在当前页无固定对应，机制未定位（Linux/WSLg 合成器或视图层叠遮挡均有可能），Windows 未测。影响：DeepSeek 虚拟列表与 Kimi 会话渲染推迟，副本只能等。上节 DeepSeek T1/T2 改记「需人为绘制」。
- **T5 复测（各 1 条授权提问，内存漂移表，`tier:null`）**：Kimi 见上条，绘制后 ③ 采到 136 字符、围栏代码完整，与页面一致；本轮会话一次插入，临时路由迁移分支没走到，只有离线用例。智谱：726 ms 时 ③ 只命中真气泡（标题尚未显示原文），其后「复制入框」`div.copy-btn` 与回答后的 `followup-container` 都算实质内容，userCount=2，`bind()` 当即停止，记 unavailable；没有绑定标题、没有错存。③ 在智谱的结构上接不住，属预期的拿不准即放弃。
- **未处理（low）**：智谱 `historyTurn` 秒级长尾未定位；`once()` 未加「两次采样文本长度不变」；元宝占位与思考段。

## 2026-10-04 Windows TestLab 实测

**环境**：Windows 2560×1440、系统缩放 150%；隔离档案 `%LOCALAPPDATA%\PolyAsk-TestLab`，Electron 44.5.0 跑 HEAD `ed87c61`（1.11.2）未打包开发态，九站已登录。窗口最大化（内容区 2560×1378），外壳缩放 1、站点缩放 0.9、紧凑密度，站点视图 846×1265 DIP（页面内 940×1406，`devicePixelRatio≈1.35`），总览每页 3 格共 3 页。启动器设了 `POLYASK_IDLE_THROTTLING_EXPERIMENT=1`（生产没有）。从 WSL 接入：页面 CDP `127.0.0.1:9224`，主进程 inspector `127.0.0.1:9231`（`Runtime.evaluate(includeCommandLineAPI)` 下可直接 `require('electron')`），`__AMS` 在各页 `Electron Isolated Context`。共 3 条测试提问（W2/W3 群发、W4 千问单发），`submit_unconfirmed` 一律不重发；脚本与原始 JSON 在会话临时目录 `windows-test/`，不入库。下文已按事后审计改正草稿：凡「改正」处以审计为准。

- **W0 清点（未发送）**：九个站点视图 `getBackgroundThrottling()` 均 false、外壳 true；九视图都挂着，后台六站与当前页第一格同矩形、被层序压住。稳态 2s 内九站 rAF 246–276（含后台页），RO/IO 首回调都到。TestLab 窗口在最大化的 Terminal 之后被系统判原生遮挡：外壳 `visibilityState=hidden`、rAF 0，站点视图因关闭节流仍报 visible。
- **W1 I1 复现（未发送）**：后台页 Gemini/DeepSeek/豆包各 `reload()` 一次，3/10/25s 三次采样 rAF、RO、IO 全 0，定时器正常（100ms 间隔 2s 触发 20 次），`visibilityState` 仍 visible；未重载的当前页对照约 250。与 Linux 不同：窗口整体被别的应用盖住时，重载**当前页最上层**的智谱同样停帧；`SetWindowPos(HWND_TOP, NOACTIVATE)` 提层后外壳仍 hidden，重载 Kimi 也停帧。`setAlwaysOnTop(true)` 约 1–3s 后外壳 visible，当前页停帧的元宝、Kimi 自愈，后台页千问可见时重载仍 0、Claude/DeepSeek 一直 0——兄弟视图遮挡造成的停帧不随窗口可见而解除。
  - **恢复手段（改正：原始输出缺失）**：草稿记「对 Gemini 重设 `setBackgroundThrottling(false)` 立即恢复、DeepSeek `invalidate()` 无效、豆包 `capturePage` 首次抛 `UnknownVizError` 随后恢复」，但只存下了第二轮 `w1c-restorers2.json`：其中 Gemini、豆包在动作前已是约 210（被第一轮救回），Gemini 未再施加动作，豆包 `capturePage` 6×6 成功未抛错，DeepSeek/智谱未施加动作仍为 0。第一轮三种手段的原始输出没有保存，这三条只能记「观察到、无原始证据」。重设有效性的受控证据见下节 Linux 对照。
  - **最小化（改正）**：最小化 5s 再 `restore()`，最小化期间外壳 hidden、五个视图只出 1–2 帧——**最小化本身就会让未导航的视图停帧**，不只是「被遮挡时导航」；恢复后九站都出帧（含原先停帧的后台页 Claude/千问/DeepSeek），全程各视图 get 均为 false、空闲节流实验未生效。恢复是否来自 Electron 自身的 restore 路径未分离，产品不依赖它：`paint-recovery.ts` 在 restore/show/focus 时主动重设（下节）。
- **W2 基线（不挂钩子，提问 #1）**：newSession 前 Windows 已锁屏（前台 LockApp），newSession 后九站 rAF 全 0。千问输入框读到占位符「向千问提问」（真实文本节点），按「输入框非空即停」被测试脚本跳过（后确认误判，非产品行为）；其余八站群发 3.4s：
  - Claude、Gemini、豆包 `submit_unconfirmed`，草稿留在输入框，未重发。豆包发送键始终 disabled。**改正（TTU 标记误读）**：草稿以「没有 `TTU_input_send`/`TTU_send`」作为未发送证据，但这两个是相对页面 timeOrigin 的加载期性能标记（W3 里约在群发前 43s），既不能证明发送也不能否定发送。
  - **豆包迟到送达（改正：时机未知）**：侧栏后来出现 W2 会话，`navigation.entries()` 在 W2 与 W3 两次 newSession 之间多一条 `/chat/<id>`。草稿据此写「站点在恢复出帧后自己补发」，审计改为：只证明服务端最终有这条会话，是提交当时已送达、渲染被推迟（同 Linux 上 Kimi 的实测），还是解锁出帧后站点重发，**无法区分**。Gemini 同位置也有一条 `/app/<id>`，不能排除测试前遗留。Claude 未见补发，草稿持久化，W3 newSession 后输入框仍是这 169 字。无论哪种，结论都支持保留「提交不确定 ≠ 可以重发」。
  - Kimi 返回 submitted/composer；0.63s 起 `document.activeViewTransition` 一直存在、3 分钟以上不结束，`submitted(text)` 始终 false、URL 停在 `/`、DOM 无该消息、副本 waiting，侧栏可见服务端已建会话——这正是旧 `wasSubmitted` 会给出「确认未提交」的情形（I2/P4）。
  - DeepSeek 返回 submitted/composer，路由已到 `/a/chat/s/<id>`，虚拟列表未渲染、`userCount=0`，副本 waiting。ChatGPT、元宝、智谱在 rAF=0 时流式照常推进，副本 63/63/40 字符；智谱副本只剩代码块、三项列表丢失（NEW-1）。
- **W3 候选钩子（提问 #2）**：九站 webContents 挂 `did-navigate` 监听（`!isDestroyed() && !getBackgroundThrottling()` 时重设 false）。此时已解锁、newSession 时窗口置顶可见；newSession 后九站 rAF 171–174/1.2s，退回 Terminal 后后台六站 148–171，全程无截图；钩子 newSession 期间触发 10 次。七站群发 1.73s 全部成功（Claude 草稿非空、千问占位符误判，跳过）；ChatGPT/DeepSeek/Gemini/Kimi/元宝副本与页面一致（列表 + ```` ```python ```` 围栏）；Kimi 视图过渡 1.2–2.5s，1.7s 时 `submitted()` 已 true。移除钩子后各视图 `did-navigate` 监听数回到 1。
  - **改正（对照不受控）**：W2 与 W3 同时改变了锁屏、窗口置顶和钩子三项，W3 全部成功**不能归因于钩子**。能单独归因的只有 `w3b-hook-reload-occluded.json`：挂钩后后台页重载千问，did-navigate 366ms、did-finish-load 671ms，3s 采样出帧正常；其「不挂钩时 W1 同场景是 0」是跨时段对照（W1 那次窗口状态不同），不是同轮对照。
  - **豆包 W3 副本 unavailable**：页面上该轮正确（`userCount=1`、可绑定），首个快照即 `owned:false, ended:true`、已封存无正文。事后只读分析（未发问）：现场 bundle 在开关 `NavigateBeforeSend` 开启时先 push `/chat/local_<16位数字>`、确认后 replace 到正式 id，`history.js` 在 local 路由上锁归属、replace 后 `checkRoute` 判换路由 `stop()`；离线真 fixture 复现一致，其余八条 stop 路径逐条排除。**根因只到代码 + 离线复现层面**，现场地址序列未抓到，修复未落地（见 docs/adapters.md 豆包 `local_` 一段）。
- **W4 千问（不挂钩子，提问 #1）**：确认输入框文本等于占位符后按空输入单发，0.62s submitted/message；约 3.0s 停止键消失（`generation()` complete）时正文 53 字符，3.5s 内到 55；`qk-markdown-complete` 约 3.98s 才出现，比正文定稿晚 0.5–1.0s。副本正确。
- **Claude 导航卡住（改正：不能归因于草稿）**：Claude 输入框有持久化草稿期间，`reload()` 两次、`loadURL()` 一次都停在 `isLoading && isWaitingForResponse` 4 分钟以上，页面 CDP 无响应，主帧 `executeJavaScript` 正常、子资源 fetch 200（0.4s），移除钩子后仍复现；`wc.stop()` 可解除、状态随即 `load_failed`。没有「无草稿」对照，草稿只是当时的环境条件，**不能说草稿导致卡住**。另一次 `reloadSite(claude, ignoreCache)` 拿到响应但不出帧、`readyState` 停在 interactive、不触发 did-finish-load，重设 `setBackgroundThrottling(false)` 后 1s 内 load 完成转 ready。旧 newSession 等 did-finish-load 才 resolve，期间占着 `OperationGate`，群发被拒 `operation_busy`（NEW-4/C11，下节修复）。
- **`generation_unconfirmed` 是误报（C10）**：收尾状态里 ChatGPT、DeepSeek 为 `warning(generation_unconfirmed)`，两站回答都已完成且副本正确。短回答整段落在两次 900ms 探测之间，监控从没见到 generating，按规则不收口——是缺正向证据导致的误报，不是站点故障（下节修复）。
- **historyTurn 耗时（改正：未复现，不是证伪）**：W2/W3（ms，p50/p95/max）智谱 0.9/3.2/14.3（n=160）、1.0/3.0/13.9（n=161），ChatGPT 最大 41.9、元宝 42.7、豆包 98.7，无一次超过 200ms。Linux 上 1.25–1.46s 的长尾**本轮未复现**；样本只有两轮、单机，不能据此判定 Linux 长尾不存在（下节只加观测）。
- **元宝思考段**：流式 3.4–6.9s 期间 `answer()` 取到 `.agent-process-timeline` 下的 `.hyc-common-markdown-style-cot`（最长 879 字），旧过滤器 `[class*="cot__think"]` 命中 0，产品 5.6s 快照记下 599 字思考；7.5s 正文替换后最终副本正确。本轮无引用，「[image]」未测到。
- **md.js 吞列表（NEW-1）**：智谱结构 `answer-content-wrap > div > [div(markdown-body>ul), div(含 pre)]`，`preAhead()` 把装列表的透明 div 当语言头（首个文本「Red」/「mercury」匹配 `^[A-Za-z0-9+#.-]{1,20}$`）整块吸收；单转第一个子块可得 `- Red\n- Blue\n- Yellow`。
- **结论**：I1 在 Windows 上确认且范围大于 Linux（兄弟视图遮挡、窗口被盖、锁屏、最小化都会停帧；窗口遮挡解除后当前页自愈，后台页不会）；`did-navigate` 重设在可见窗口 + 视图互相遮挡时有单项证据，锁屏下是否有效未测；「提交不确定」的站点服务端可能最终有该问题，硬约束不变。

## 2026-10-04 修复与 Linux 复验

针对上节与 2026-10-04 Linux 开发态调研的问题修代码，未提交。每条改动配了在旧代码上失败的回归（HEAD worktree 换上新测试跑：13 个测试文件各至少红 1 条；Linux 复验时新增的三条断言把修复临时还原后各红 1 条）。门禁：`bash scripts/verify.sh` 通过；`cd desktop && npm test` tsc 通过、tsx 832/832、node --test 311/311；`npm run package && xvfb-run -a npm run smoke -- --skip-package` 为 `shell=1, sites=9, attached=9`（在 Linux 复验三处修复之前跑）。

- **I1 停帧**：`paint-recovery.ts`（每次主帧 `did-navigate`、窗口 restore/show/focus、`unlock-screen`/`resume` 时，仅当 get 为 false 才重设 `setBackgroundThrottling(false)`，事件后 1s 补一次），机制见 docs/desktop.md §1。测试 `desktop/test/paint-recovery.test.ts`（守卫、五个事件、计时器去重、清理，vm 载入真实 `site-view.ts` 验证 did-navigate 重设且 true 时不动）、`runtime-gates.test.ts`。
  - **Linux 受控对照**：后台页六站（DeepSeek/豆包/千问/Kimi/元宝/智谱，被 Claude 视图压住）做新会话。修复生效：1.5s 内六站 rAF 均 >0（三站 76–91，其余 1–41），RO/IO 有回调；对照组在内存里把这六个 webContents 的 `setBackgroundThrottling` 换成空函数（钩子被拦 7 次），六站 rAF/RO/IO 全 0、10s 后仍 0；恢复重设后立即 34–41、10s 后 76–79。每站 did-navigate 监听数 2（旧代码 1）。
  - **残留**：Kimi、元宝、智谱提交 10–20s 后掉到约 1 帧/秒（非 0），可复现；重设与 `invalidate()` 都无效，切到该页显示一次即恢复满帧。疑为 viz 对未合成上屏的帧限流，未验证；Windows 稳态未见；对群发与流式渲染的影响未评估。
- **NEW-4/C11 新会话占门**：`navigation-commit.ts` 的 `loadUntil(contents, url, "commit" | "load")`；新会话与提问历史恢复用 `commit`，辅助综合仍 `load`。`workspace-service.ts` 的 `NEW_SESSION_COMMIT_CAP_MS = 10_000` 逐站竞速，到点 `SiteHistoryAccess.abandon`（核对视图身份 → `stop()` → `beforeNavigate(site, true)` 钉 `load_failed`）再报 `not_ready` 放门。10s 依据：Windows W2/W3 共 18 次新会话导航「发起 → did-navigate」96–3557ms（最慢为锁屏下 Gemini，常态 ≤1.8s），约为最大值 2.8 倍，并与切档上限一致。测试 `desktop/test/navigation-commit.test.ts`（commit 先于 did-finish-load、主帧失败/销毁/提交前 reject、子帧失败不算、卡死的 claude 站到上限报 `not_ready` 并 abandon、上限 ≥3557×1.2 且 ≤15s、源码断言三处模式）。
  - **Linux 复验中发现并修**：① 上一文档未加载完时，新导航提交前会先替旧文档发一次主帧 -3（ERR_ABORTED），ChatGPT -3 后 16ms 即 did-navigate 却被报 `not_ready`——-3 不再算失败；② 旧文档的 did-finish-load 会让新 `loadURL` 提前 resolve（元宝 1654ms resolve、2933ms 才提交），门提前放开、群发可能打进旧会话——`commit` 模式只认 did-navigate，loadURL resolve 与 ERR_ABORTED 都不算，真被取代的导航由调用方上限收口（新会话 10s、恢复 15s）。
  - **Linux 实测**：九站新会话每轮占门 1.6–7.6s（= 最慢一站提交，常态约 3.1s）；同轮按 did-finish-load 计（旧写法）6.6–27.9s，个别站 25s 内未落地。修复后两轮连续新会话共 6 次「-3 后提交」均报 ok。刚启动的一轮 Kimi、元宝约 9.7s 内未提交，但测试脚本 8s 的 CDP 超时先到，**10s 上限分支（abandon → `load_failed` → `not_ready`）没有真机返回值**，只有单测。
- **NEW-1 md.js 语言头**：`langHead()`——透明块只有在自身可见文本（剔除 drop 件与从该层起才 `cursor:pointer` 的操作件）等于该词、或词后只剩已知操作件字样（复制/Copy/下载…），且没有 UL/OL/LI/P/TABLE/PRE/BLOCKQUOTE/H1-6 后代时才吸收为语言名；例外：带 lang 类名、文本恰为该词的 `<p>`（智谱头部条 `p.language`，Linux 复验发现按原规则会漏出「python 复制」后补）。测试 `desktop/scripts/md-runtime.test.js`（智谱列表结构、首词像语言名的段落、带 pointer 复制键的语言头、整条头部可点、真实智谱 `p.language`）。Linux 真页面：智谱「三原色」旧逻辑只剩代码块、新逻辑为 3 项列表 + ```` ```python ````，「行星列表」旧 0 项新 3 项，另 3 条会话新旧一致。
- **I2/P4 `wasSubmitted` fail-closed**：只读命令拆到 `site-runtime/read-commands.js`（`core.js` 300 → 291 行，监听器仍只在 core 注册），已登记 `preload/site.ts` 与 `PRELOAD_CHAIN`。`submitted()` 抛错、非布尔、未实现 → `{supported:false}`；返回 false 时再要求 ≤300ms 内 rAF 回调且 `document.activeViewTransition` 为空，否则同样 `supported:false`。测试 `desktop/scripts/submitted-probe-runtime.test.js`。`POLYASK_KIMI_RESUBMIT` 仍 false，F067 两条真机硬用例未做，fail-closed 只有单测。
- **I5/P6 元宝**：`answer()` 排除 `-style-cot` 与时间线/思考容器内的 markdown，思考正文或时间线有字而无正文时返回 null，只剩常驻 `__think__header` 头部条时退回整个回答容器（头部条文字可能进非 markdown 终态副本，有意取舍）；md.js 跳过引用容器（类名词元 `ref-list`/`citation(s)`/`cite`，查到序列化根为止）内无 alt 图片。测试 `desktop/scripts/yuanbao-answer-runtime.test.js`、`md-runtime.test.js`。Linux 真页面：深度思考会话 `answer()` 选中正文（不是 cot、不在时间线）；旧 md 输出 2 个 `[image]`（引用列表 2 个无 alt 图标），新为 0。历史会话的思考时间线展开后不渲染成 `.hyc-common-markdown`，排除思考块只能等流式时看，本轮未发问、只有 jsdom 覆盖。
- **C10/P8 短回答误报**：`generation.js` 停止键锁存（`armGeneration()` 于提交前武装，MutationObserver 100ms 节流 + 尾采样，提交时已在的停止键须先见其消失，锁存后断开，最长 15 分 45 秒；记 `answer()` 基线节点），`generationProbe()` 仅在锁存 + 基线外已连接新回答 + 窗口内时把 complete 升为 `complete_observed`；`generation-monitor.ts` 视同见过生成，仍要连续确认；`idle-throttling-policy.ts` 视同 complete。测试 `generation-runtime.test.js`（含「停止键闪现但没有新回答节点」）、`generation-monitor.test.ts`、`protocol.test.ts`、`preload-generation.test.ts`、`idle-throttling.test.ts`。真站短回答是否改报 `complete_observed`、选择器全失效时观察器跑满窗口的开销均未验。
- **I6 `once()`**：`QUIET_MS = 3000`（停止键消失后正文续长实测最大间隔 1.79s，ChatGPT），回答根身份变化时 `noteRoot()` 重算静止期；仍不凭静止判完成。测试 `question-history-locate.test.js`（2.1s 时不读）、`capture-audit-regress.test.js` 等 6 处 2_100 → 3_100。
- **I4 只加观测**：historyTurn 每批 MutationObserver 回调超过 250ms 计 `slow`，经 `slowObserver` → `normalizeHistorySnapshot` 白名单 → `CaptureLocateDiagnostics.recordSlow` → `Alt+H` 白名单行 `capture-slow-observer N`；锚点路径同一批内经 `ctx.batch` 缓存 `findComposer()`。Linux 从菜单触发 Alt+H 并复制：46 行、无网址；本会话没采集过回答，计数为空、该行不出现，格式靠 `capture-locate.test.ts`。**坑**：读回报告时从主进程读了剪贴板，用户原剪贴板内容被覆盖且无法恢复——以后读回诊断报告改走 `buildSiteReport` 的返回值，不碰系统剪贴板。
- **豆包 `local_` 路由**：根因分析见上节 W3；local 路由已并入 provisional 规则（docs/adapters.md），Windows 复验与随后发现的首问时间戳问题（D4）见下节。
- **仍待真机**：Windows 锁屏期间新会话、解锁后视图是否恢复；最小化还原后未导航视图；Claude 卡住时新会话 10s 后 `not_ready` 且紧接群发不再 `operation_busy`、状态显示「页面加载失败」（若 `stop()` 后仍来迟到 did-finish-load 会被洗回 ready）；Kimi/智谱/豆包/千问/Claude/Gemini 已有代码块回答新旧 `toMarkdown` 逐站对比（操作件词表凭经验）；元宝带引用的流式回答；ChatGPT/DeepSeek 短回答 `complete_observed`；豆包新会话首问地址序列。历史恢复 15s 超时仍只 `stop()`、不钉 `load_failed`（该站 phase 停在 loading）。`commit` 模式下目标 URL 与当前只差 `#hash` 时会等到上限才失败（现有 URL 不出现）。

## 2026-10-04 Windows TestLab 修复复验

**构建与环境**：同一 TestLab 实例（`%LOCALAPPDATA%\PolyAsk-TestLab`，Electron 44.5.0，未打包开发态），构建为 `ed87c618…+worktree-599a6d7fa06a`，即上节「修复与 Linux 复验」的工作区。依据是启动日志 `stdout-20261004-151719-779.log` 第 2 行 `kind=isolated-test-startup`；九站隔离世界里 `__AMS.readCommand`、`__AMS.armGeneration` 都是 function。启动器设了 `POLYASK_IDLE_THROTTLING_EXPERIMENT=1`，生产没有；九个站点视图的 `getBackgroundThrottling()` 全程为 false。窗口、缩放、布局同上节。共两段：15:17–15:53 机制轮（R0–R3），16:00–16:41 群发与副本轮（R4–R8）。脚本与原始 JSON 在会话临时目录 `windows-retest/run1517/`、`run-r4/`（各有 `_index.log` 记录写入顺序），事后审计在 `audit/`，都不入库。下文已按审计改正草稿，凡「改正」处以审计为准。`submit_unconfirmed` 一律不重发。

### 方法
- **只在页面隔离世界埋点**：每轮开始前装、结束后卸，卸载后核对函数已还原（`inst3.js`）。埋点都是透传包装，只记录产品自己的调用：`history.begin/snapshot`、`armGeneration`、`generationProbe`、`adapter.generation`、`adapter.historyTurn`。测试脚本从不调 `adapter.generation()`（它会喂停止键锁存）。另记三项：每 100 ms 采样一次路径（MutationObserver + navigation 事件）；每 3 s 取 500 ms 窗口测 rAF；每 250 ms 读一次 Kimi/元宝思考段 DOM 并对照 `answer()` 返回。主进程侧 R1/R2 把 webContents 的 `setBackgroundThrottling` 包成可放行/吞掉的壳，记录每次调用来源（`nav` = did-navigate 钩子，`sweep-event`/`sweep-settle` = 窗口事件及其后 1 s 补扫）。
- **审计复查（改正：收尾核对）**：`audit-check.json` 确认九站隔离世界与主世界都没有残留的 `__RT` 全局或包装函数，主进程窗口/电源监听数与 R4 前基线 `b0-baseline.json` 一致（如 `closed` 7），各视图 `did-navigate` 监听 2（产品 + paint-recovery）。千问输入框读出「向千问提问」5 字是测试读法把占位符文本节点当内容，不是残留草稿。
- **副本逐条取**：`getQuestion(id)` 只带 `loadedAnswerId` 那一条的 `answerMarkdown`，必须逐条 `getQuestion(id, answerId)`（`fetchq.mjs`）；只取一次会把其余答案读成空，第一轮因此误判过，已改正。
- **对照读页（改正：半独立）**：`dom-read.js`、`compare2.mjs` 不经 `toMarkdown`，取回答根的 innerText 行，去掉「复制/运行/下载/python」等 UI 字样、行号、序号与项目符号，与副本 Markdown 行（去围栏与列表标记）做行级比较，另比 li、code 文本与语言名。但**回答根取自 `adapter.answer()`**，只有正文提取是独立的：`answer()` 选错节点时两边会一起错，这项对照证明不了定位正确。千问、Kimi 的代码块不是 `<pre>`、元宝 `<pre>` 嵌套重复，这三站只看行级；智谱引用角标并进正文行、元宝 `<hr>` 不出文本，两站的行级不等属预期。
- **窗口状态**：每次测量经 user32 记 z 序、前台、最小化、空闲时长、锁屏，加外壳 `visibilityState`。`SetWindowPos(HWND_TOP, SWP_NOACTIVATE)` 对后台进程返回 true 但 z 序不变，要用 `HWND_TOPMOST` 紧接 `HWND_NOTOPMOST`；powershell 每次 `Add-Type` 3–6 s，最小化等动作的落点只能精确到这一量级；Chromium `visibilityState` 跟 z 序变化有数秒滞后，不能当实时遮挡判据。

### 机制轮（15:17–15:53，`run1517/`）
| 项 | 结论 | 证据 |
| --- | --- | --- |
| R1 paint-recovery 同轮 A/B（窗口可见；后台页六站新会话） | A 放行：五站提交后 +1.5 s / +10 s rAF 213–218。B 吞掉 `setBackgroundThrottling` 调用：ChatGPT、Gemini、DeepSeek、豆包、千问 +1.5 s、+10 s 全 0（Claude 未提交、没导航，照常出帧）；拆壳后不导航仍 0；C 放行再导航，全部回到约 217。Windows 上首次同轮受控证明 did-navigate 重设有效且必要。 | `r1-ab.json` |
| R2a 被最大化 Terminal 盖住时新会话（外壳 hidden） | 放行：钩子触发 7 次，+1.5 s 各站 82–206、+10 s 187–213。只吞 `nav`：导航的六站 +1.5 s、+10 s 全 0；揭开后窗口事件补扫 18 次，0.4 s 内全部回到约 214。`nav` 与补扫全吞：揭开后当前页三站自愈，后台页 ChatGPT/Gemini/DeepSeek +12 s 仍 0；随后放行再盖、再揭，三站恢复到约 213（`recover-after-r2a3.json`）。两处钩子各自有效，后台页只能靠它们。 | `r2a1-pass.json`、`r2a2-swallow-nav.json`、`r2a3-swallow-all-paint.json` |
| R2a 新会话放门时机（改正：门禁真证据在这里） | 盖住状态下六站新会话 711–1343 ms 即返回。`r2a1` 中最慢一站 Gemini 07:29:48.796 did-navigate、8 ms 后 resolve，它的 did-finish-load 到 07:30:06.4（揭开窗口之后）才来，+10 s 状态仍是 loading。放门跟着最后一站提交走、没有等 did-finish-load，这是「提交即放门」的直接证据。 | `r2a1-pass.json` 的 `events` |
| R2b 最小化 5 s 再还原 | 最小化 0.8 s 时豆包 2、智谱 1、千问 30/154 帧，其余 172–217。还原后无论放行还是吞掉补扫，全部立即约 215：**还原时的恢复来自 Electron/Chromium 自身**，paint-recovery 的 restore 补扫在这个场景里是冗余的（无害）。 | `r2b1-minimize-pass.json`、`r2b2-minimize-swallow-sweep.json` |
| R3a 新会话后立刻群发（3 轮，ChatGPT+DeepSeek 短问） | 三轮都没有 `operation_busy`，页面上带本轮标签的用户消息各 1 条（无重复发送）。**改正（证明力弱）**：每轮新会话都因 Claude 撞 10 s 上限耗时 10.1–10.4 s，群发是在上限放门之后才开始，没有考到「提交即放门」；发送前的输入框检查是 fail-open（ChatGPT `#prompt-textarea` 没找到也照发）。ChatGPT 三轮状态都停在 submitted（D1）。 | `r3a-gate.json` |
| R3b DeepSeek 受控卡死 | CDP `Fetch` 暂停 DeepSeek 主帧 Document 请求后新会话：10 139 ms 返回 DeepSeek `not_ready`，状态 `failed/load_failed`；紧接群发 28 ms 返回 `load_failed`，输入框未写入（长度 0、标签 0 条）；`reloadSite` 后 1027 ms 回到 ready。**新会话 10 s 上限分支的首个真机返回值**（上节只有单测）。 | `r3b-cap-deepseek.json` |
| R3c Claude 自然卡死 → D2 | 新会话 10 051 ms `not_ready`，主帧 `GET /new` 在上限时被 `stop()` 取消（`ERR_ABORTED`），群发 1 ms 返回 `load_failed`、不写入。随后 `reloadSite(claude)`：`isLoading && isWaitingForResponse`、phase loading，页面 CDP `Runtime.evaluate` 超时；07:47:37–07:51:07 每 10 s 轮询都是 loading，07:50:36 的清缓存重载同样卡住，到 07:53 仍未落地（自 07:42:13 起 11 分钟以上）。重载没有上限，站点永远 loading。 | `r3c-claude-natural.json`、`claude-poll-*.json`、`claude-reload-ignorecache.json` |
| Claude 新会话上限（改正：7/7） | 本段 Claude 参与的 7 次新会话（R1 A/B/C、R3a ×3、R3c）**7/7** 都撞 10 s 上限，均为 `not_ready` → `load_failed`，之后群发直接返回 `load_failed`、不写入；群发轮另有 3/5（下节）。 | 同上 |
| ChatGPT 中文停止键 → D1 | 中文界面发送后 0.5–4.4 s 出现可见的 `button[aria-label="停止"]`（观察 21 次），不匹配 chatgpt.com 选择器（`matchesSel:false`）；外壳状态 31 s 内一直 submitted，探针读 complete。 | `gpt-stop-probe.json` |

### 群发与副本轮（16:00–16:41，`run-r4/`）
| 项 | 结论 | 证据 |
| --- | --- | --- |
| R4 九站可见（发送时置顶未激活 polyZ=1；+4 s 起用户点开微信，polyZ=2，部分遮挡） | ChatGPT、Gemini、DeepSeek、千问、Kimi、元宝、智谱副本与对照读页逐行一致（对照的回答根同取自 `answer()`，见方法），python 语言名一致，Claude 围栏正确；智谱列表 3/3 完整，代码块头没混进副本；Kimi 页面有思考段（「思考已完成」，237 字），副本里没有。豆包 unavailable（D4）。最终外壳：ChatGPT `generation_unconfirmed`（D1），Claude `submit_unconfirmed`（未重发，副本仍抓到 59 字且与页面一致），其余 7 站 complete。 | `r4-roundA-visible*.json`、`claude-r4v-compare.json` |
| R5 遮挡（压在最大化 Terminal 下，外壳 hidden） | 两轮（置前失败后的自然遮挡、有意遮挡）。遮挡期间各视图 rAF 不为 0（每 500 ms 最少 1–3 帧），7 站副本完整；Claude 两轮都撞新会话 10 s 上限转 `load_failed`，群发被拦。 | `r4-roundA*.json`、`r5-occluded*.json` |
| R6 最小化后还原 | 群发后 4–10 s 内最小化、保持 25 s。当前页三站（Kimi、元宝、智谱）与 ChatGPT 最小化期间 rAF 0，后台页视图仍出帧；Kimi、智谱、ChatGPT 在最小化期间答完，副本完整；还原后 60–71 帧/500 ms。 | `r6-minimize*.json`、`r6b-minimize-long*.json` |
| R7a 同文重发（同 runId、同会话）→ D5 | 页面上带本轮标签的用户消息正好 2 条、两次回答不同。Kimi、ChatGPT 的 attempt 1 等于前一条回答、attempt 2 等于最后一条；**改正**：豆包 attempt 2 等于最后一条，attempt 1 是新会话首问、unavailable（D4 第 6 次），不是「等于前一条」。同会话第二次提交让上一条已答完的副本被收口为 interrupted（Kimi、ChatGPT），没有一条是 complete。Kimi 与豆包外壳状态在重试后 1.2 s 就显示 complete（沿用第一次的生成条目，D5）。 | `r7a-1.json`、`r7a-2.json`、`r7a-check.json` |
| R7b 思考档（Kimi、元宝，tier=think） | 流式采样里只有思考段时 `answer()` 返回 null（Kimi 8.0–11.8 s、元宝 5.3–8.5 s），正文出现后返回正文块。**改正（元宝无检验力）**：「副本里没有推理文本」是拿最终 DOM 比的，元宝最终 DOM 里思考时间线不再渲染成 markdown，这项比较对元宝推理泄漏没有检验力；能用的只有流式期间 `answer()` 为 null 的采样。Kimi 切档路由经过 `/agent?chat_enter_method=change_model`，仍发送成功。 | `r7b-think*.json` |
| R7c 元宝联网引用 | 引用列表 2 个无 alt 图标，副本里没有 `[image]`；答案根 31 行除项目符号 `•` 外都在副本中。 | `r7c-*.json`、`r7c-coverage.json` |
| R7d 短回答（「只回答 OK」，每站 2 次） | DeepSeek 两次都由 `complete_observed` 收口为 complete——**短回答误报修复的首个真机正例**。ChatGPT 两次 `generation_unconfirmed`，探针始终没读到 generating（D1）。 | `r7d-short-*.json` |
| R8 计数 | `getCaptureLocateCounts()` 相对基线的增量逐站对得上轮数；豆包 semantic 4、selector 1：6 次首问里有 2 次在主进程首个快照前条目已结束、没上报定位，selector 那次是 R7a 第二问。`slowObserver` 全程 0，快照里没有 slow；`getRuntimeProcessFailures()` 为空。 | `r8-counters.json`、`b0-baseline.json` |
| I1 / 门禁 | 每次新会话后立刻群发都没有 `operation_busy`。Claude 5 次新会话中 3 次 `not_ready`（**改正**：10.0–10.7 s，不是 10.0–10.25 s），之后 `load_failed`、群发直接返回不写入；R4V 一次新会话整体 12.6 s、九站全 ok，超出 10 s 的部分耗时构成未拆分。Kimi 视图过渡每次 0.5–5.6 s 内结束，没有卡住。 | 各轮 `newSession`/`vt` 字段 |
| 收尾状态（改正：没有一条封存为 complete） | 所有副本最后都是 `capture=unknown`、未封存（固定 15 分钟观察窗内），或被同会话后续提交收口为 interrupted，或 unavailable（豆包首问）。副本内容正确不等于完成状态已确认；「unknown 是常态」符合「不凭静止判完成」的设计，但本轮没有一条真机证据走到 complete 封存。 | `*-copies.json`、`r7a-check.json` |

### D4 豆包新会话首问副本丢失（6/6）
- **现象**：豆包新会话的第一问 **6/6**（R4、R4V、R5、R6、R6b、R7a 第一问；**改正**：草稿记 5/5）都是 `capture=unavailable`、0 字，可见、遮挡、最小化下都发生，与窗口状态无关。
- **时序**：① 豆包先 push 到 `/chat/local_<数字>`，此时用户气泡还匹配不上第 ① 级 `[data-message-id]`，首次 bind 冻结为 ② semantic；② local 路由下副本保持归属（如 R4V +14.6 s 时 `owned:true`）；③ 约 2–4 s 后用户节点 `[data-message-role=user]` 内的 `message_action_bar` 插入 `<time>今天 16:16</time>`，② 读到「原文 + 今天16:16」；④ `bind()` 判 `normalize(turn.text) !== e.text`，`stop()`，此时还没有 finalSnapshot，结果 unavailable。
- **改正（provisional 路径未验证）**：草稿据 ② 写「provisional 路由的修复本身有效」。实际只证明**进入 local_ 不会结束副本**；6 次都在 replace 到 `/chat/<id>` 之前就被 ④ 结束，local_ → 正式 id 的迁移真机一次都没走到。
- **对照**：同会话第二问基线已有用户轮，冻结在 ① selector，读 `[data-message-id]` 节点本身、不含操作条，text 校验全程 true，副本完整（`r7a-2.json`）。
- **证据**：`r4-roundA-visible.json`（`rt.doubao.data.turns/mismatch`）、`r5-occluded.json`、`r7a-1.json`、`doubao-dom-probe-after-r4v.json`。

### 其他观察
- ChatGPT 对照读页的选择器变了：用户气泡 `[data-user-message-bubble]`、回答 `[data-chatgpt-selection-message-id]`，`data-message-author-role`、`data-turn` 都不存在了；产品第 ① 级仍命中（用的是 `data-user-message-bubble` 与 `data-turn-key`）。
- 智谱引用角标紧贴正文进副本，如 `…现象。**cma.gov.cn+2`（D6）。
- 16:28 左右工作站被锁屏（LockApp 在前台，非测试操作），R7a–R7d 都在锁屏下跑完，各视图仍出帧、副本正常；解锁时 paint-recovery 的 `unlock-screen` 路径没有观测。

### 未证明
- 豆包 local_ → `/chat/<id>` provisional 迁移，以及 replace 时是原地补 `data-message-id` 还是重渲染换节点。
- 任一站副本真机走到 `capture=complete` 封存；同会话追问把上一条已答完的副本记为 interrupted 是否应改为保留完成态（未决策）。
- 「提交即放门」在新会话后紧接群发的并发场景（R3a 被 Claude 上限掩盖，只有 R2a 的事件序列）。
- 元宝思考段不进副本的终态证据（最终 DOM 无检验力）；ChatGPT/Gemini 思考段排除（F098）。
- `unlock-screen` 唤醒、锁屏期间新会话；Gemini 登录回跳重载的停帧。
- Claude 主帧请求不回包的根因（站点、网络还是本机代理），以及「拿到响应但不出帧、`readyState` 停在 interactive」能否由 paint-recovery 收口。
- zh-TW 界面停止键、智谱角标真实 `data-url` 格式。
- `POLYASK_KIMI_RESUBMIT` 仍 false，F067 两条真机硬用例未做。

### 本轮修复（D1/D2/D4/D5/D6）
未提交、未发送提示词。每条修复都配了回归，并逐条临时回退确认旧代码会让对应用例失败。门禁：`cd desktop && npm test` tsc 通过、tsx 841/841、node --test 324/324；`bash scripts/verify.sh` 全部通过；`npm run package && xvfb-run -a npm run smoke -- --skip-package` 为 `shell=1, sites=9, attached=9`。`view-manager.ts` 747 行（棘轮 748），history.js 255、history-locate.js 214、md.js 278。
- **D4 豆包首问**：`userText()` 只读唯一的 `[data-testid="message_text_content"]`，否则剔除 `<time>` 与操作条子树（从末尾往前删，只删参与渲染的元素，`checkVisibility()`，jsdom 无此方法时视为可见）；豆包第 ① 级同样只读正文容器；`promote()` 让 ② 在严格条件下单向让位给 ①（规则见 docs/adapters.md「方法冻结」）；local 路由上绑定后、地址锁定前，已绑用户节点脱离文档即 `stop()`，防止换绑到同文旧会话。回归 `desktop/scripts/doubao-new-chat-capture.test.js`：local_ 下插入 `<time>` 副本不结束；replace 到 `/chat/<id>` 并补 `data-message-id` 后升到 ①、副本只有正文且不带思考头、离开该地址即结束；不在已绑用户内的 ① 气泡不换绑；先换地址/先换 DOM 两种顺序跳到同文旧会话都结束且不带旧回答（旧代码返回 `{owned:true, text:'昨天的旧回答'}`）；隐藏操作条里的「复制」也出现在原文时原文完整。replace 是离线模拟，见「未证明」。**注**：「原地补 key、节点不换」的前提已被第 3 轮真机推翻，现行 D4 回归以下文「离线已落地（2026-10-04，待真机）」的 `rebase()` 条目为准。
- **D1 ChatGPT 中文停止键**：chatgpt.com 选择器加精确匹配 `button[aria-label="停止"]`，停止键锁存共用。回归 `generation-runtime.test.js`（真实选择器下「停止」算、「停止朗读」不算）。
- **D6 智谱角标**：`md.js` 对类名词元 `source-item` 的角标整体输出、空格分隔，带绝对 http(s) 地址写 `[文本](href)`，否则 `[文本]`；`safeHref` 拆出 `safeUrl`。回归 `md-citation-chip.test.js`（合成角标、普通链接不受影响、真实智谱 fixture 不再粘连）。
- **D2 重载上限**：`reload-commit.ts` 的 `ReloadCommitWatch`，`RELOAD_COMMIT_CAP_MS = 15_000`（依据见 docs/desktop.md 预算表）；主帧提交、主帧真失败（ERR_ABORTED 不算）、视图销毁、下一次导航接管或渲染进程退出（保留 `renderer_crashed`）即解除，到点 `SiteHistoryAccess.abandon`（`stop()` 后钉 `failed/load_failed`），用户可再重载。`ViewManager.beginNavigation` 统一重载（含清缓存重载）、后退/前进（`navigateHistory`）与清站点数据；看门期间 `sendCommand`/`collect` 返回可重试的 `not_ready`，群发在 deadline 内重试；新会话/历史恢复提交期间（`SiteHistoryAccess.navigating`）拒绝重载、后退/前进与清站点数据。回归 `desktop/test/reload-commit.test.ts`（真实 ViewManager 跑在模拟视图上：两种重载与清站点数据 15 s 转 `load_failed` 且先 `stop()`、之后可再重载；按时提交不受影响；新导航撤旧看门；上限对实测值留足 20% 余量；渲染进程退出不被改写）。
- **D5 同 runId 重试**：`GenerationMonitor.begin` 对被重试站重置为 submitted、清旧证据，其余站保留。`generation-monitor.test.ts` 原用例把缺陷当正确行为断言，已改写为「重试站重新计、旧证据不带过来、未重试站仍 complete、生成中站保留」。
- **仍待真机**：豆包新会话首问（capture 不再 unavailable、locate 先 semantic 后 selector、副本无思考头、local_ → `/chat/<id>` 地址序列）；ChatGPT 中文界面短/长回答改报 complete 或 `complete_observed`；Claude 重载卡住时群发拿到 `not_ready`、15 s 后显示「页面加载失败」；新会话期间点重载无反馈；智谱副本角标外观；重试后状态从 submitted 重新走。

## 2026-10-04 Windows TestLab 第三轮复验（D1/D2/D4/D5/D6 与完成状态）

**构建与环境**：同一 TestLab，18:41 由官方启动器拉起（PID 35944），启动日志 `stdout-20261004-184148-323.log` 的 sourceCommit 为 `ed87c618…+worktree-2ada63f6967f`（上节「本轮修复」的工作区），应用 1.11.2、Electron 44.5.0、`POLYASK_IDLE_THROTTLING_EXPERIMENT=1`；九视图 `getBackgroundThrottling()` 全程 false。T0（18:48）：overview 第 2 页、focused=kimi、九站全选、九站 ready；Kimi `state()` 为 null（不是交接时说的 think），各轮 tier 一律显式传 null 并记录。脚本与 JSON 在会话临时目录 `windows-retest3/`（`_index.log` 记写入顺序），只读审计在 `audit-retest3/`，均不入库。下文已按审计改正测试报告。卫生：输入框检查 fail-closed（找到、可读且为空或仅占位符才发）；埋点只透传包装，运行中不手动调 `generation()`/`generationProbe()`；不碰剪贴板；每个测量点记 user32 窗口状态；`submit_unconfirmed` 一律不重发。提示词均为「PolyAsk 测试 <TAG>：」开头的中性问题，无图。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| **D4 豆包新会话首问** | **失败 5/5**（可见 ×2、后台页 ×2、被最大化 Terminal 遮挡 ×1）：全部 `capture=unavailable`，封存于发送后 7.56–12.61 s，早于外壳 complete（9.4–14.4 s）。第 2–5 轮埋点同一过程：push `/chat/local_<n>` → 3–5 s 后 replace 到 `/chat/<id>`；local_ 阶段绑定为 ② semantic、`teq` 始终 true（如 run2 5828–9050 ms），① 查询 uc=0；**replace 后 315–625 ms 语义级用户节点被整体换成新节点**（`userSwaps` 均 `oldConn:false, oldContainsNew:false, newContainsOld:false`）；同一批回调里 ① 已命中（uc=1、teq=true、带 key），之后 `historyTurn` 不再被调用，下一快照 `owned:false, ended:true`。第 1 轮用的是旧版埋点（inst4.js 改于 18:55:20，第 1 轮 18:53:53），无 navs/userSwaps，换节点是从路径与快照推断的。结论：docs/adapters.md「local_ 阶段的归属守卫」与 history.js 注释「确认成正式会话只有同一节点原地补 key」的前提被 Windows 真机推翻。 | `t1-doubao-{1..5}-*.json` 的 `rt.doubao.data`（turns/userSwaps/paths/snaps） |
| D4 子项 | 「用户文本剔除 `<time>`」在 ② 上有效：页面用户气泡带「今天 19:07」等时间戳，local_ 阶段没有再出现 W3 式 text mismatch。① 只读 `message_text_content`、`promote()` 单向升级、首问封存 complete 三项首问从未走到，**未验证**。同会话追问（t1x）走 ① selector、complete+sealed（外壳 complete 后 3068 ms），副本无时间戳/相关视频/推荐问题——这是另一条代码路径，不能当 D4 对照。 | `t1x-doubao-followup-contrast*.json` |
| D1 ChatGPT 中文停止键 | 通过：页面 lang=zh-CN，5 轮停止键采样只命中 `button[aria-label="停止"]`（英文 Stop、`data-testid=stop-button` 均 0）；产品自己的 `generationProbe` 依次 generating → `complete_observed`；外壳均 complete、无 `generation_unconfirmed`；副本在外壳 complete 后 3073–3178 ms 封存 complete。独立读页（改正）：只有第 2、4 轮有修正后重读（读取器改过 3 次：用户轮边界、CodeMirror 代码块、侧栏），第 1、3 轮没有有效独立读取（第 3 轮重读作废，运行内对比代码两行 missingInPage）；第 4 轮重读的 `page.pre` 是两行拼成一行的 `data = [1, 2, 3]print(data)`、比较前又去空白，只证明代码内容相同，证明不了「两行」结构。 | `t2-chatgpt-{1..5}*.json`、`t2-chatgpt-{2,4}-*-reread-chatgpt.json` |
| D5 同 runId 重试（1 次） | 通过：沿用 T2 第 4 轮 runId 与文本，外壳 936 ms submitted → 956 ms generating → 8654 ms complete，没有提前收口；attempt#2 11 737 ms 封存 complete；attempt#1 保持 complete，sealedAt 整轮不变。 | `t2-chatgpt-5*.json` |
| 完成封存 | T2/T3/T6/t1x 所有 complete 副本都在外壳 complete 后 3013–5133 ms 封存（与 `SEAL_QUIET_MS=3000` 一致），`copyAtSealEqualsFinal` 全 true。T3 九站新会话（列表 + 两行代码）封存的是 **7 站**（改正：报告写 8 站）：ChatGPT 3214、Gemini 3085、DeepSeek 3102、千问 3668、Kimi 3087、元宝 5133、智谱 3081 ms；豆包 unavailable（D4），Claude 见下。追问（Kimi/ChatGPT/Gemini 同会话）新副本 3013/3076/3067 ms 封存 complete；T3 原问题 9 份副本的 capture、sealedAt、updatedAt、markdown sha1 前后完全相同（审计复算）。**取消没测**。 | `t3-all9*.json`、`t3-followup3*.json`、`t3-after-followup-check.json` |
| T3 独立读页（改正：证明力有限） | 运行内对比里千问、Kimi、智谱 `pageNoTag=true`，分别 miss 6/7/8 行、codeEqual=false；「7 站副本行都能在页面找到」只来自约 1 分钟后的事后重读，`page-read.js` 在看到结果后改过（mtime 19:14:49），重读只查单向包含、不查顺序，页面独有行（Kimi「思考已完成」与思考正文、元宝「已处理」等界面文字）是人工判读。元宝 `thinkLeak` 2（T3）/4（草稿轮）是误报：`[class*=think]` 命中了包住整段回答的 `hyc-component-deep-search-agent`，副本无思考内容。`[image]`/`[图片]` 占位检查本轮无检验力（全部无图）。 | `t3-all9-compare.json`、`t3-all9-reread-*.json`、`t3-yuanbao-draft-compare.json` |
| 元宝草稿 | 部分：深度搜索长文流出中 8578 ms 用 CDP `Input.insertText` 插入草稿「PolyAsk 草稿 不要发送」，保留约 45 s；此时 `generation()` 仍为 generating，走的是「正在生成」分支，`answer()` 流出期间一直 null；外壳 18.2 s complete、21.3 s 封存，副本与最终回答一致（892 字、missing 0）。「停止键已隐藏、正文仍在增长」的否决分支（`watchInteraction` changedAt<2s）**没走到**。草稿已用可信按键清空，复核长度 0。 | `t3-yuanbao-draft*.json` |
| D2 重载上限 | 通过：CDP `Fetch` 暂停 DeepSeek Document 请求后 `reloadSite` 返回 true、phase loading，**4 次**（t4、t4-run2、t4probe、t4b；改正：报告写 3 次）did-stop-loading 都在约 14 995 ms、约 15.2 s 转 `failed/load_failed`；看门期间 `collectAnswers` 两次 3 ms 内返回 `not_ready`（与 `sendCommand` 共用 `reloads.watching()`），上限后返回 `load_failed`；`Fetch.disable` 后再重载 526–533 ms 回到 ready。看门期间真群发**没执行**：旧文档渲染进程对执行请求无响应直到上限（主世界 evaluate 13.5 s 才返回），输入框读不出，按 fail-closed 跳过；所以「上限后 tag 计数 0」没有检验力。 | `t4-reload-cap-deepseek*.json`、`t4-eval-during-pending-probe.json`、`t4b-collect-during-watch.json` |
| D2 新会话挂起门禁 | **部分**（改正：报告判 pass）：暂停 DeepSeek Document 后对 Claude/ChatGPT/DeepSeek `newSession`，挂起中（1.5–2.3 s）`reloadSite` 与清缓存重载返回 false、`clearSiteData` false，webContents URL 与 history 索引不变；`stepHistory(-1)` 800 ms 内无导航事件，此时 Electron `canGoBack=true`、产品 `siteHistoryState` back:false——只是弱证据，T0 时 back 本就 false，没有同状态阳性对照。10 051 ms DeepSeek `not_ready` → `failed/load_failed`，`Fetch.disable` 后重载 533 ms 恢复。前进、历史恢复（restore）挂起期间的门禁**没测**。 | `t5-gate.json` |
| D6 智谱角标 | 通过：联网 19 来源，页面 4 个 `span.source-item`（source-aggregated，带 `data-url`），副本写成「…7~9级。 [thepaper.cn +1](https://www.thepaper.cn/newsDetail_forward_34199165)」「…做好防火准备。 [weather.com.cn](…)」「[thepaper.cn +2](…)」，与正文分开；逐行 missing 0，complete，外壳后 3064 ms 封存。读页不采属性，链接 URL 是否等于 `data-url`、聚合角标该取哪个 URL 未核。 | `t6-zhipu-cite*.json` |
| wasSubmitted 页内归一（T7） | 通过（只到页内 `readCommand` 层）：Kimi 隔离世界临时替换 `adapter.submitted`，抛错、undefined、`'false'`、0、`activeViewTransition` mock 非 null、其 getter 抛错、deadline 只剩 40 ms 都回 `supported:false`；false/true 对照分别 `{supported:true, ok:false}` / `ok:true`，真实适配器配不存在文本 `ok:false`。已还原（审计确认 `submitted` 为原压缩函数）。主进程 `normalizeSubmitted` 与 `POLYASK_KIMI_RESUBMIT`（仍 false）端到端没测。 | `t7-wasSubmitted.json` |

**Claude**：T3 后台页新会话 3458 ms 返回 `submit_unconfirmed`，事后重读页面有标签 T3A-pv982 与完整回答，227 字副本各行在页（未重发）。交给用户点重试是硬约束的设计行为；缺陷在于确认逻辑远早于 44 s deadline 就判成未提交，用户点重试会问两遍；未确认站不进生成监视，副本停在 unknown、未封存。当时页面同时挂着 inst4 埋点和每秒一次整页读取（TreeWalker + `getBoundingClientRect`），不能排除干扰。此后 claude.ai 的 `/new`、`/chat/...` 文档请求挂住超过 12 s（另记一次 favicon 843 ms 返回 200，但该探测没留脚本、发出上下文不明），新会话 10 s 与重载 15 s 上限都按设计收口为 `load_failed`、没停在 loading，连续 4 次重载（含 1 次清缓存）都约 15.1 s 后 `load_failed`，结束时仍 `failed/load_failed`。原因未定：网络、claude.ai 边缘或账号限流（页面显示过 weekly limit 75%）、测试反复导航都没排除（`claude-natural-hang-recover.json`、`claude-recover-*.json`）。

**收尾**：通过（改正：报告判 partial）。只读审计：九站无 `__RT`、包装已还原，主进程与外壳无残留全局，bt 全 false，布局/选择/tier/各站 `state()` 与 T0 相同，Windows Temp 的 `pa-retest-win.ps1` 已删，已跟踪文件最后修改 18:33（早于启动）。监听数相对 T0 只差 `win:closed` 8→7，原因已查明：`POLYASK_RESOURCE_TRACE` 的 `resources-20261004-184148-323.jsonl` 共 362 行、末条 11:11:53Z（lastElapsed 1 803 258 ms），`resource-trace.ts` 满 361 样本或 30 分钟即 dispose 并 `removeListener('closed', …)`，属产品按设计注销，非泄漏、与测试钩子无关。`final-check.json`（19:27:54）不是最后一次核对，其后 19:28:08–23 还跑了 `claude-recover-4`，审计复核监听数与 final-check 一致。窗口 z 序每轮恢复到开跑时紧邻其上的窗口之下；结束时 polyZ=2（T0 为 1）来自其他进程的 msrdc 窗口，T3 第 202 s 后 PolyAsk 被外部操作聚焦过一次。

### D4 修复须同时改三处（history.js）
① `checkRoute` 的 local_ 守卫：仅当 Navigation API 记录为 replace、local_ → 正式 id、距绑定很短、新用户节点同文且 userCount=1 时允许一次换节点迁移（参照 Kimi 首屏迁移），push 导航（侧栏打开同文旧会话）照旧 `stop()`；② `promote()`：迁移窗口内不再要求 `e.user.contains(sel.user)`，改由 ① 重新确立用户节点；③ `bind()` 乐观替换分支的 `!e.answer`（约第 126 行）：local_ 阶段快照若已设 `e.answer`（run1 local_ 阶段有过 `owned:true` 快照，只是 len=null 没设上），换节点同样会 `stop()`。离线回归补「replace 后换节点」「换节点时 `e.answer` 已设」两例，并改正 docs/adapters.md 与 history.js 注释的「节点不换」前提。修后真机：≥5 轮覆盖可见/后台页/遮挡，加一轮不装埋点的对照；验收 complete、locate 先 semantic 后 selector、副本只含 `message_text_content`；再补侧栏打开同文旧会话的阴性用例。

**离线已落地（2026-10-04，待真机）**：`history.js` 新增 `rebase()`，按上面 ① 的条件放行一次 local_ → 正式 id 迁移；replace 的判定用 `navigation.currentEntry.key` 与绑定在 local_ 上时记下的相同（replace 留槽、push 换槽，取不到 key 即 fail-closed 结束）；窗口 10 s（单站 T1 绑定到换节点最长 5.18 s；最慢是九站群发 `t3-all9`，绑定→replace 5.25 s、→换节点 5.92 s，延迟随负载增长，10 s 约留 69% 余量）。两条 Navigation API 前提当时尚未实测：replace 保留 `navigation.currentEntry.key`、侧栏打开旧会话是 push（第四轮已证实，见下节）。下一轮真机埋点在 push/replace 前后记 `currentEntry.key`，并在 `/chat/<id>` 页点侧栏旧会话记 `navigationType`（只读，不发提示词）。② 未改 `promote()` 的包含条件，改为先由 `rebase()` 换绑到新节点、同一次定位里再升级；③ 换节点时清空已锁回答根，由新节点重新确立。回归 `doubao-new-chat-capture.test.js`（真实序列三种时序，旧代码 4 例失败）与 `doubao-local-migration.test.js`（逐条阴性）。真机验收仍按上段。

### 仍未证明
- 豆包首问：① 正文容器、`promote()`、首问 complete 封存；`stop()` 确由 local_ 守卫触发（无调用点埋点，靠代码顺序 + 轨迹推断，且所有豆包轮都装着埋点）。
- D2：看门期间群发拿 `not_ready` 并在 deadline 内重试、页面不写入（只有 `collectAnswers` 旁证；可在主进程只读包装 `sendCommand` 回包补测）；历史恢复挂起期间拒绝重载/前进/后退/清站点数据；新会话挂起期间的前进；后退被拒的阳性对照。
- 完成语义：已封存 complete 在取消时保持 complete、流出中副本取消转 interrupted；两次读之间正文变化时候选重置不封存的反向分支。
- 元宝否决分支（停止键隐藏、正文仍增长时插草稿）。
- D1 反事实：同页旧选择器阴性对照、未采样的「stop answering」「stop generating」「停止回答」；停止键一闪而过的短回答；窗口可见且聚焦条件（T2 只测了后台页、窗口未聚焦）。
- T2 第 1、3 轮与 T3 千问/Kimi/智谱的运行时独立读页；读页器需双向、按序、保留代码换行，思考判定排除元宝 deep-search-agent 外壳。
- D6 角标 URL 与 `data-url` 的对应。
- Claude `submit_unconfirmed` 漏判根因（不装埋点、不做整页读取的后台页新会话对照，另一组只读记录 `confirmSubmitted` 判定输入）；claude.ai 文档挂起的归因。
- T7 主进程 `normalizeSubmitted` 与 resubmit 开关端到端；`POLYASK_KIMI_RESUBMIT` 仍 false，F067 两条真机硬用例未做。

## 2026-10-04 Windows TestLab 第四轮复验（D4 迁移与补测）

**构建与环境**：同一 TestLab，20:17 由官方启动器重新拉起（PID 24596），启动日志 `stdout-20261004-201733-016.log` 的 sourceCommit 为 `ed87c618…+worktree-e478b5ab7f64`（含 `rebase()` 与前三轮全部修复），Electron 44.5.0；九视图 `getBackgroundThrottling()` 全程 false；只读确认页面 `__AMS.history.begin` 源码含 `localSlot`、`swapUntil`。U0：overview 第 2 页、`workspace.tier=null`、九站全选、九站 ready；基线档位 Claude think、ChatGPT fast、Gemini think、DeepSeek fast、豆包 fast、千问 fast、Kimi null（非预设档）、元宝 think、智谱 think；窗口最大化、前台、polyZ=1；监听基线 `win:closed`=8、power `unlock-screen`/`resume` 各 1、各站 wc 32、外壳 25。脚本与 JSON 在会话临时目录 `windows-retest4/`（`_index.log` 记写入顺序），只读审计在 `audit4/`，均不入库。下文已按审计改正测试报告。卫生沿用第三轮（输入框 fail-closed、千问占位符算空；独立整页读取不依赖 `adapter.answer()`、双向按序、保留代码换行；思考判定排除元宝 `hyc-component-deep-search-agent` 外壳；不手动调 `generation()`/`generationProbe()`；不碰剪贴板；每个测量点记窗口状态）。审计用只读 `listQuestions` 核对本轮 20 条题目与报告清单一致（U3S 8 条 = 准备会话加 7 次尝试，U5A 1 条），没有重复题目；全程没遇到 `submit_unconfirmed`，没有任何重发。**流程违规**：U1 r1 与 U4 的 `env.TIER=null`，没有按要求显式传 tier（r1「fast」是按 workspace 状态推断的，原始文件没记）。**证据被覆盖**：u5a、u5b 各写过两次（12:57:46/12:59:01、13:01:37/13:02:14），第一次的输出丢失；只读 `listQuestions` 确认第一次 U5a 没有发出提问，第一次 U5b 做过什么已无从查证。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| **D4 豆包 local_ → `/chat/<id>` 迁移** | **通过**。9 次带埋点的成功迁移：U1 r1/r2/r3/r4b/r5、U3 准备会话、U3-F、U4、U6（U6 报告漏记）。序列一致：push `/chat/local_<n>`（换 key）→ 221–276 ms 后在 local_ 上以 semantic 绑定 → replace 到 `/chat/<id>`（同 key；U1 绑定后 1265–1653 ms，U6 九站负载下 4366 ms）→ 再过 79–238 ms 旧用户节点脱离、新旧节点互不包含 → 同一批升到 selector → complete 封存，`conversationUrl` 为正式 id；独立读页双向比对 missing 0、乱序 0、思考泄漏 0，副本无思考头和时间戳（页面独有的只是「今天 HH:MM」「已完成思考」、相关视频和推荐追问）。U1 封存比外壳 complete 晚 3056–3066 ms。U6 是唯一一轮在迁移前看到产品快照处于 local_ 上 owned semantic 的运行（`snaps[0]` 8261 ms）。窗口：r1 可见、r2 可见 think、r3 后台页 2、r4b 后台页 0 且 `focused:false`、前台为 `Idle:`（改正：报告只写后台页）、r5 被 WindowsTerminal 遮挡（polyZ=2）。 | `u1-doubao-*.json`、`*-compare.json`、`u1-summary.json`、`u3-*.json`、`u4-cancel-after-seal.json`、`u6-all9.json` |
| **Navigation API key 假定** | **证实**（改正计数）：按原始 `rt.navs`，replace 11/11 保持 `navigation.currentEntry.key`（U1 五轮、U3 准备、U3-C/D/F、U4、U6）；push 22/22 换 key（local_ push 16/16、侧栏点开旧会话 6/6）。报告写的「replace 8/8、push 13/13」与原始数据不符。traverse 未测。 | 同上各文件的 `rt.navs` |
| U1 r4 | 页面停在 local_，只有用户气泡，240 s 内没有回答也没有 replace；外壳 47.6 s 报 warning/`generation_unconfirmed`，副本一直 waiting；下一轮 newSession 后封存为 unavailable，没有误归属。原因只能说疑似站点侧（改正：报告断言「豆包站点自身卡死」，无网络或服务端证据）。r4b 为重跑。 | `u1-doubao-4*.json`、`u1-doubao-4-after-newsession.json` |
| U2 无埋点对照 | 通过：豆包新会话首问，页面只做一次发送前只读输入框检查，TIER=fast（`mode_only/fast`）；partial 6554 ms → complete，11 936 ms 封存（外壳 complete 后 3063 ms），事后比对干净。豆包 locate 计数 semantic=2 来自 r4 与 U6（改正：报告推断其中一次是 U2），U2 计在 selector。只覆盖可见场景，后台页与遮挡场景的结论都来自带埋点的运行（inst5 有 rAF、100 ms 定时器与自带 MutationObserver）。 | `u2-doubao-uninstrumented*.json`、`u6-all9.json` |
| U3 侧栏切到同文旧会话 | 通过：准备会话 U3S-k7m2p（think，长回答约 111 s，id 38445562019363330）。A（local_ 已绑定后 317 ms，非可信 click）、B（841 ms，CDP 可信点击）、E（313 ms）、G（`setTimeout 0`，22 ms）、C（replace 后实测 1589 ms，非可信）、D（replace 后实测 2817 ms，可信点击）共 6 次，侧栏导航都是 push 且换 key，副本最终 `owned:false/ended:true`、unavailable 封存、正文为空，没有采纳旧会话回答（改正：800 ms/1.5 s 是脚本 DELAY 参数，不是实测；C「先升到 selector」只来自 `historyTurn` 包装记录 7403 ms，没有 owned 产品快照，D 在 8137 ms 有 selector owned 快照）。F（在 `currententrychange` 回调里同步 click）豆包忽略了嵌套导航，成了正向对照：3926 字 complete，正式 id 是 F 自己的。「绑定之前切走」2 次都没打中（绑定与气泡渲染在同一任务）。结束副本的具体代码行没有插桩，按代码推断是 key 检查。 | `u3-*.json`、`u3-summary.json` |
| U4 取消 | **通过**（改正：报告判 partial、记 D-MED-2）。(a) DeepSeek 已封存 complete 后 13.9 s `polyask.cancel()`，保持 complete。(b) 同一时刻豆包 partial/generating、千问外壳 complete 未封存，取消后都继续采集到 complete 封存——与 docs/desktop.md 写明的设计一致（「取消仅终止尚在发送的站点监控和采集，已提交回答继续只读收尾」「`polyask:cancel` 只取消 sending 的站」），错的是测试矩阵预期，不是缺陷。(c) DeepSeek 流出问题 1 时向豆包发问题 2，broadcast2 发起后 318 ms 取消（改正：395 ms 是 broadcast 返回时间；豆包当时已是 fast，「需要切档」的前提很可能不成立）：豆包 cancelled、interrupted 封存，页面无残留、输入框空；DeepSeek 问题 1 不受影响。取消触发 `replaceView`，豆包视图重建为 wc11。**检测标红漏报**：`u4-cancel-after-seal-compare.json` 千问 `timeOrThinkingHeaderInCopy=true`，封存副本结尾是「森林火灾的成因与预防\n\n创建于 10-04 20:50」，疑似文档卡片标题与创建时间混入；整页读取也把它算进回答区，所以双向比对没标出来。待定性。 | `u4-cancel-after-seal*.json`、`u4c-cancel-during-sending.json` |
| U5a 重载看门期间群发 | 通过：CDP `Fetch` 暂停 DeepSeek Document 后 `reloadSite`，主进程只读包装 `sendCommand`；broadcast 发 DeepSeek 与千问：DeepSeek 共 20 次 submitPrompt，前 19 次 `not_ready`（5.56–14.67 s，约 500 ms 间隔），第 20 次 `load_failed`；旧文档 wc 收到的 `polyask:site-command` 为 0，上限后旧文档输入框空、tag 计数 0、`timeOrigin` 未变；千问「OK」complete。`Fetch.disable` 后重载 545–600 ms ready。看门期间旧文档无法求值（与第三轮相同），输入框空用的是 reload 前一刻读数。 | `u5a-broadcast-during-reload-watch.json` |
| U5b 历史恢复挂起门禁 | 通过：Document 暂停时 `previewQuestion` + `restoreQuestion(confirmed)`；挂起期间 `siteHistoryState` back/forward 均 false，两种 `reloadSite` 与 `clearSiteData` 返回 false，`stepHistory(±1)` 无导航事件、index 保持 4；15 020 ms restore 返回 `timeout`，之后 phase 停在 loading（docs/desktop.md 写明只 `stop()`、不钉 `load_failed`），恢复后 ready。restore 把 surface 切到 question-history，已 `setSurface('sites')` 还原。超时后 loading 期间 `sendCommand` 不拦、群发会进旧文档是已列明的残余，未实发验证。 | `u5b-restore-gate.json` |
| U5c 阳性对照 | 通过：无挂起导航时 `stepHistory(-1)` 走 did-start-navigation → did-navigate → did-finish-load，index 4→3，3 ms 后 ready；`stepHistory(+1)` 回到 index 4。 | `u5b-restore-gate.json` |
| U6 九站 | **受阻**（Claude）：TIER=fast，Kimi `mode_only/fast`（基线 null）、千问 `preferred/fast`。Claude newSession 主帧 10 s 未提交 → `not_ready` → abandon 钉 `load_failed`，broadcast 对 Claude 返回 `load_failed`，没有进入提交，拿不到 `submit_unconfirmed` 时序；之后两次 `reloadSite`（含清缓存）都约 15.3 s `load_failed`。页内只读 `fetch('/new')` 8 次相互独立的 12 s 超时 abort，时间跨度 13:06:11–13:16:10（约 10 分钟，改正：报告写「13:03 起连续 12 分钟以上」）；`/favicon.ico` 200（288 ms），无 Service Worker。没有从 PolyAsk 以外的客户端或同一代理请求 claude.ai/new 作对照，「外部挂起」未证实。Claude 页面 `timeOrigin` 等于 TestLab 启动时刻，U6 的 newSession 是本轮第一次导航，Claude 本轮从未成功导航过。其余 8 站 submitted/complete 封存，missing 0、乱序 0；**检测标红漏报**：Kimi `thinkLeak=2` 大概率误报（思考文本原样引用了答案中的两行代码，思考叙述未进副本）；千问 `codeEqual=false` 是读页器问题（整页读取的 `pre` 带行号槽，如「1vegetables = …」），副本正确。 | `u6-all9*.json`、`claude-recover-*.json`、`claude-probe-*.json`、`claude-wait-log.json` |

**新发现缺陷**
- **智谱无语言代码块（medium）**：`code-no-artifacts` 块的 `p.language` 为空，头部只有「复制」，`md.js` 没当代码头剔除，副本写成「复制  ```」，围栏不在行首、Markdown 渲染错乱。`u6-all9.json` 副本结尾「输出结果：\n\n复制  ```\n推荐蔬菜： 西红柿、胡萝卜、菠菜\n```」，比对 `unclosed=true`、`codeEqual=false`；带语言名的 python 块正常。DOM 结构（`div.top > p.language` 空 + `div.copy-button > span`「复制」）只打印到 stdout、没存 JSON，根因（语言头判定要求先出现语言词）是代码推断。
- **豆包思考阶段 partial 副本是思考标题（low）**：think 档 selector 级回答根在思考阶段只有步骤标题，inst5 快照 7–70 s 间 len 4–22、tail 为「正在思考」「规划说明结构」等，U3-F capture partial len=12 已写库。最终封存不含这些；思考阶段被中断时 interrupted 副本会是思考标题。
- **豆包停在 local_ 时 `conversationUrl` 记临时地址（low）**：r4 封存 unavailable，url=`/chat/local_2112916723088784`，「打开原站会话」指向无效地址。
- **绑定之前切到同文旧会话（low，理论残余，未命中）**：见 docs/adapters.md「local_ 阶段的归属守卫与一次性迁移」的真机状态段。

**收尾**：通过。主进程与外壳无 `__rt*` 残留，`sendCommand`/`wc.send` 自有属性已删且与原函数一致，9 页隔离世界与主世界无 `__RT`/`__U3`，`polyask:site-response` 监听为 2（同 U0）；与 U0 的监听差异只有 `win:closed` 8→7（第三轮同样出现，原因见上节收尾，属 `resource-trace.ts` 按设计注销；本轮未单独复核）与 wc6→wc11（U4c 取消重建豆包视图，监听集合逐项相同）。审计独立复核与 `final-check.json` 零差异；Windows Temp 的 `pa-retest-win.ps1` 已删；Fetch 已 disable，surface 为 sites，第 2 页布局恢复，输入框全空。与 U0 不同的残留：Claude 仍 `load_failed`（本轮不允许重启）；各站档位被 U6 设为 fast（Kimi null→fast）；豆包为 wc11。窗口结束时 polyZ=3，其上为 GameViewer、msrdc 窗口「Pinboard Bookmark Enhanced - Settings - Google Chrome for Testing」（WSLg 下 Linux 侧窗口；改正：报告写「Notes & Vocabulary」）、WindowsTerminal；报告关于「远程应用自己弹出」「用户 12:35 自己激活终端」的说法无原始证据。U4 runner 回退逻辑曾误把 PolyAsk 置顶，已放回终端之下并修正。

### 仍未证明
- D4：replace 与新节点出现之间的挂起态（未 stopped、未 owned），79–238 ms 内无观测样本；rebase 阴性分支（超 10 s、文本不同、userCount≠1、锚点定位、key 缺失 fail-closed、清空非空旧回答根）真机未触发，宜改由 `desktop/scripts` 的 DOM 回放覆盖；豆包 traverse 是否换 key、是否被拦；绑定之前切到同文旧会话的窗口。
- r4 豆包卡住、Claude 文档挂起的原因；Claude 提交行为与 `submit_unconfirmed` 时序（需重启 TestLab 后先做外部对照再重跑）。
- 千问 U4 副本结尾「创建于 …」是页面外壳元素还是回答内容；智谱无语言代码块的 DOM 证据。
- 比对脚本待修：Kimi `thinkLeak` 排除思考文本中引用的答案代码行；千问比较前剥掉 `pre` 行号槽。
- `POLYASK_KIMI_RESUBMIT` 仍 false，F067 两条真机硬用例未做。

## 2026-10-05 Windows TestLab 第五轮复验（迟到确认、F1–F5）

**构建与部署**：预置包已过期——重新生成的工作区归档哈希为 `770920d6004a`（预置时为 `ba1d375999ec`），差异是预置后新增的千问长文卡片修复（「在对话中输出」按钮剔除、只有卡片时保留标题；新卷 `desktop/src/site-runtime/md-head.js`，110 行，已在 `preload/site.ts` 与 `PRELOAD_CHAIN` 登记）。按流程重建（清 asar → `npm run package` → `asar extract` → 换 `worktree.patch`），重建后复算仍为 `770920d6004a`；asar 内无 `*oauth*` 文件、无 `googleusercontent.com`/`GOCSPX`。部署前只读确认无残留 TestLab 进程、9224 不响应（curl exit 7）。旧 `.webpack` 与 `manifest.json` 备份到 TestLab 目录 `backup-20261005-003419`；manifest 只改 `sourceCommit`=`ed87c618…+worktree-770920d6004a`、`testMainSha256`=`7b857379…2239`；`diff -rq` 无差异，`electron.exe` sha256 仍等于 `runtimeSha256`，`guard-test.cjs` 7 项通过；profile、logs、启动器、`Roaming\PolyAsk` 未动。`Launch-Test.ps1` 打印 PID 29068（被 `timeout 60` 截断、退出码 124，与以往一致），9224 响应、Electron 44.5.0，启动日志 `stdout-20261005-003451-199.log` 的 `isolated-test-startup` 带新 sourceCommit；只读检查九站页面都没有可见的登录/注册按钮。**部署时这一版没有门禁绿灯**（部署报告承认未跑 `npm test`/`verify.sh`），门禁结果见本节末。

**执行**：本节此前记过一次未执行的尝试（测试方不确定重启后的实例能否使用）；用户确认 PID 29068 可以继续测试、发送不限额后，在同一实例上跑完 V0–V6。没有关闭或重启进程，没有碰剪贴板与 `Roaming\PolyAsk`，没有读凭据。脚本与 JSON 在会话临时目录 `windows-retest5/`（`_index.log` 记写入顺序），只读审计在 `audit5/`，均不入库。下文已按审计改正测试报告。共发出 12 条中性提问（均带「PolyAsk」与唯一标签）：Claude 3 条（V2 tier null；V1-a think + 页面延迟 5000 ms；V1-d think + Fetch 扣住 PerformAction 6 s）、智谱 2、千问 1、豆包 2（think）、UI 群发 3 轮（tier null，「跟随站点」）。另有两次没发出：V1-b 群发时 Claude `load_failed`、产品未派发；V1-c 输入框未就绪，fail-closed，没到 broadcast。全程没有自动重发、没有点重试。**证据卫生**：v3 两份 compare 被同名覆盖过（01:55:58 与 01:56:18 各写一次），修正前的比对原件丢失，现存的是比对器修正后的结果；`/api/__polyask_probe_nonexistent` 报告称探测两次均 404，只落盘一份（`claude-subresource-probe-6.json`），01:45 那次没存 JSON；`cur-tracked.patch` 与 `cur-tracked-nobin.patch` 内容相同（都排除了 docs/verify.md），文件名有误导。均不影响 V0 结论。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| V0 构建核对与基线 | **通过**（审计独立复核）。部署的 `app/.webpack/main/index.js` sha256 = manifest `testMainSha256`；`testlab-stage5/asar/.webpack` 与 `app/.webpack` `diff -rq` 一致；manifest 与启动日志的 sourceCommit 都是 `ed87c618…+worktree-770920d6004a`。staged `worktree.patch` 去掉 docs/verify.md 段后与当前工作区 tracked diff 逐字节相同，20 个 untracked 文件逐字节相同；部署后只有 docs/verify.md 改过（mtime 00:40 晚于 00:34 部署）。九站 `__AMS.mdHead` 为 object、`readCommand` 为 function。基线：总览第 0 页、tier null、九站全选且 ready；Claude 在 `/new`、档位 think，其余站 fast；窗口最大化、未聚焦、polyZ=3、未锁屏；监听普查写入基线文件供收尾对比。 | `v0-baseline.json`、`v0-build.json`、`staged-noverify.patch`、`cur-tracked-nobin.patch`、`cur-untracked.txt` |
| V1 迟到确认（Claude） | **部分通过**。**V1-d**（think，选择结果 `mode_only`）：begin 1.49 s → 4.836 s 回包 `submit_unconfirmed`（submission unconfirmed）→ Claude 29.78 s 才发出 PerformAction、29.79 s 路由 `/new`→`/chat/…` → 页内首个 `owned`+`locate=selector` 快照（页内相对 32 592 ms，按两时钟原点差 2307 ms 换算为 30 285 ms）→ 3 ms 后外壳 phase=submitted、`submission.state=sent`、ev=message、sel=mode_only，与 `submission-upgrade.ts` 的输出形状和 `question-history-service.ts` 的 selector/semantic 判据一致 → 36.69 s generating（`watchGeneration` 已接上）→ 62.23 s complete → 65.30 s 封存 complete，105 字与页面一致。**只提交一次**：页内 submitPrompt 只进入 1 次，网络日志 120 条里 PerformAction POST 1 次，带标签的用户消息最多 1 条，unconfirmed 之后没有第二次 sending，封存 attempt=1。**升级依据是 DOM，不是服务端确认**：升级时 PerformAction 还被 Fetch 扣着（35.725 s 放行、36.414 s 回包），「已发送」凭乐观气泡的归属快照判定，比请求到达服务器早约 5.4 s；与正常路径同一判据，属设计行为。**迟到原因改正**：报告称「刚 newSession 的 `/new` 页要先自举约 28 s」，与 V2（newSession 311 ms，1.0 s 即 submitted）、V1-a（641 ms，2.4 s）矛盾。V1-d 跑在 D2 发作后的恢复期，是一次整页冷加载（newSession 5878 ms，先 loading 约 9 s 再 ready），同期 API 普遍很慢（marketplaces 9.8 s、mcp toolbox 2.2–5.5 s、rum 10.4 s，之后同类请求 0.4–0.7 s）；只能写成「站点或网络在该时段降级，加上冷加载」，因果未证明，也不能当可复现的造迟到手段。**V1-a**（页面延迟 5000 ms）2.4 s 就 submitted(message)：Claude 用户气泡乐观渲染，两个 worker 拒绝 `emulateNetworkConditions`（Not supported）、没有 Fetch 域，浏览器级 Fetch 拦不到页面请求；该次网络日志有 **2 次** PerformAction POST（相对 1606/1876 ms，都完成），而用户消息 1 条、begins 1 次，不构成重复提交证据，但「一次发送对应一次 PerformAction」不能当通用判据，两次的 action 类型未解析。未测：`tier_unconfirmed` 在升级后保留（选择结果是 `mode_only`）；渲染层重试入口消失（直连 IPC 走不到渲染层，UI 群发时 Claude 一直 `load_failed`）。限速与拦截已还原：V1-a 的 5000 ms 在气泡出现时（2640 ms）显式复位；V1-d Fetch 只扣 1 个请求，finally 里 `Fetch.disable`、`setAutoAttach false`、`Network.disable` 均 ok，CDP 已关（网络模拟无法回读，「已还原」依据的是显式复位返回 ok 加会话关闭）。 | `v1-summary.json`、`v1-claude-fetchhold-d.json`（+compare）、`v1-claude-latency5000-a.json`、`v1-claude-fetchhold-b.json`、`v1-capprobe*.json`、`v1-aaprobe.json`、`v1-bfprobe*.json` |
| V2 Claude 无限速 | **通过**：tier null、新会话；路由替换 0.47 s，1.025 s submitted(message)，没有 unconfirmed；2.9 s generating，30.24 s complete，33.3 s 封存 complete，95 字副本与页面一致，missing 0（页面独有的只是「just now」和思考摘要一行）。只开被动 Network 日志。 | `v2-claude-natural.json`（+compare） |
| V3 智谱代码块 | **通过**：无语言代码块的副本是不带语言的 ```` ``` ```` 围栏、不含「复制」（页面头部条只有「复制」）；python 块围栏为 ```` ```python ````，两行与页面逐字相同，头部条「python / 复制」未混入。两条都 complete 封存，missing 0。比对器修正后代码行不再走 `stripMd`（它曾吃掉 `**`）。 | `v3-zhipu-nolang*`、`v3-zhipu-python*`（含 `-dom`） |
| V4 千问长文写作卡 | **通过**：回答末尾确有写作卡 `card-container-wide`（`data-card-highlight-target=true`，文字「森林火灾的成因与预防 / 创建于 10-05 09:56」），这是第一次在真机上直接看到外壳 DOM，与 docs/adapters.md 按前端包推定的结构一致。副本 2019 字，以「…守护绿水青山和生态安全。」结尾；标题在副本里只出现一次（开头的 `###` 标题），没有作为尾部卡片重复；「创建于 10-05 09:56」只在 pageNotInCopy 里。本轮没出现「在对话中输出」按钮，也没触发只有卡片的分支。 | `v4-qianwen-card*.json`（含 `-dom`） |
| V5 豆包 think 档 | **通过**：V5a（选择结果 `mode_only`）在 6.757 s 页面只有思考块（「正在思考 / 明确过河问题规则」）、正文长度 0 时用产品 newSession 打断，封存为 unavailable、md 为 null，打断前的中间副本 md 为空，不是思考标题。V5b think 首问 complete，与页面一致，「已完成思考」只在 pageNotInCopy 里。缺负向对照：修复前同一流程会不会把思考标题存成副本，本轮没复现，只能说结果符合修复预期。判定只读 DOM，未调用 `generation()`。 | `v5a-doubao-think-interrupt.json`、`v5b-doubao-think-full.json`（+compare） |
| V6 九站 UI 群发 | **部分通过**（tier null，三轮都在 Windows 锁屏期间运行，锁屏不是测试方触发的）。**V6c**（豆包弹窗已关）：ChatGPT、Gemini、DeepSeek、豆包、千问、Kimi、元宝、智谱 complete 封存，sealEqFinal 为 true，missing 0，outOfOrder 0，codeEqual 为 true，无思考泄漏与「复制」；千问 DOM 行号 gutter 已剔除（gutterNodes=2）且代码相同。**V6（02:01）、V6b（02:07）**：豆包页面开着「下载电脑版」推广弹窗，豆包副本 unavailable（见 D1）。改正：报告写「页面上回答完整」，但这两轮独立有序读取结果是 nodes/lines/pageLines 全 0，用修正后的读取器重读（`v6-doubao-postmortem-read-fixedreader.json`）仍是 0 行，双向比对实际没执行（missing 0 是空对空）；只能说「页面上有回答（全页散抓到 3 个列表项、1 个代码块和标题），有序比对没执行」。独立读取器在 MAIN 被设为 `aria-hidden` 时同样是盲的。V6 智谱 missing 1 是比对器误判（回答标题含标签）。Claude 三轮都 `load_failed`、begins 为 []，没有派发（D2）。 | `v6-all9-ui.json`（+compare、compare-r2）、`v6b-all9-ui-dbmodal.json`（+compare）、`v6c-all9-ui-nomodal.json`（+compare）、`doubao-*.json` |

**缺陷**
- **D1 豆包推广弹窗下首问副本丢失（medium，未修）**：站点开着 Radix 模态（「下载电脑版」）时，Radix `hideOthers` 给 MAIN 加 `aria-hidden=true` 与 `data-aria-hidden`。local_ 阶段的乐观气泡没有 `data-message-id`，第 ① 级 `[data-message-id]` 命不中；第 ② 级 `[data-testid=send_message][data-message-role=user]` 被 `history-locate.js` 的 HARD 选择器（含 `[aria-hidden="true"]`）排除；豆包在 VIRTUAL 里，第 ③ 级锚点禁用。v6 轨迹：1.85–5.69 s 在 `/chat/local_…` 上 uc:0 共 102 次，6.58 s replace 到正式 id，快照两条（4419 ms 未归属、未结束；6766 ms 未归属、ended），封存 unavailable。改正：报告称 rebase 失败是因为「`e.localId` 为空」，没有直接证据——`history.js` 处在 local_ 路由就会设 `localId`；`history-route.js` 的 `rebase()` 失败更可能是 `e.user` 为空（local_ 上始终没绑定）。这是 fail-closed，没有取错内容，但用户拿不到副本。`doubao-user-exclusion-check-v6b.json`：用户节点存在（users:1），祖先 MAIN 带 `aria-hidden=true` 与 `data-aria-hidden`；点「下次提醒我」关闭弹窗后 mainHidden 由 true 变 false（之前试过一次 Escape 无效），V6c 同状态下豆包 complete。因果只有「有弹窗 2/2 失败、关闭后 1/1 成功」的小样本，且都在锁屏期间，没有 jsdom 回放复现。
- **D2 Claude 视图 HTML 文档请求挂起（low，根因未定）**：newSession 导航 `/new`、reloadSite 导航 `/chat/…`、页内 `fetch('/new')` 都挂起，10–15 s 后被产品 `stop()`（Document 请求 ERR_ABORTED canceled），同页 `/api/*` 0.7 s 返回，无 Service Worker。产品行为正确：newSession 回 `not_ready`、群发回 `load_failed`、不派发。改正时间线：报告写「从 02:00:48 起」，最早一次发作在 01:49:33（V1-b 的 newSession 10 025 ms 回 `not_ready`，01:50:12 仍 `load_failed`），01:50:32 曾恢复（799 ms ready），之后复发，属间歇性；首次发作时未锁屏，锁屏不是诱因。对照无效：PowerShell `Invoke-WebRequest claude.ai/new` 0.7–0.8 s 返回 403，客户端不是浏览器、被边缘拒绝、代理与 Cookie 都不同，只能说明边缘节点可达，不能支持「不经 PolyAsk 的请求不挂起」。另：01:43:51 `capprobe-3` 对两个 Claude worker 的 Network/Fetch 命令全部超时后 detach，6 分钟后 D2 首次发作，没有对照能排除测试器 CDP 探测的影响。第四轮 U6 已出现同样现象。
- **D3 测试器自身问题（已修正，不是产品缺陷）**：① 千问代码块 `pre` 带行号 gutter（DOM 剔除加 1..n 前缀兜底）——V6c 实际触发（gutterNodes=2、codeEqual=true），已验证；② Kimi 思考段引用答案代码被误报为泄漏、③ 元宝外层包装被当成思考——本轮样本都没触发（Kimi thinkLeakIgnoredAsAnswerQuote 三轮均 0，元宝 pageThinkCls 均空），**未验证**；④ 页面读取遇到输入框祖先里的空白文本节点提前停止（豆包）；⑤ `stripMd` 吃掉代码行里的 `**`；⑥ 代码块比对改为有序子序列，允许智谱运行结果的 `pre`；⑦ 防 JSON 重名覆盖（加在 v3 被覆盖之后）。

**收尾**：通过（审计只读复核）。监听与 V0 基线、与 `final-check.json` 的 diff 都为空；main、外壳无 `__rt/__RT/__U3/__pwt` 全局，九页隔离世界与主世界无 `__rt/__RT/__U3/__inst/__pa` 键；九视图 `backgroundThrottling` 均 false 且可见；总览第 0 页、tier null、九站全选；窗口最大化；各站档位与 V0 相同（豆包本已 fast，`runMode('fast')` 是空操作）；页内钩子每轮卸载（V5a 页面已导航，记为 lost）；网络模拟与 Fetch 已撤、CDP 会话已关。与 V0 不同的残留：Claude 停在 `/chat/4e83…` 且 `load_failed`（D2，newSession 与 reloadSite 都恢复不了，按要求未重启）；豆包推广弹窗被点「下次提醒我」关闭；Windows 锁屏（02:00:01–02:00:47 进入，非测试方所为）至今未解。Windows Temp 的 `pa-retest-win.ps1` 只用了 state 操作，留在原处。

**本节写入时的本地门禁**：当前工作区（tracked diff 除 docs/verify.md 外与部署的 `worktree.patch` 一致，审计已核）`cd desktop && npm test` 通过（870 + 366，0 失败，tsc 无错），补上了部署时缺的门禁；`bash scripts/verify.sh` 全部通过。

### 仍未证明
- V1 渲染层：迟到确认后 `BroadcastRun` 重试入口消失、`lateSentResult` 阻止同 runId 重试再派发——无真机证据；`tier_unconfirmed` 升级后保留只有单元测试。补测需等 claude.ai 文档请求恢复，先找能复现迟到的条件（记录 newSession 耗时、是否整页冷加载），至少 3 次，不依赖「刚 newSession 约 28 s」。
- V1-d 迟到约 28 s 的根因（前端自举还是时段性网络/边缘降级）；V1-a 两次 PerformAction 的 action 类型（只读解析类型字段，不取内容）。
- D1：修复方向（带 `data-aria-hidden` 标记的 Radix `aria-hidden` 不视为 HARD 排除，或豆包 local_ 阶段放行第 ② 级）待定；需先补 jsdom 回放（MAIN 带 `aria-hidden`+`data-aria-hidden`、乐观气泡无 `data-message-id`），修复后在弹窗场景复测至少 3 次、并在未锁屏时再测一组；测试器 `page-read.js` 也要识别 `data-aria-hidden`，否则独立比对在该场景是盲的。V6/V6b 豆包回答的完整性与顺序无法确认。
- D2 根因：需用 Electron 同一 session 的 `net.request` 或同代理下的浏览器做等价对照，判断是否只针对 HTML 路由；测试器 CDP 探测的影响未排除。
- 千问「在对话中输出」按钮剔除、只有卡片时保留标题：没有真机样本。
- 测试器修正 ②（Kimi 思考段引用代码）③（元宝外层包装）未被样本触发。
- 九站回归中 Claude 一格（第四、五轮都被 D2 挡住）。
- 第四轮「仍未证明」中豆包 rebase 阴性分支、挂起态、traverse 等照旧未关闭。
- `POLYASK_KIMI_RESUBMIT` 仍 false，F067 两条真机硬用例未做。

## 2026-10-05 Windows TestLab D1 复验（豆包弹窗）

**构建与部署**：当前工作区（HEAD `ed87c61` + 未提交改动，含 D1 修复与迟到升级）的 `worktree.patch`（509 915 字节）sha256 前 12 位 `a8e6a7cc1b9b`；`npm run package` 成功，asar 内无 `*oauth*` 文件、无 `googleusercontent.com`/`GOCSPX`；xvfb 冒烟 shell=1、sites=9、attached=9。部署前只读确认无 TestLab `runtime\electron.exe` 进程、9224 不响应（curl exit 7），没有结束任何进程。旧 `.webpack` 与 `manifest.json` 备份到 TestLab 目录 `backup-20261005-130115`；manifest 只改 `sourceCommit`=`ed87c618…+worktree-a8e6a7cc1b9b`，`testMainSha256` 重算后仍为 `7b857379…2239`（`main/index.js` 与上一版逐字节相同，唯一变化的文件是 `renderer/site_window/preload.js`，即站点运行时）。`diff -rq` 新构建对部署目录为空，`electron.exe` sha256 仍等于 `runtimeSha256`，`guard-test` 7 项通过；profile、logs、启动器、`Roaming\PolyAsk` 未动。`Launch-Test.ps1` 报 PID 25908，9224 响应（Electron 44.5.0、PolyAskTestLab/1.11.2），启动日志 `stdout-20261005-130158-511.log` 的 `isolated-test-startup` 带新 sourceCommit；只读检查九站页面都没有可见的登录/注册按钮。审计独立重算工作区哈希仍为 `a8e6a7cc1b9b`，部署的 `preload.js` 含 `[aria-hidden="true"]:not([data-aria-hidden])`（1 处）。

**执行**：用户要求部署后做 D1 复测、Claude 补测与九站回归，发送不限额。脚本与 JSON 在会话临时目录 `windows-retest6/`（`_index.log` 记写入顺序，`summary.json` 汇总），只读审计在 `audit6/`，均不入库；下文已按审计改正测试报告。提问均为中性内容、带「PolyAsk」与唯一标签：W2 实验 3 条（`W2A-sg4y4` 彩虹；`W2B-si986`、`W2C-sj87c` 水果）、对照 2 条（`W2CTLA-skrzp` 天空、`W2CTLB-slyvg` 月亮），API 群发 tier fast；W3 Claude 1 条（`W3CL-sw4jx`，UI tier fast，确定失败、未发出）；W4 九站 UI 群发 1 轮（`W4ALL-sxwvp`，tier null，界面「跟随站点*」）与 ChatGPT 单站补发 1 条（`W4GPT-t14gs`，tier null）。全程没有自动重发、没有点重试，Windows 未锁屏（各轮 sum 与 `final-check.json` 的 locked=false，审计 05:43 只读复查 locked=False 补证；`final-check-2.json` 无 locked 字段）。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| W0 构建核对与基线 | **通过**。manifest `testMainSha256` 等于部署的 `main/index.js`；`worktree.patch` 与当前工作区哈希一致；staging 与 `app/.webpack` `diff -rq` 为空。基线：九站 ready/fast，九站全选、tier null，总览第 0 页，窗口最大化但被 Windows Terminal 遮挡（polyZ=2），未锁屏。页内无法直接读到闭包里的 `HIDDEN` 常量（`hiddenInRuntime=false` 是探针局限），行为由 W2 证实。 | `w0-build.json`、`v0-baseline.json` |
| W1 真实弹窗首问 | **未执行（n/a）**：每次豆包测试前检查真实弹窗（w1-pre、w2a/b/c-pre、ctl1-pre、w4-pre、recheck-c），MAIN 均无 `aria-hidden`/`data-aria-hidden`，dialogs 为空，无「下载电脑版」，`[data-aria-hidden]` 计数 0；本次会话弹窗没有出现。w2ctl2 没有单独的 pre 文件，但 `mainAttr:set` 的前置条件（ah/dah 必须为 null，否则中止）等效覆盖。 | `doubao-modal-check-*.json` |
| W2 模拟标记（只标 MAIN） | **通过（限定：只覆盖「MAIN 被标记」这一种形态）**。实验组同一 MAIN 上同时设 `aria-hidden=true` 与 `data-aria-hidden`，3/3 submitted/complete/sealed，`copyAtSealEqualsFinal`=true，missing、outOfOrder、thinkLeak 均为空，封存比外壳 complete 晚 3066–3070 ms；pageNotInCopy 只有「今天 13:xx」与 3 条推荐追问。路由均为 `/chat/` → `/chat/local_…` → `/chat/<id>`；3 次在 local_ 阶段都有 historyTurn `semantic uc1 teq=true`（修复路径被走到），w2a 在 local_ 上已有归属的 semantic 快照、到正式 id 后转 selector，w2b/w2c 首个快照出现在正式 id 上（selector）。对照组只设 `aria-hidden=true`，2/2 submitted/unavailable，6891 ms、7280 ms 封存，副本为空，local_ 阶段 uc0、到正式 id 后 selector 虽找到 uc1 仍 unavailable，与第 5 轮真实弹窗的失败形态一致（当时用户节点 hardAncestor=`MAIN[aria-hidden=true][data-aria-hidden]`）。变量控制：5 次 `mainAttr:set` 前置都是 ah/dah=null，设后 dah 组 true/true、ahonly 组 true/null；`mainAttrTL` 全程 same=true（同一 MAIN 未被 React 替换）；restore 后 ah/dah=null，`doubao-modal-check-post-w2.json` dahCount=0。比对独立：`run.mjs` 先 `mainAttr:restore` 再读 pageFinal，页面读取不依赖与修复相同的 SKIP 规则。**与对照并非只差标记**：提示词不同（彩虹/水果 vs 天空/月亮）、WAIT_MAX 不同（240 000 vs 150 000 ms）、对照组在 3 次实验之后连续跑而非交错、样本 3 对 2。另外 `mainAttrTL` 用外壳时钟、turns/routeSeq 用站点钩子时钟，不能逐点对齐（如 w2c 的 local_ 分别记在 2738 ms 与 3841 ms），「绑定发生在属性存在期间」只能凭同一节点、key 未变推断。 | `w2a\|w2b\|w2c-doubao-dah{,-compare,-sum}.json`、`w2ctl1\|w2ctl2-doubao-ahonly{,-compare,-sum}.json`、`doubao-modal-check-post-w2.json` |
| W3 Claude 补测 | **阻塞**。newSession 打开 `/new` 时文档请求 10 033–10 040 ms 被产品 `stop()`（ERR_ABORTED），状态 failed/`load_failed`，共 3 次（net-a、net-b、recover-claude）。页内带 Cookie 的 `fetch('/new')` 90 s 与 25 s×2 无响应；不带 Cookie 200 text/html（3725 ms、590 ms）；带 Cookie 的 robots.txt 0.26 s 200、API 0.3 s 404。主进程源码无 `webRequest`/`onBeforeSendHeaders`/`protocol.handle`。随后 Claude 单站 UI 群发（tier fast，「快速*」，「发送至 1 个站点」）578 ms 确定失败：sending → failed/`load_failed`，begins 为空、未提交、无 `submit_unconfirmed`；出现重试入口未点，输入框 36 字由测试方清空。取消再重选 Claude 重建视图（wc27）后首次加载同样挂起，至审计 05:43 仍 loading（约 12.5 分钟）。迟到升级路径本轮没有观察机会。 | `w3-claude-newsession-net-a\|b.json`、`w3-claude-fetch-new-90s.json`、`w3-claude-fetch-matrix{,-b}.json`、`w3-claude-fetch-new-include-b\|c.json`、`w3-claude-ui-fast.json`、`recover-claude-1.json`、`claude-view-recreate-1.json`、`claude-after-recreate-check.json` |
| W4 九站回归 | **部分通过：单次九站 UI 群发 7/9；ChatGPT 单站补发通过；Claude 未覆盖**。Gemini、DeepSeek、豆包、千问、Kimi、元宝、智谱 submitted/complete/sealed，sealEqFinal=true，missing 0、outOfOrder 0，codeEqual=true（python 两行），thinkLeak 0，封存比外壳 complete 晚 3028–3078 ms；pageNotInCopy 只有页面附属文字（「Gemini said」、语言标签、推荐追问、页脚），Kimi 思考文本只在 pageNotInCopy、未进副本。Claude 与 ChatGPT 群发前 newSession 就回 `not_ready`（文档请求超过 10 s），状态 failed/`load_failed`，群发给出确定失败而非 `submit_unconfirmed`。同时段 ChatGPT 带 Cookie 的 `/` 13 075 ms、robots.txt 7993 ms 才返回，Gemini `/app` 5.8 s。ChatGPT 之后 newSession 1.8 s 恢复 ready，另起一次单站 UI 群发（05:23:44 `setSelection` 只选 chatgpt）complete/sealed，与页面一致，codeEqual=true。比对用独立的 `page-read.js`（已修正为把带 `data-aria-hidden` 的 `aria-hidden` 视为可见），不经 `adapter.answer()`，双向有序。 | `w4-all9-ui{,-compare}.json`、`w4b-chatgpt-ui{,-compare}.json`、`w4-chatgpt-fetch-matrix.json`、`w4-gemini-fetch-control.json`、`recover-chatgpt-1.json` |

**观察与缺陷**
- **OBS-1 新视图首屏挂起时无限期 loading（low，既有行为）**：`view-manager.ts` 的 `createView` 只有 onLoading/onReady/onFailure，没有首屏加载上限；只有 `historyAccess` 的 abandon 在 `NEW_SESSION_COMMIT_CAP_MS` 后把站点钉成 `load_failed`。wc27 重建后一直 loading、URL 为空，用户看不到重载入口。不影响群发安全（对该站给出确定结果）。**已在代码中修复**：视图首次加载（启动、重选后重建、`replaceView`）经 `SiteHistoryAccess.initialLoad` 挂上与重载相同的 20s 看门（`view-manager.ts` 在 `loadURL` 前调用）。第 7 轮真机：卡住 DeepSeek 重建视图的首个文档请求，20023/20015ms 收口为 failed/`load_failed`，重载即恢复。
- **OBS-2 `NEW_SESSION_COMMIT_CAP_MS`=10 s 低于实测（产品侧观察，既有行为）**：`workspace-service.ts:29`。本轮 ChatGPT 带 Cookie 的 HTML 首字节约 13 s，Claude 第 5、6 两轮都在 10 s 被 abort；上限贴着甚至低于实测值，与「阈值留 ≥20% 余量」相抵。结果是确定失败、不是 `submit_unconfirmed`，不影响「提交不确定 ≠ 可以重发」，但 W4 中 ChatGPT 的失败不能只归为环境。**已在代码中修复**：`NEW_SESSION_COMMIT_CAP_MS`、`RELOAD_COMMIT_CAP_MS`、`RESTORE_SITE_CAP_MS` 统一为 20s（对 13s 约 1.5 倍）。第 7 轮真机证明新会话与重载到 20s 收口；「慢但能落地的页面不会被误杀」还没有正向对照，`RESTORE_SITE_CAP_MS` 也没测到。
- **ENV-1 claude.ai 带 Cookie 的 HTML 请求挂起（medium，原因未定）**：只有「带 Cookie 的 HTML」挂起，指向服务端、账号或 Cookie 状态；PolyAsk 主进程没有拦截。但同时段整体网络偏慢（见 W4 ChatGPT 数据），TestLab profile 自身的 Cookie 状态未排除，也没有拿普通浏览器同一账号做对照，不能写成「与 PolyAsk 无关」。第 5 轮 D2 是同一现象。

**收尾**：部分还原（审计 05:43 只读复查，`audit6/ro-check-audit6.json`）。main、外壳无 `__rt`/`__RT` 全局，8 个页面 `__RT`、`__U3` 均 false、档位 fast；MAIN 两个属性已移除；九站全选、tier null；外壳输入框 0 字；总览第 0 页、focused=claude（测试中改为 chatgpt 后改回）；8 个视图 `backgroundThrottling` false 且可见。与基线不同的残留：测试方三次用 `setSelection` 缩小工作区做单站补测，产品按设计销毁未选中的视图、重选时重建，其余 8 站被重建 1–2 次（webContents 编号由 2–10 变为 11、20–26），重建后停在首页或新会话页；「8 站监听零差异」比的是新视图与旧视图的计数，原视图上的钩子是随视图销毁消失的，不是逐一验证卸载。Claude 为 loading 中的空白视图 wc27（基线是已加载的 `/new`），其监听集合多于基线（did-start-navigation 3 vs 2、did-fail-load 2 vs 1、destroyed 2 vs 1）；全局 `win:closed` 8→7，原因未查明。chatgpt 状态由基线 ready 变为 complete；各次提问记录（含 W3 那条确定失败）留在 TestLab 历史里。没有关闭或重启 TestLab、没有碰剪贴板与 `Roaming\PolyAsk`、没有读凭据。

### 仍未证明
- **D1 真实弹窗端到端**：W1 没跑。第 5 轮真实弹窗里 Radix 同时标记了 3 个节点（`DIV.shrink-0 bg-inherit`、`DIV.flex flex-col`、`MAIN`），页面上还有 `role=dialog` 遮罩和一个 state=open 的 `role=menu`；W2 只标 MAIN、没有遮罩。本轮只证明「当前失败路径的根因（HARD/CONTROLS 把带标记的 MAIN 当隐藏子树）已修」。补测：真实弹窗出现时不关弹窗跑 3 次（`SITES=doubao NEW=1 TIER=fast`、不设 `MAIN_ATTR`），记录 hiddenTop 列表、同时带两个属性的节点、用户消息与回答的祖先链；另把 W2 加强为三节点标记加 dialog 遮罩，实验与对照交错、同提示词、同 WAIT_MAX，每组至少 3 次。
- **放宽规则的副作用**：若 `aria-hidden` 包的 `hideOthers` 对原本就 `aria-hidden` 的节点也打 `data-aria-hidden`（本轮未核实，本地 `node_modules` 无该包），弹窗期间站点本来隐藏的兄弟节点会被当成可见，可能造成同文多处或误绑。需要一条负向用例，并视核实结果收窄 `HIDDEN`。
- Claude 补测（W3）、九站回归中的 Claude 一格（第 4–6 轮都被挡住）、迟到升级在渲染层的表现；ENV-1 的原因（需普通浏览器同账号对照、排查 TestLab profile Cookie）。
- OBS-1 首屏加载上限、OBS-2 commit 上限取值：已在代码中修复，第 7 轮真机到点收口通过（见下节）。「请求进行中 vs 挂死」的区分仍未做，20s 上限对两者一视同仁。
- `win:closed` 8→7 与 wc27 监听偏多是加载中的临时监听还是重建泄漏，待 Claude 加载完成后再做只读监听比对。
- Alt+H 诊断报告里豆包 `capture-locate` 计数（selector 2 / semantic 2）与逐轮 locateSeq（w2a semantic→selector，w2b/w2c selector，W4 未单列）对不上，计数口径未说明。
- 测试方法：单站补测不要用 `setSelection` 缩小工作区（会销毁并重建其余视图），或在报告里把视图重建列为预期副作用。
- 第 5 轮「仍未证明」中与本轮无关的条目（千问只有卡片分支、测试器修正 ②③、豆包 rebase 阴性分支与 traverse、`POLYASK_KIMI_RESUBMIT` 与 F067）照旧未关闭。

### 复验之后的收窄（未上真机）

审计指出的风险已核实：`aria-hidden` 1.2.6 的 `hideOthers` 对原本就 `aria-hidden` 的同层节点也会打 `data-aria-hidden`。本轮部署的「带标记即不排除」因此可能让弹窗期间本来隐藏的区域参与定位。复验后已收窄为只豁免包住当前输入框的那一层（`history-locate.js` 的 `fenced()`），并补了负向回放用例。上面 W2 的结果对应收窄前的构建（`+worktree-a8e6a7cc1b9b`）；W2 只标记了 `<main>`，而 `<main>` 正包住输入框，所以收窄版行为应与之相同，但收窄版本身还没有上真机复测。（收窄版已在第 7 轮按库算法模拟 18 个节点复测，见下节。）

## 2026-10-05 Windows TestLab 第七轮复验（D1 收窄、20 秒上限、首次加载上限）

**构建与部署**：当前工作区（HEAD `ed87c61` + 未提交改动：D1 收窄为只豁免包住输入框的那层；新会话、重载、历史恢复单站上限统一为 20s；视图首次加载挂上 `initialLoad` 看门）的 `worktree.patch`（约 534KB）sha256 前 12 位为 `79a918422d5f`。`npm run package` 成功，asar 内没有 `*oauth*` 文件，也没有 `googleusercontent.com`/`GOCSPX`；xvfb 冒烟 shell=1、sites=9、attached=9。部署前用户已手动关闭 TestLab，只读确认没有 TestLab `electron.exe` 进程、9224 不响应（curl rc=7），没有结束任何进程。旧 `.webpack` 与 `manifest.json` 备份到 TestLab 目录 `backup-20261005-163253`。manifest 只改了两项：`sourceCommit`=`ed87c618…+worktree-79a918422d5f`，`testMainSha256`=`a51d0fbf…4e1a`（本轮主进程有变化，与上一版不同）。`diff -rq` 新构建对部署目录为空，`electron.exe` sha256 仍等于 `runtimeSha256`，`guard-test` 7 项通过；profile、logs、启动器、`Roaming\PolyAsk` 都没有动。`Launch-Test.ps1` 报 PID 17840，9224 响应（Electron 44.5.0、PolyAskTestLab/1.11.2）。启动日志 `stdout-20261005-163335-354.log` 的 `isolated-test-startup` 带新 sourceCommit，`cookieEncryption` 为 true；10 个页面都就绪，只读检查九站页面都没有可见的登录或注册按钮，readyState 均为 complete，claude.ai 能加载到 `/new`。审计重算工作区哈希，结果与部署一致。

**执行**：用户关闭旧实例后要求继续复测。脚本与 JSON 在会话临时目录 `windows-retest7/`（64 个文件，`_index.log` 记写入顺序，`summary.json` 汇总），不入库。下文已按审计改正测试报告；时间按 UTC 记（本地时间为 UTC+8）。提问都是中性内容，带「PolyAsk」和唯一标签，tier 全部显式 null：W2 豆包 6 条（「请用两句话说明彩虹是怎么形成的」，标签 `W2E1DOUBAODAH-02zb1`、`W2C1DOUBAOAH-04nbq`、`W2E2DOUBAODAH-05i0l`、`W2C2DOUBAOAH-067d0`、`W2E3DOUBAODAH-06tie`、`W2C3DOUBAOAH-07k93`）；W3 DeepSeek 1 条（`W3BCDEEPSEEK-0asjx`，被产品拒发，没有派发）；W6 九站 UI 群发 1 轮（`W6ALL-0hpay`，三项列表加两行 Python，实际派发 8 站，Claude 被拒发）。W2 的诱饵文本只以 DOM 节点形式存在，没有发送。全程没有自动重发，没有点重试，没有碰剪贴板，也没有手动调用 `generation()`/`generationProbe()`。

| 项 | 结论 | 证据 |
| --- | --- | --- |
| W0 构建核对与基线 | **通过**。manifest `sourceCommit` 尾号、`worktree.patch` 哈希与当前工作区哈希都是 `79a918422d5f`；部署的 `main/index.js` sha256 等于 `testMainSha256`；staging 与 `app/.webpack` 逐文件一致。preload 含 `matches('[aria-hidden="true"][data-aria-hidden]')&&!(e&&t.contains(e))`（即 `MODAL_HIDDEN` 的输入框豁免），旧的 `HIDDEN` 选择器仍在；main bundle 含 `ReloadCommitWatch` 的 `2e4`、workspace 的 `2e4`、restore 的 `Math.min(2e4,…)`，`initialLoad` 出现 2 处，没有 `15e3`/`1e4` 旧值。源码中三个上限常量均为 `20_000`，`view-manager.ts` 在 `loadURL` 前调用 `historyAccess.initialLoad`。基线：九站 ready、tier null、九站全选、总览第 0 页；窗口最大化、前台、未锁屏。 | `w0-build.json`、`v0-baseline.json` |
| W1 真实弹窗首问 | **阻塞（弹窗未出现）**。共做 15 次真实弹窗只读检查：w1-pre 1 次，W2 六轮各前后 1 次共 12 次，W6 前后 2 次。结果全部是 dialogs=[]、`dahCount`=0，也没有「下载电脑版」。W2 与 W6 的 post 检查是在模拟还原之后做的。 | `doubao-modal-check-w1-pre.json`；各 `w2*`/`w6` JSON 的 `realModalPre`/`realModalPost` |
| W2 模拟弹窗（D1 收窄，控件穿插） | **通过（限定：只覆盖模拟形态）**。按 `aria-hidden` 1.2.x `hideOthers` 算法移植，目标为 body 下 portal 里的 `role=dialog`，以及人为插在侧栏 `flex flex-col flex-nowrap gap-2` 旁边的 `role=menu`（真实 menu 在 Radix popper 里、不可见，位置不同）。正式 6 轮每轮标记 18 个节点（dry-run 是 21 个，页面有差异），包括 `DIV.shrink-0 bg-inherit`、`DIV.flex flex-col flex-nowrap gap-2`、包住输入框的 `MAIN`，以及侧栏、ASIDE、SECTION、IFRAME 和 body 的其它子节点。原本就隐藏的 `DIV.h-8 shrink-0` 和诱饵节点也被打上标记。第 5 轮真实弹窗的证据只列出 innerText>50 的 3 个文本节点，所以准确说法是：模拟覆盖了真实弹窗已知的 3 个文本节点，其余 15 个是按库算法推出来的。诱饵是 `#chat-route-main` 下一个本来就 `aria-hidden` 的兄弟节点，内含 `data-testid=send_message data-message-role=user`、文本不同。按 E,C,E,C,E,C 交替（16:41–16:45 本地时间），每轮显式 tier null、先开新会话、WAIT_MAX=240 000ms，模拟在 T0 之前设好。**实验组**（`aria-hidden`+`data-aria-hidden`）3/3 submitted/complete/sealed，missing 0、outOfOrder 0，副本长度 85/79/81，封存时副本等于最终副本，pageNotInCopy 只有时间戳和 3 条推荐问。定位过程是：先在 `/chat/local_` 阶段由第 ② 级 semantic 绑定（如 e1 `5236:null:semantic:uc1:teqtrue`），到正式 id 后升到 selector，所以 D1 豁免实际是在 semantic 这一级生效的。**对照组**（只有 `aria-hidden`，走 `HIDDEN` 分支）3/3 submitted/unavailable：local_ 阶段 semantic 被排除，之后 selector 虽然命中（`2920:null:selector:uc1`），轮次已经结束（`-E:null`），与第 5、6 轮真实弹窗的失败机制一致。对照组跑的是当前代码，没有在旧构建上重放，它证明的是「只有标记不同时结果相反」。**诱饵**会被第 ② 级选择器匹配（`data-message-role=user`），而实验组在诱饵存在时仍以 semantic uc1 绑定，说明诱饵被排除、没有计入用户轮次；6 份原始文件里 DECOY 都只出现在 `decoyText` 字段本身，封存的 md 里都没有。所以「诱饵没进副本」不是空检验。模拟全程完好（18/18，同一个 MAIN，路由 `/chat/`→`local_`→`/chat/<id>` 时没被替换）；每轮还原后 `backToPre`=true，dah 和 sim 都归零。 | `w2-simdry-dah.json`、`w2{e1,c1,e2,c2,e3,c3}-doubao-{dah,ah}.json` 及对应 `-compare`/`-sum.json`、`simmodal.js` |
| W3 首次加载上限 | **通过**。用浏览器级 `Fetch.enable`（Document 模式，只匹配 chat.deepseek.com）卡住重建视图（`setSelection` 去掉再加回 deepseek，webContents 11、12）的首个文档请求，分别在 t=174ms、93ms 卡住。run1：phase 依次为 loading → sending（群发在 rel 6069ms 发出）→ 20023ms failed/`load_failed`。群发约在 rel 20284ms 返回 `{ok:false, code:load_failed}`，也就是等到看门到点、阶段钉成 `load_failed` 之后才返回，不是在看门期间返回。问题记录为 failed/`load_failed`/unavailable，页面上没有标签，输入框为空，没有派发。run2（不发群发）在 20015ms 变为 failed/`load_failed`。两次收口时页面 host 都是 null，说明文档从未提交。释放请求都返回 Invalid InterceptionId，说明请求已被 `stop()` 取消；之后 `Fetch.disable`，产品 `reloadSite` 约 506–508ms 回到 ready，工作区顺序不变。看门期间 `sendCommand` 返回可重试 `not_ready` 这一点没有直接日志，只是结果与 `reload-commit.ts` 的注释一致。 | `w3-deepseek-firstload-1.json`、`w3-deepseek-firstload-2-nobc.json` |
| W4 新会话 20s 上限 | **通过**。卡住 deepseek 的下一个 Document 请求后执行 `newSession([deepseek, qianwen])`，用时 20019ms：deepseek 返回 `{ok:false, code:not_ready}`，在 20019ms 变为 failed/`load_failed`；qianwen 返回 ok，519ms ready。释放后产品重载 512ms 回到 ready。独立佐证：Claude 真实挂起时 `newSession(['claude'])` 用时 20036ms，返回 `not_ready`/`load_failed`，文档请求在 20032ms 以 ERR_ABORTED 取消。 | `w4-newsession-cap-deepseek-qianwen-1.json`、`w5-claude-newsession-net-a.json` |
| W5 Claude 单站群发与追问 | **阻塞**。08:33Z 启动时 claude.ai/new 能正常加载，W0 基线里 Claude 也是 ready。08:49Z 测试执行 `newSession(['claude'])` 时，`/new` 的文档请求 20s 没有回包，被中止，Claude 从 ready 变为 failed/`load_failed`，**这是测试动作引起的状态变化**。之后两次产品重载（08:50Z、08:54Z）分别在 20167ms、20172ms 收口为 failed/`load_failed`，不再无限 loading，说明重载上限在真实挂起下有效；W6 里的 newSession 也在 20020ms 因 Claude `not_ready` 收口（这次是新会话，不是重载）。页内探针：`fetch('/new', {credentials:'omit'})` 1839ms 返回 200 text/html，带 Cookie 时 25s AbortError，robots.txt 653ms 返回 200。按计划跳过 Claude 单站群发与追问。审计只读复查时，Claude 的旧 `/new` 文档仍然活着、adapter state 为 fast，只是被产品钉成 `load_failed` 后拒发。 | `w5-claude-newsession-net-a.json`、`w5-claude-reload-1.json`、`w5-claude-fetch-new-include-a.json`、`w5-claude-fetch-probe-a.json`、`w7-claude-reload-final.json` |
| W6 九站回归 | **8/9 通过，Claude 未覆盖**。走 UI 按钮「发送至 9 个站点」，tier 按钮为「跟随站点*」（null），先开新会话（20020ms，原因是 Claude `not_ready`）。chatgpt、gemini、deepseek、doubao、qianwen、kimi、yuanbao、chatglm 均为 submitted/complete/sealed：missingInPage 0、outOfOrder 0，各有 1 个两行 python 围栏且 codeEqual=true，没有未闭合围栏，thinkLeak 0，封存比外壳 complete 晚 3053–3076ms，封存时副本等于最终副本。pageNotInCopy 只有界面元素（免责声明、「Gemini said」、推荐问、Kimi 思考段等）。Claude 为 failed/`load_failed`/unavailable、页面上没有标签，即产品拒发、没有派发。元宝页面出现 A/B 反馈界面，并列两份回答，本轮两份内容相同，与副本一致（见 D-R7-2）。比对用独立的页面读取，不经 `adapter.answer()`，双向有序。 | `w6-all9-ui.json`、`w6-all9-ui-compare.json`、`w6-all9-ui-sum.json` |
| 收尾 | **通过，有一处测试引起的遗留**。主进程和外壳里没有 `__rt*` 全局；豆包 `dahCount`=0，没有 `[data-rt-sim]` 残留。按 host 统计的监听器 diff 为空，窗口与 power 监听器与基线相同；deepseek 的 webContents 编号 5→11→12（两次重建）。工作区九站、tier null、总览第 0 页、focused claude；窗口最大化、前台、未锁屏，9 个视图 `backgroundThrottling` false、visible=true。审计 09:03Z 只读复查：9 个站点页的主世界和隔离世界里都没有 `__rt*`/`__RT`/`__U3`，`[data-rt-sim]`=0，`[data-aria-hidden]`=0，页面上没有 DECOY 文本，工作区哈希仍是 `79a918422d5f`，仓库没改（复查时前台是用户自己的其它窗口，不是测试造成的）。唯一偏差是 Claude 停在 failed/`load_failed`（基线为 ready），由 W5 的测试 newSession 撞上 claude.ai 挂起触发，需要等 claude.ai 带 Cookie 的 HTML 恢复后由用户点重载。测试产生的问题记录留在 TestLab 历史里。没有关闭或重启 TestLab 或其它进程，没有碰 `Roaming\PolyAsk`，没有读凭据。 | `final-check.json`、`listener-diff-by-host.json`、`summary.json` |

**观察与缺陷**
- **D-R7-1 claude.ai 带 Cookie 的文档请求挂起（low，原因未定）**：带 Cookie 25s AbortError、不带 Cookie 1839ms 返回 200，支持「服务端或账号侧」的推断，但没有证实。08:33Z 启动时还能加载，说明挂起是之后才出现，或者时好时坏，不是从第 6 轮起一直没好。产品现在会在 20s 收口为 `load_failed`，但 Claude 本轮无法使用。与第 5 轮 D2、第 6 轮 ENV-1 是同一现象。
- **D-R7-2 元宝 A/B 反馈界面（low）**：页面出现「您正在提供关于 元宝 新版本的反馈 / 您更喜欢哪个回答 / 回答 1 / 回答 2」，并列两份回答，副本只收了其中一份（`pageFinal.yuanbao` 19 行含两组列表和代码；compare `extraPagePre`=5，pageNotInCopy 含「回答 2」）。本轮两份内容相同，看不出取的是哪一份；两份不同时，副本可能与用户最终选择的那份不一致。
- **D-R7-3 Gemini 新会话后长时间显示 loading（low，观察项）**：W6 新会话后，Gemini 在约 50s 内一直是 loading（statusEvents 从 -50009ms 的 loading 直接跳到 521ms 的 sending；waitReady 在 26.7s 时仍为 loading）。群发照常发送、采集完整，但用户看到的圆点会一直是 loading。原因推测是 did-finish-load 迟到，但没有采集生命周期事件，未证实。
- **新会话上限的取舍（产品说明，已写入 docs/desktop.md 预算表）**：新会话导航到点后，`abandon` 会把仍然可用的旧文档一起钉成 `load_failed` 并拒发；站点 HTML 一直挂起时，用户就失去了原本能用的页面。这是为了防止群发打进旧会话的刻意取舍。

### 仍未证明
- **真实豆包弹窗下的 D1 收窄（W1）**：本轮 15 次检查都没出现弹窗，只有模拟证据。补测：真实弹窗出现时跑至少 3 次新会话首问，同时记录全部 `[data-aria-hidden]` 节点（不按 innerText 过滤），用来核对模拟的标记集合。
- **模拟与真实弹窗的等价性**：真实库到底标记多少节点、是否给原本隐藏的兄弟节点也打标记、真实 menu 与 dialog 的位置，目前都只知道 3 个文本节点；模拟也没有遮罩层、焦点锁和 react-remove-scroll。
- **弹窗在运行中途出现或关闭**：模拟只在发送前设好、封存后才移除，没测「绑定后才出现」或「local_ 阶段关闭」。补测：这两种转换各交替跑实验组与对照组，确认不会中途 `stop()`。
- **20s 上限的正向对照**：放宽到 20s 的理由是 ChatGPT 带 Cookie 的 HTML 约 13s 才回，但本轮只证明到点会收口，没证明慢但能落地的页面不会被误杀。补测：用 Fetch 把 Document 请求延迟约 15s 再放行，分别覆盖首次加载、新会话、重载，预期都是 ready/committed，而不是 `load_failed`。
- **`RESTORE_SITE_CAP_MS`=20s**：本轮没测到。补测：卡住恢复目标的 Document 请求，预期 20s 时 `stop()` 并报错。
- **看门期间 `sendCommand`/`collect` 返回可重试 `not_ready`**：没有直接日志，只能从群发最终返回 `load_failed` 推断。
- D-R7-1 的原因（推断为外部或账号侧，未证实）；D-R7-2 两份回答不同时副本取哪一份（考虑是否需要按用户选择认定）；D-R7-3 的原因（下次新会话采集 Gemini 的 did-finish-load、did-stop-loading 时序）。
- Claude 单站群发、追问与九站回归中的 Claude 一格（第 4–7 轮都被挡住）、迟到升级在渲染层的表现：等 claude.ai 带 Cookie 的 HTML 恢复后补跑。
- 第 6 轮「仍未证明」中与本轮无关的条目（`win:closed` 8→7 与 wc27 监听偏多、Alt+H 诊断报告 `capture-locate` 计数口径、「请求进行中 vs 挂死」的区分）以及第 5 轮遗留条目（千问只有卡片分支、测试器修正 ②③、豆包 rebase 阴性分支与 traverse、`POLYASK_KIMI_RESUBMIT` 与 F067）照旧未关闭。

## 2026-10-05/06 Windows TestLab 后续核对（20 秒上限正向对照、恢复超时、就绪判据采证、元宝 A/B）

实例同第七轮（PID 17840，代码与 `b60eb92` 一致）。证据：scratchpad `followups8/`、`ready9/`（不入库）。审计更正已并入。

| 项 | 结果 | 要点 |
| --- | --- | --- |
| 20s 上限正向对照 | 通过 | DeepSeek 首个 Document 请求经浏览器级 Fetch 压 15s/18s 后放行：新会话（返回 ok）、产品重载、视图重建均几十毫秒内提交并 ready，无 load_failed；4 次观察越过 23.5s 无迟到 abandon（新会话 18s 那次只观察到 19.7s，代码上 `capped()` 提交即清计时器）。恢复提问历史压 15s → opened |
| 恢复超时 | 发现缺陷，已在代码修复 | 压住不放 → 20012ms 返回 timeout，主进程只收到 `did-stop-loading`（无 did-fail-load / did-navigate），站点停在 loading，视图却是旧会话（complete、输入框可用）；产品重载 512ms 恢复。「下一次群发会打进旧会话」由代码推出，未真机发送。修复：超时与用户取消在途都走 `historyAccess.abandon`（钉 load_failed），回归 `desktop/test/question-restore.test.ts`；2026-10-06 复验 K3 通过 |
| 就绪判据采证 | 记录，不改代码 | 54 个站次 newSession，生产 `findComposer` 每 250ms 只读探测（只认新文档）。Gemini 编辑器（占位 textarea → 水合后的 div）提交后约 1–4s 出现，比 did-finish-load 早约 2–11s（n=5 精确；另 7 次只有上界，3 次超过 8s）；元宝早约 0.6s；ChatGPT、豆包水合后的编辑器反而比 did-finish-load 晚 0.7–2.1s（现行判据已先于编辑器报 ready）；DeepSeek、千问、Kimi 基本同时或更晚。Gemini 在 finish 之前发送 2 次：1 次 ok，1 次 submit_unconfirmed 后约 7s 才真正发出、经迟到确认升级、页上仅 1 条提问（原因未证实）。Gemini 慢网成因：文档/脚本 TTFB、传输与请求排队（stall）都出现过，h2/h3 都慢，经本机代理；上一轮「h3 同一连接」的说法不成立。全程工作站锁屏、窗口未聚焦、`POLYASK_IDLE_THROTTLING_EXPERIMENT=1`。用户决定不改判据，语义写入 docs/desktop.md |
| 元宝 A/B | 未复现 | 10 次发送未出现。第七轮 W6 记录推断：两份回答是同一 `speech_show` 里两个 `.hyc-common-markdown`，`answer()` 取 DOM 末块（推断「回答 2」）；重新打开该会话有 PageTurning「1 / 2」翻页、默认第 1 页，副本可能与重新打开时默认看到的不是同一份（两份内容相同，未坐实）。`data-conv-multi-answer` 不能当信号。用户决定先观察，探针 `followups8/abprobe.js` 备用；不点偏好按钮 |
| 豆包真实弹窗 | 未出现 | 每轮涉及豆包前先做只读弹窗检查 |

副作用：采证中第一次九站新会话触发智谱阿里云滑块验证，智谱停在验证页（需用户手动验证；未碰滑块、未重试）；Claude 仍因带 Cookie 的 HTML 挂起停在 load_failed。

### 仍未证明

- Gemini 水合编辑器的稳定页面标识与非锁屏前台条件下的时序（判据不改，仅供将来参考）。
- 元宝 A/B 两份内容不同时副本取哪份、用户选择后页面如何变化。

## 2026-10-06 Windows TestLab 复验（中止后保留旧文档、恢复超时/取消钉失败）

部署 `ed87c61…+worktree-62f356747ba1`（PID 29416，备份 `backup-20261006-100309`），staging 与部署目录一致、guard 7 项通过、9 站登录正常。证据 scratchpad `retest10/`（不入库）。DeepSeek 场景用浏览器级 Fetch 只压 `chat.deepseek.com` 的 Document、到上限不放行。

| 项 | 结果 | 要点 |
| --- | --- | --- |
| K1 Claude 自然挂起 | 通过 | claude.ai 文档请求间歇挂住。/new 上重载挂住 → 20020ms 保留旧 /new 并 ready；/new 上新会话挂住 → 20038ms 返回 `not_ready`、站点 ready；随后只发 Claude 的群发 submitted、页上 1 条带 tag 提问。从会话页点新会话挂住 → 20045ms `load_failed`（符合预期），会话页上重载挂住 → 保留并 ready。02:26 起网络恢复，新会话 1300ms 成功 |
| K2a 会话页点新会话（挂住） | 通过 | 20020ms `not_ready`、`load_failed`；此时群发 10ms 返回 `load_failed`、页面无 tag，旧会话未被写入；重载 522ms 恢复 |
| K2b 首页点新会话（挂住） | 通过 | 20023ms `not_ready`，站点 ready（旧首页保留）；随后群发进入该首页，complete 封存、副本与页面一致 |
| K2c 重载（挂住） | 通过 | 19962ms 保留旧文档并 ready |
| K3a 恢复超时 | 通过 | 20027ms `timeout`，站点 `load_failed`（不再停在 loading）；重载 513ms 恢复 |
| K3b 恢复中途取消 | 通过 | 5.1s 取消 → 5944ms `cancelled`，站点 `load_failed`；重载恢复 |
| K4 视图重建后首次加载挂住 | 部分通过 | 19858ms `load_failed`（无已提交文档可保留，符合预期）；**但产品重载两次都无效**，约 20s 后仍 `load_failed`，靠新会话 201ms 恢复（见下） |
| K5 九站 UI 群发 | 通过 | 新会话 9/9 ok，9/9 complete 封存，副本与页面一致、2 行 python 一致、无思考泄漏；豆包无真实弹窗。全程窗口最小化（非测试操作） |

### 缺陷与观察

- **首次加载被中止后重载无效（HEAD 既有，已修复：无已提交文档时重载改为加载首页；2026-10-06 第二次复验 M1 通过）**：视图无已提交文档（URL 空、历史长度 1、主帧 origin null），`webContents.reload()` 不发起任何导航，看门 20s 后再钉 `load_failed`。用户只能点新会话或重新勾选站点。证据 `k4-deepseek-reload-after-firstload-fail.json`。
- 保留旧文档时新会话仍返回 `not_ready`（外壳会报「N 站失败」），站点却是 ready、可发送。已修复：保留时按成功返回（2026-10-06 第二次复验 M2 通过）。
- Claude 极短回答（「请只回答 OK」）首次探测即读到 complete，未见 generating / complete_observed，落在 `generation_unconfirmed`、未封存；同一文档上较长回答正常。与保留规则无关。
- 保留规则要求地址完全相等：智谱（`?lang=zh`，会话在 `?cid=`）、Kimi（`?chat_enter_method=`）首页挂住时照旧钉失败——有意保守，忽略 query 会把智谱会话页当成首页。

## 2026-10-06 Windows TestLab 第二次复验（首次加载后重载、保留时新会话算成功）

部署 `1ead369…+worktree-860d740e7af2`（PID 33848，备份 `backup-20261006-113814`），guard 7 项通过、9 站登录正常。证据 scratchpad `retest11/`（不入库）。DeepSeek 场景用浏览器级 Fetch 只压 `chat.deepseek.com` 的 Document。

| 项 | 结果 | 要点 |
| --- | --- | --- |
| M1a 视图重建、首次加载被中止后普通重载 | 通过 | 约 19.9s `load_failed`（getURL 空、origin null、历史长度 1）；放行后点重载 → 导航到首页，0.81s ready |
| M1b 同上，清缓存重载 | 通过 | 0.94s ready，目标同为首页（这条路径走 `loadURL`，「忽略缓存」不生效；此时本无缓存文档） |
| M1c 同上，清站点数据 | 通过 | 0.83s ready，登录保留 |
| M2a 首页上新会话（挂住） | 通过 | 20035ms 返回 `ok:true`，站点保持 ready；随后单站群发 complete 封存、副本与页面一致 |
| M2a 对照：会话内普通重载 | 通过 | getURL 非空仍走 `webContents.reload()`，留在原会话 |
| M2b 会话中新会话（挂住） | 通过 | 20020ms `not_ready`、`load_failed`；重载 533ms 恢复且仍在原会话 |
| M3 Claude | n/a | 本次 claude.ai 正常，新会话 890ms ok，保留分支无法自然复现 |
| M4 九站 UI 群发 | 通过 | 9/9 complete 封存，副本与页面一致、2 行 python 一致；豆包无真实弹窗 |

清理：Fetch 全部关闭，无 `__rt*` 残留，监听器与基线一致（仅 DeepSeek 视图因重建换了 webContents）。

## 2026-10-06 历史采集修复：四站同会话连续追问

Windows 独立 TestLab、PolyAsk 1.12.0、Electron 44.5.0。初测构建 `be75126…+worktree-f378659278d0`；豆包修复后为 `be75126…+worktree-4654a2c3a017`；审查修复后的最终构建为 `be75126…+worktree-3d44fe9fb29a`（PID 12172，备份 `backup-codex-20261006-173248`）。部署前正常退出本任务实例，备份应用 bundle 后更新；12 个构建文件与部署逐字节 hash 一致，runtime/main 与 manifest 一致，Cookie encryption fuse=49（Enabled）、7 个隔离 guard 用例通过。仅复用 TestLab profile，Drive 未连接且无已保存 token；未访问正式档案。初测窗口已最小化，最终构建复验在可见窗口；既有进程级节流实验开启，正式默认策略未改。

生产 shell `polyask.broadcast` 入口、`tier:null`，逐站首问后两次同会话追问，不带图、不重发。每轮含独立合成标记、中文段落、两条建议和两行 `print`；每站三个 userKey 各异、落库会话地址一致。除最终 Claude 首问迟到确认外，外壳 complete 时立即读取页面并追问，此时前轮尚未封存；生产 prepareRun 的有界复读在约 3 秒后封存前轮，再提交追问。共实际发送 30 个合成问题：初测及豆包修复复验 16 个、最终构建四站三轮 12 个、取消用例前轮和极短追问各 1 个；另有 1 次在派发前取消的追问请求。

| 站点 | 最终三轮结果 | 副本字符数 | 独立页面对拍 |
| --- | --- | --- | --- |
| Claude | 3/3 最终 submitted、complete、sealed；三轮均观察到新助手根 true→false | 264 / 276 / 283 | 正文无遗漏、代码逐字一致；页面额外字只有时间与语言标签 |
| ChatGPT | 3/3 submitted、complete、sealed | 273 / 258 / 250 | 正文无遗漏、代码逐字一致；页面额外字只有语言标签与免责声明 |
| 豆包（修复后） | 3/3 submitted、complete、sealed | 221 / 239 / 242 | 正文无遗漏、代码逐字一致；页面额外字只有时间与推荐追问 |
| DeepSeek | 3/3 submitted、complete、sealed | 236 / 236 / 264 | 去除 Markdown 段落/序号及方括号转义后，双向全文相等；两行代码以普通文本逐字核对，无 pre/code 围栏可验 |

最终 Claude 首问返回 `submit_unconfirmed`，没有重发；页面随后只出现 1 条本轮用户消息，采集以只读归属证据迟到升级为 submitted，完成并封存后才发送新的第 2/3 轮追问。首轮封存内容在后续追问与短答后仍未改变。其它三站及 Claude 后两轮均在封存前发起追问；Claude/ChatGPT/豆包页面用户数为 1/2/3，DeepSeek 最终为 1/2/2（580px 列内发生旧消息回收），三轮 key 与副本仍各自对应。该观察证明本次计数漂移下归属正确，不单独证明首次绑定前整页重建分支。

对拍工具在主世界用 TreeWalker 独立读取页面用户气泡之后的可见文本、列表及 pre，不调用 adapter.answer/historyTurn/toMarkdown 生成期望正文；隔离上下文的 historyTurn 仅另记轮次身份。逐行有序双向核对，页面独有文字逐项审查，副本无思考泄漏。DeepSeek 页面末尾重复显示当前用户提问，旧读页脚本选了最后一个同标记节点，后两轮读空；修正为会话内第一个节点、在下一条合成提问前截止后重新只读核对。最终第三轮双链括号在副本中正常转义，正文对拍解码 `\[`/`\]` 后相等，代码另用原始字符串逐字核对。回读 Claude 首轮时也将 pre/list 的读取截止到下一条提问，避免误把后两轮代码计入首轮。没有为修正取证重发问题。

真机发现并修复：豆包三轮把 `print("round3")` 改排成 `print ("round3")`，原文匹配一直报 prompt_mismatch，前两轮因追问封存为空 interrupted；不算通过。新增正例先 RED、再限制性归一化 GREEN，字面量内容、转义/未闭合引号、数字、英文词、额外轮次与其它站负例保留。重构建并重启 TestLab 后，上表三轮均通过。归属 key、路由、插入和前驱保护没有放宽。

初次 Claude 极短补验是空会话首问，true 持续约 198ms；最终构建另在同会话第 5 轮发极短追问，实际观察到本轮新助手根 true 持续约 208ms 后 false，副本完整为 `OK`（2 字符），约 3 秒复读后 complete/sealed。它证明本次可采到短答正向证据；停止键与 true 都未被观察到时仍应完成未确认，false 单独不算证据。

最终构建准备期取消：Claude 新前轮外壳 complete、尚未封存时立即发起追问，100ms 后通过生产 shell cancel 取消；约 3004ms 返回 `cancelled`。随后页面用户数保持 4，未出现追问标记、无追问历史记录，前轮仍 complete/sealed（165 字符）。取消没有把准备期新轮派发出去，也没有停止前轮采集。

只读审查发现的五项问题均先以回归重现，再修复：准备期取消跨 IPC、不同稳定 key 的乐观换绑、Claude 前轮 true/同 key 重挂、豆包裸正则空格、DeepSeek 前驱自身 key。复核无剩余 Critical/Important/Minor；对应负例与最终构建真机证据分别记录，不把离线负例当成真机覆盖。

最终源码门禁：仓库 verify、Desktop 完整测试（892 个 TS/renderer + 385 个 runtime，0 fail/skip）、独立 typecheck、package 与隔离 Xvfb smoke 均 exit 0，冒烟 shell=1、sites=9、attached=9。npm test 初次因沙箱禁止 tsx 临时 IPC 管道未启动，package 初次因沙箱网络限制未取到 Electron；按权限流程运行原命令。审查修复后全测曾因 shell-contract 仍预期旧取消参数而失败，更新契约断言后完整重跑通过。原始记录在系统临时目录 `polyask-history-native-20261006/`，不入库；测试问答保留在 TestLab，临时页面观察器与外壳状态监听已解除。

未覆盖：其它五站的新三轮发送、真实 Drive 双设备、DeepSeek 首次绑定前整页虚拟回收与更长会话、真实思考暂停/续写撤销再确认、站内可信草稿/复制/滚动及切页/同文旧会话负例。上述保护有离线回归，不能把本轮短会话外推为全场景真机通过；用户最初报告的失败形态和当时版本仍未确定。

## 2026-10-07 历史阅读与 Mermaid 验收

完整门禁 900 个 TS/renderer、400 个 runtime 用例（0 fail/skip），独立 typecheck、仓库 verify、package 与 Xvfb smoke 通过（shell=1、sites=9、attached=9）；生产依赖审计 0 漏洞。隔离 Electron 阅读专项通过简中、繁中、英文及明暗主题，已检查截图；覆盖实际 SVG 成图、源码/完整链接值、切换、缩放、错误/缺失/复杂度回退与迟到绘制。开发态 `npm start` 的九站生产 `__AMS` 均加载共享采集卷，离线回放用九站生产 `historyTurn()` 验证只读与源码空行。

用户明确授权有方向的合成测试提问后，在独立 Windows TestLab 发送共 21 条无个人信息的流程图验收题，包含九站两轮及智谱、豆包针对性补验；没有自动重发。最终完成后的 DOM：智谱、Kimi、元宝保留标记源码，Gemini 的无语言代码通过确定语法头识别，豆包源码来自 `role` / `aria-controls` 明确关联的隐藏页签；五站副本取得源码。Claude、ChatGPT、DeepSeek、千问本轮完成后的页面仅保留图形，四站保存明确的源码缺失占位，ChatGPT 副本的缺失提示已在历史页核验；这不代表其它模型或回答形态永远没有 DOM 源码。

真机发现的豆包图表工具栏误判用户、透明导出水印均先 RED→GREEN 再重构建重启补验；最终豆包副本 complete，88 字符原始源码保留，103 字符副本恰为 Mermaid 围栏，无水印或操作标签，Windows 历史页实际成图、无横向溢出。智谱历史成图和两项无文本会话图标也已核验，系统浏览器接受完整合成会话地址。原站采集不点击代码/预览，不从 SVG/框架内部状态反推源码；旧缺失源码副本不回填，复杂图超过保守预算时保留源码。

复制的完整值由隔离 UI 断言；Windows 可信鼠标点击后 clipboard 写入返回成功，但该环境 Electron 原生读取返回无格式、PowerShell Get-Clipboard 报 ExternalException，未核验系统粘贴内容，不把不可用的读取当成功。未执行 macOS 原生验收、五种发行包安装或真实 Drive 双设备同步。原始 DOM、日志和截图留系统临时目录，不入库；测试登录档案保留，正式档案不参与。

## 2026-10-07 历史工具栏合并验收

完整 Desktop 门禁 900 个 TS/renderer、400 个 runtime 用例（0 fail/skip）及独立 typecheck 通过。隔离 Linux Electron 阅读专项通过三语、明暗主题和 1100/640/420px 布局，已检查宽窄截图；当前尝试恢复、全部站点恢复、三项图标动作及再问/删除作用域通过。生产历史页交互专项通过 10 个场景，包含菜单 Escape、原生 Tab/Shift+Tab、原有删除确认和迟到详情保护；新增菜单曾被父历史页抢先处理 Escape，修复后复验通过。使用临时合成数据，不访问正式档案；本轮没有重复 Windows/macOS 原生验收、真实站点导航或发行包安装。

## 2026-10-07 决策卡字段校验验收

Unicode 标题与正文边界、定稿必填、九条摘录上限、重复/无效来源及同归档已存摘录保护均有行为回归。隔离 Electron 通过简中、繁中、英文各 1200/640px 场景，覆盖首个错误聚焦、修正后更新、摘录逐字核对及保存失败保留输入；使用合成记录，未连接正式档案或 Drive。整合工作区完整门禁为 983 个 TS/renderer、400 个 runtime 用例（0 fail/skip），仓库 verify 通过；这些整合门禁不代表其它尚未完成的 UX 建议已验收。

## 2026-10-07 输入保护与辅助发送恢复验收

行为回归覆盖模板三路替换取消、失败保留名称、图片追加顺序和合计限额、迟到读取失效、普通文本拖入/粘贴及组合输入边界；真实 DOM 覆盖失败/提交未确认后的完整综合与追问恢复、重置后的迟到回包、在途成功保护新稿和来源变化提示跨卸载保留。独立审查发现的新稿误删与来源基线丢失均先复现、再修复并复核。

隔离 Linux Electron 两项专项各通过简中、繁中、英文的 1200/640px 六场景；核对了模板失败、通知与提示共存、32px 底栏及两类辅助编辑恢复的宽窄截图。完整门禁 983 个 TS/renderer、400 个 runtime（0 fail/skip）与 verify 通过；打包和 Xvfb smoke 通过（shell=1、sites=9、attached=9）。使用合成记录与发送桩，未执行真实站点提问、Windows/macOS 原生输入法或读屏、真实 Drive 同步；这些限制不得由隔离场景外推。

## 2026-10-07 阅读键盘与输入法边界验收

焦点收集回归涵盖普通链接、可编辑字段、tabindex、隐藏/禁用和折叠内容；生产历史专项以 Electron 原生 Tab/Shift+Tab 核对两条普通来源及前后边界，并保留菜单、慢读取、分页与迟到详情用例。组合态/229 Escape 使用事件模拟核对默认取消及页面保留，不冒充微软拼音、macOS 输入法或读屏实测。整合工作区的 983 个 TS/renderer、400 个 runtime 用例及 verify 已通过；弹框与备份专项随备份核对批次单独记录。

## 2026-10-07 备份核对与范围恢复验收

真实 SQLite 回归核对只读预览无数据库/outbox 写入、token/指纹/键拒绝、删除身份映射、父对象复用、选择计数与 apply 一致、事务回滚和旧回包失效；未封存回答在两次读取之间时钟变化导致的计数漂移先复现后修复。独立审查复验已关闭该问题及复用父提问的依赖提示问题。

最新隔离 Electron 通过 20/100 条合成备份、三语各明暗宽窄共 12 场景，覆盖当前筛选批量范围、依赖定位/加入、删除不自动选择、最终确认与计数；已核对宽窄截图。文件夹、备份、菜单、选择器、图片五场景同时核对原生焦点圈和模拟组合输入边界。完整门禁 983 个 TS/renderer、400 个 runtime（0 fail/skip）、verify、package 与 smoke（1/9/9）通过。不连接正式数据或 Drive，不以模拟恢复及小批备份代替跨设备和最大 20,000 条性能验收。

## 2026-10-07 标签与归档上下文验收

回归覆盖标签 32/20 码点及原数组边界、具体错误与焦点、失败保稿、防重复点击、完整对象上下文、新建后选择/确认关联，以及在途旧文件夹刷新不能覆盖新内容。后者由独立审查复现后修复，八条真实 DOM 流程复验通过；完整 Desktop 983+400 门禁及 verify 通过。

三语 1200/640px 隔离 Electron 连续两轮各六场景通过，原生鼠标/按键/insertText 输入均验证为受信任事件；覆盖故意延迟的关联载入、标签修正、创建失败保名、重复点击与最终关联失败后重试。整合时旧夹具曾过早点击禁用控件，随后原生按键清空尚未结束就插入文本，现均按实际控件/keyup/DOM条件有界等待，每场景隔离窗口；未放宽业务断言或改产品以通过测试。该证据不等于物理输入法、正式数据或真实同步验收。

## 2026-10-07 重试核对、保存副本整理与设置验收

测试内存防护提交 `a8ffcda` 后，所有本轮 Node/React 回归、打包及原生专项均经 `test-safe.mjs` 串行运行；Linux 临时 cgroup 对整组进程限制 4GiB 内存及 512MiB swap，原生专项使用独立 Xvfb。没有用巨大 DOM 或多 GiB 分配重演事故，也没有修改持久系统配置。受限 RED 只打印标量差异，失败后按原因处理，不自动重试资源失败。

重试取消分类、同轮迟到提交证据、非当前站检查、主进程拒绝及严格回执、等待锁和已作废回复均有实际 RED→GREEN 回归。三语各 1200/640px 六组原生交互通过；另以生产 renderer 根组件模拟主进程先移除 A、界面仍选中 A 的同步竞态，拒绝后给出具名提示，无其它站点聚焦、范围修改或发送，人工重选后只定位 A。该夹具不等于真实 Drive 双设备。实际 WebContentsView 在确认覆盖期间保持挂载与 400×500 正视口，返回时未选忙碌页仍隐藏，进入结果库仍移出树。独立提交快照完整 1014 个应用、416 个运行时用例及 package/smoke（1/9/9）通过。

历史原生专项完整核对三语、明暗主题、1100/640/420px 及 150% 缩放的 24 个唯一组合，系统剪贴板 25 次全文逐字对账，四个保存副本整理流程和旧 13 个键盘场景均通过。覆盖旧尝试与位置、指定保存正文/身份/完整原问题、阅读/比较/现有文件夹及迟到保存失效，不调用当前网页采集。切站滚动的状态设定为程序化，其它交互用原生鼠标/按键；已人工查看窄窗暗色及英文 150% 截图。独立提交快照完整 1061 个应用、416 个运行时用例及 package/smoke（1/9/9）通过。

设置三语各 1200/640px 六组原生场景通过，核对显示受理、低频操作展开、清理数量变化/失败保留/备份定位及机器原因恢复顺序。另以生产根组件延迟 reset 回包，在破坏性 IPC 入口同步触发命令及等待期间四种全局命令，均阻止导航且只写一次；完成后导航恢复、旧输入/图片/重试/辅助稿与迟到回包正确隔离。统计由真实 SQLite 只读 SELECT 验证，不将确认重读与写入两次 IPC 称为原子快照。最新整合门禁 1105 个应用、416 个运行时用例（0 fail/skip）、package/smoke（1/9/9）通过；它不代表全部 34 项建议已完成。

以上使用隔离合成数据与发送桩，未访问正式档案或发送新的真实站点问题。Windows/macOS 新原生场景、物理输入法、读屏、真实 Drive 双设备及大数据性能仍未验；本轮未改变九站适配器、发送预算或自动重发策略。

## 2026-10-08 工作台、摘录与规模阅读最终验收

最终冻结产品的 Desktop 门禁为 1,348 个应用/renderer 与 416 个 runtime 用例，0 fail/skip；包含格式化前断言保护、静态 DOM 门禁及串行超时。全部重工具经 `test-safe.mjs` 串行运行，临时整组 4GiB 内存、512MiB swap；没有压力重演或持久系统配置变更。旧源代码断言及抽取 App 的 VM 夹具跟随模块拆分、新参与范围与进度失效接口修正，保留草稿、确认、视图复用、表单命名和可信桥接的原有语义。

工作台专项通过三语的参与/页面保留/零参与禁发、独立取消/确认关页、原生排序拖动及键盘、150%缩放与延迟保存焦点恢复。输入框三语各两种密度原生检查保留光标/位置、档位及附件边界；整轮摘要三语×两密度×展开/折叠×100%/150%以两个真实WebContentsView核对几何。指南还验证真实 QuestionHistory 保存两份指定副本、matching ArchiveSurface 实际进入比较后才持久化完成；取消、错误身份和只进入阅读不能完成。生产根组件的关闭竞态定位专项及六组指南原生布局通过，不把合成发送桩当成实网提问。

比较最终原生专项通过14个唯一布局与四个完整流程，覆盖三语明暗宽窄、150%及强制颜色；两侧来源/展开滚动、返回阅读500px位置、双份连续证据与显式决策保存、原文摘录/追问/变化来源核对均通过。原文选区使用可信鼠标拖选并核对精确UTF-16连续范围及逐字预览；普通LF文本框与生产CRLF文本框采用同一方法，不通过程序化选区冒充原生。先前Home/End及CDP编辑命令在普通LF对照也不移动选区，未据此猜修产品。补充分析专项另通过14种布局、14次系统剪贴板完整载荷对账和四个流程，区分提交/取回/保存，原始要求与完整来源仍保留。

独立复核新增的摘录来源读取竞态先以四个deferred真实DOM用例RED，再修复为GREEN：等待期间新备注须再次确认，取消保留；批准后重读来源，版本变化拒绝；重读期间再出现新稿仍需另行确认。最终dirty/请求身份检查与导航之间没有await。相关30项回归及重新构建的完整比较原生专项均通过；独立只读复核在限定生产参与/关页、整轮身份、摘录来源和批量整理边界无遗留Critical/Important。

资料库与技术阅读分别通过六组原生交互：1,000混合记录全部可达、末项键盘、分页/筛选/返回滚动、准确当前记录、串行批量停止/失败重试及150%强制颜色；代码系统剪贴板逐字保留tabs/末尾LF，公式实际本地Worker预览、有限安全MathML、超限/不可信命令源码回退和键盘入口。数学未闭合块反复扫描、嵌套容器偏移及迟到搜索误弃新编辑稿均有实际RED→GREEN回归。技术阅读早期首次复制拒绝的根因未确认，后续夹具修正file-origin持久zoom、可信命中及焦点，再fresh全组通过；未对产品复制逻辑加重试或放宽断言。

旧Shell交互夹具已跟随高级数据折叠、确认按钮与只读数量接口更新，未删检查。完整Shell专项最终通过96种布局、动作/状态对比度、提问与诊断键盘流程、设置150%缩放，以及原有明暗细节/排序/参与/原生弹框分支。实测曾在960px舒适密度出现工作台子控件越界，先RED后修正窄窗列宽及三个按钮最小尺寸，再fresh全组GREEN；已人工核对960px英文舒适密度截图。跨平台三种样式分支在Linux合成测试，不等同Windows/macOS原生验收。

有限性能后测使用500个结果+500个决策卡，只有两个结果各含九份完整31–32KiB Markdown，生产React/解析器、1600×1000/100%/简中亮色；各场景3次预热、20正式样本，共160正式样本。只渲染当前页≤100条，比较无隐藏正文/额外全文解析，无变化父重绘parse增量0，阅读核对九份正文末尾完整。六个时延目标保留并达标：挂载p95 54.5ms、广搜索233.8ms（含180ms防抖）、九长文打开340.0ms、切记录342.1ms、阅读→比较198.1ms、父重绘48.1ms。CPU为CDP ThreadTime差分，含测量命令；GC后全工作量比较堆13.68MiB、detail元素7,244、单renderer工作集319.0MiB。原独立比较≤10MiB/5,500元素及精确配对CPU下降25%未验证：原前测临时夹具丢失，新同尺度合成数据/主机负载和范围不同，不报告改善百分比，也不把全工作量快照当独立组件预算或泄漏结论。前后13个相关生产文件SHA一致、0 HTTP，runtime硬限60秒，含构建整项46秒；没有真实SQLite/磁盘/IPC成本。

最终810个代码文件冻结前后SHA一致，最新完整1,348+416门禁、仓库verify、独立typecheck、package及隔离Xvfb smoke均exit0；冒烟shell=1、sites=9、attached=9。设计与原始合成证据留在本机，不作为公开文档的外部依赖。本轮完整门禁与后测是当前候选结果，未发布。

本轮使用隔离档案和合成记录，没有正式数据写入或新实网提问。Windows/macOS本轮原生、物理IME、读屏、真实Drive双设备、20,000条及发行包安装未验；组合事件不替代物理输入法。没有改九站适配器、44s/90s预算、自动重发、数据库/同步schema，也没有push/发布。性能结果不能外推至这些未测路径。

## 2026-10-08 GPT-6 与模型情报复验

在 Linux/WSL 英文开发态复用既有已授权档案，重启后使用目标站点隔离上下文的生产 `__AMS`。本轮未发送提问，结束恢复原模型、强度及应用布局。

- ChatGPT 新菜单的模型短标签为 `6`，显式登记为 GPT-6 别名；快→思→快均为 GPT-6、`preferred`，实际滑块范围 0..4，端点复读 0/4/0，闭合标签 Instant/Pro/Instant，动作结束菜单关闭。关闭菜单后的只读证据仍不能证明模型，不缓存先前读数。5.6 备用、不同范围、未知/歧义/隐藏/禁用模型由离线回归覆盖。
- Claude 新菜单默认项文字为 `MediumRecommended`，闭合按钮只有 `Medium`。该差异先以回归复现失败，再修改确认逻辑并重启；快→思→快均成功，分别为 Opus 5.5 Medium / Fable 5.1 Max / Opus 5.5 Medium，菜单残留为零。实际切到 Sonnet 5.5 Medium 时 `state=fast`，随后恢复原值；没有因新品公告改动已有快速/思考预设。
- Gemini 实际菜单为 3.5 Flash-Lite / 3.8 Flash / 3.1 Pro / Extended thinking。生产快→思→快成功，快速为 3.8 Flash，思考为 3.1 Pro 且 Extended 已选中，切回后 Extended 未选中，动作结束菜单关闭。现有版本无关选择规则可用，未新增版本专用正则。

以上为本机真实页面的切档证据，不证明其他账号灰度、中文站点布局、Windows/macOS 或真实发送成功。两项现场差异均有实际 RED→GREEN 回归。

## 2026-10-08 工作台与历史工具栏整改验收

隔离 Electron 使用生产组件及样式，在三语、两种密度、缩放下检查：Shell 96 种布局及排序、发送范围、键盘、对比度流程通过；工作台 24 种组合的两个真实 WebContentsView 与外壳几何一致，另六条可信键盘/鼠标流程通过。分页回到主工具栏，进度占用已有底栏；读取按钮固定右端，操作提示出现/消失不会移动点击目标。

历史阅读通过 24 种布局、四条完整流程及 25 次系统剪贴板全文回读，并复验原有 13 条键盘流程。菜单箭头和省略号 SVG 中心偏差小于 0.5px；仅删除一项时顶边框及额外上距为零；原问题复制按钮在主工具栏，复制内容保留完整空白与换行。旧原生夹具的位置选择器、反馈样式缺失及视图 resize 等待已跟随布局更新，保留可信点击、原生视图与系统剪贴板断言。

## 2026-10-08 OAuth 回调卡片验收

本地 HTTP 回环测试覆盖三语的收到/拒绝六种组合，核对 state 拒绝、单语内容、`no-store` 及回调参数不出现在页面。隔离 Electron 另覆盖三语×两状态×两主题×两种宽度共 24 张页面，检查无横向溢出、无外部资源并人工核对紫色卡片样式。页面只报告收到授权或未完成授权，实际连接由应用验证；本轮没有重新授权真实 Google 账号或执行 Drive 双设备同步。

本批最终完整门禁为 1,349 项应用/界面测试及 417 项运行时测试，零失败、零跳过；仓库 verify、独立 typecheck、当前源码 package 与隔离 Xvfb smoke 均通过，冒烟 shell=1 / sites=9 / attached=9。共核对并关闭 25 条模型情报 issue；无关产品/API 公告未直接改写网页适配规则。

Windows/macOS 本轮原生、物理输入法与读屏、真实 Drive 授权及双设备同步、五种发行包安装未验。版本仍为 1.15.0，变更记录在未发布段；本轮仅创建本地提交，没有 push、tag 或发布。

## 2026-10-08 输入框焦点与面板动效验收

隔离 Linux/WSL Electron 使用生产组件、样式、shell preload 与 ViewManager，挂载四个真实 WebContentsView，页面全部为本地合成内容并阻止 HTTP/HTTPS 请求。明暗主题×两种密度×100%/150% 缩放共八组，交替 Overview/Focus，另模拟一次 90ms 主进程布局迟延；缩放在文件导航后设置并复读实际值。

八组均录到展开 4–7 帧、收起 4–6 帧的中间高度，逐帧比较输入区底边与原生网页顶边，没有覆盖；每次展开/收起各一次主进程布局，每个网页整个开合恰好两次 resize。测量证明本机 Chromium 可以连续绘制这类动画，不证明九个真实站点满载时的帧率。输入框仅动画可见容器高度，工具栏和原生网页在边界调整，没有逐帧缩放网页。

可信鼠标/键盘检查涵盖：档位动作保留选区、方向和滚动位置，快速反向保留同一 textarea；工作台和附件关闭后立即 inert、退场中保留网页宽度；宽屏历史列表保留网页可见，阅读详情才覆盖网页，退场结束后恢复且后台正视口不丢失；系统减少动态效果取消过渡和等待，强制颜色保留系统焦点轮廓，Tab 定位采用短底线。明暗实际截图核对无描边浅底、局部柔光及四周淡阴影。

生命周期回归另覆盖退场中重新打开、切换减少动态效果、新确认页面接管后不被迟到退场覆盖，以及保存回包晚于关闭/重开/页面切换时不得导航。既有历史原生断言按新契约检查立即停止交互、退场结束移除；输入框夹具在动画中点击可见区域，保留可信输入和焦点断言，不点击裁剪区域外的最终 textarea 矩形。

原有三语×两密度共六组输入框原生流程及历史 13 条原生流程通过。外壳专项在隔离 Xvfb 显示中通过 96 种布局和交互、对比度检查；夹具显式取得窗口/内容焦点、按实际缩放换算可信指针坐标，并等待点击处理结束后再检查新的聚焦提示，保留悬停圆角的标量证据。共享 WSLg 显示中的悬停断言未通过，不以隔离显示结果替代该路径验收。

本轮最终完整门禁为 1,356 项应用/界面测试及 417 项运行时测试，零失败、零跳过；仓库 verify、当前源码 package 与隔离 Xvfb smoke 均通过，冒烟 shell=1 / sites=9 / attached=9。变更记录在未发布段，版本仍为 1.15.0，未推送或发布。

本轮未测 Windows/macOS 原生、九站实网满载、物理输入法或读屏；本地合成选区不替代物理输入法验证。未发送真实提问、写入正式档案或执行 Drive 同步。
