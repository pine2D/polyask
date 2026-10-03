# 脱敏 DOM fixture（离线回放）

这里放站点对话区的**脱敏** DOM 快照，用于在 jsdom 里回放生产 site-runtime 的定位与序列化，把“拿错、拿少”挡在发版前。
它和 `desktop/test/fixtures/`（同步线格式，只增不改）无关：这里的用例随站点改版重采、替换。

仓库是公开的。入库前 `npm test` 里的 `scripts/dom-fixture-scan.test.js` 会逐个扫描本目录，任何一项不合格都会红。

## 文件格式

每个用例一对同名文件，文件名只用小写字母、数字和短横线（如 `kimi-thinking.html` + `kimi-thinking.json`）。目录里不允许子目录或其它文件（本 README 除外）。

- `<name>.html`：对话区子树的脱敏 HTML，回放时整体放进 `<body>`。
- `<name>.json`：元数据，键只允许下面这些：

| 键 | 含义 |
| --- | --- |
| `schema` | 固定为 `1` |
| `host` | 九站之一的精确 host（取自 `desktop/src/main/sites.ts`，如 `www.kimi.com`） |
| `path` | 采集时的路径，会话 id 已换成 `id-N`；回放时 `location` 设为 `https://<host><path>`，`history.js` 的 `route()` 首页/会话页判定与真站一致 |
| `promptToken` | 问题原文的替身（默认 `POLYASK_PROMPT`）；多行问题第 i 行为 `<token>-Li` |
| `source` | `captured`（CDP 采集）或 `synthetic`（手写，仅证明工具可用） |
| `capturedAt` | 采集日期 `YYYY-MM-DD`（可选） |
| `note` | 一句 ASCII 备注（可选，≤200 字符） |
| `expect` | 生产 `historyTurn()` 在采集时的结果：`userCount`、`userText`（token 文本或 `null`）、`answer`、`answerRoot`（布尔），可选 `locate`（`selector` / `semantic`：命中的是第 ① 级逐站选择器还是第 ② 级语义信号；无 ctx 调用不走第 ③ 级原文锚点） |
| `stats` | 脱敏统计（元素数、文本数、token 命中数等，只有数字和布尔） |

HTML 里用 `data-polyask-expect` 标记期望节点，取值为 `user` / `answer` / `answer-root`，可用空格组合。标记由采集脚本根据生产 `historyTurn()` 的返回打上，回放测试 `scripts/dom-fixture-replay.test.js` 会逐个 fixture 核对：`userCount`、`text` 等于 token，`user`、`answer`、`answerRoot` 分别是被标记的节点。

## 脱敏规则（`scripts/lib/dom-fixture-sanitize.js`）

- 标签名保留。`script`、`style`、`iframe`、`link`、`meta` 等整棵丢弃；`svg` 只留空标签，不留 path 数据。
- 属性白名单：`class`（逐个类名过滤，含 URL 或长 id 形状的丢弃）、`id`（只留人写的语义名）、`role`、`aria-hidden`、`contenteditable`、`hidden`、`data-testid` 及 site-runtime 选择器按值匹配的角色类 `data-*`（`data-message-author-role`、`data-turn`、`data-conversation-role`、`data-markdown-text-style`、`data-message-role`、`data-author-role`、`data-role`、`data-author`、`data-sender`；值须是短标识符，否则照样换占位）。
- 其它 `data-*` 只留键，值换成本 fixture 内稳定的 `id-N`：同值同占位，保住 `data-message-id` 这类 key 的相等语义；空值和 `true`/`false` 原样保留。
- `aria-label` 换成 `label-N`；`style`、`src`、`href`、`srcset`、`alt` 等一律丢弃。
- 活页面上 computed `display:none` 的元素补一个 `hidden`，回放时 `md.js` 的剔除逻辑才不失真。
- 文本节点全部换成小写 lorem 占位（只用脱敏器 FILLER 词表里的词，扫描门禁逐词核对），只保留粗略长度档；与问题原文逐字相等（空白归一后）的文本节点换成 token。答案里逐字复述问题时同样会被换成 token，保留真实页面上“同文多处”的歧义。

扫描门禁另外拒收：URL（`http(s)://`、`www.`、协议相对地址、`blob:`、data URI）、邮箱、≥11 位的电话形数字、UUID、≥24 位 hex、≥32 位 base64 形串、JWT、常见 API token 前缀，以及白名单外的属性、不是占位词的文本和注释。

## 采集

1. 启动开发态并只监听本机：`cd desktop && npm start -- -- --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`。
2. 在目标站点打开一条**已完成生成**的测试对话。问题用纯 ASCII 的合成短句，不含个人信息；问题文本记在本机临时文件里。
3. 运行（`--host` 可写 host 或站点 key）：

   ```bash
   cd desktop
   node scripts/capture-dom-fixture.mjs --host kimi --name kimi-basic --prompt-file /path/to/prompt.txt [--root main] [--dry-run]
   ```

   脚本先在主帧的 `Electron Isolated Context` 只读调用生产 `historyTurn()`，把本轮节点换算成元素路径；再在主世界注入脱敏器输出 HTML。两段之间 DOM 有变化、历史快照没绑定到这条问题、问题原文在 DOM 里找不到、节点超过 20000 个被截断、或扫描不过时，一律不写文件。已有同名文件时拒绝覆盖，需要显式加 `--force`。
4. 入库前人工看一遍 diff，再跑 `npm test`。

脚本不发问、不点击、不切档，只读 DOM。

## 回放

`scripts/lib/dom-replay.js` 的 `replayFixture(name)` 把 fixture 装进 jsdom，按 `desktop/src/preload/site.ts` 的真实 require 顺序逐文件运行 site-runtime（新登记的卷会自动纳入），返回 `{ window, document, S, adapter, send, close }`。`send()` 走 `core.js` 的消息入口（如 `collectAnswer`）。用完必须调用 `close()`，否则 `history.begin` 的定时器会让测试进程不退出。

jsdom 没有布局：`innerText` 退化为 `textContent`，`getBoundingClientRect` 恒为 0。依赖几何的判定（停止键可见性等）不在回放范围内。
