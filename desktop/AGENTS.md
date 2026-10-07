# Desktop 测试资源防护

继承仓库约定。2026-10-07 的测试曾因 Node 展开 React DOM 并计算断言差异耗尽 WSL 内存，以下规则适用于新增、修改和运行测试。

- 不把 DOM 节点、Window、节点集合或含节点的对象直接交给 `assert.equal/strictEqual/deepEqual` 等比较。存在性用 `assert.equal(el === null, true, message)`；焦点/身份用 `assert.equal(document.activeElement === el, true, message)`；内容只比较字符串、数值或布尔属性。保留 `null` 与 `undefined` 的区别，不用宽泛真假值替代严格身份。
- 不在失败路径打印整个 DOM、React Fiber 或带节点的错误载荷。自定义 message 与 V8 堆上限都不能阻止原生差异算法内存暴涨。
- 全套使用 `npm test`；单文件使用 `npm run test:unit -- test/example.test.tsx` 或 `npm run test:runtime -- scripts/example.test.js`。专项 `.check.ts` 同样经 `test:unit` 入口。禁止绕过 `scripts/test-safe.mjs` 直接运行 jsdom/React RED 测试。
- 本机 Linux 原生 UI 专项必须在临时 cgroup 下运行；现有 `test:shell-ui` / `test:library-ui` 已接入。其他专项用 `node scripts/test-safe.mjs command node scripts/example.mjs`。cgroup 不可用时先解决环境，不降为无资源上限执行。
- 静态检查先于测试；运行时断言保护必须预加载。测试单 worker、V8 旧生代 1 GiB，Linux 优先整组 4 GiB 内存/512 MiB swap；无 systemd 的离线 Node 门禁使用继承的每进程 2 GiB RLIMIT_DATA，这不是整组上限。Windows/macOS 尚无此 OS 级限额，不声称等效。
- 防护回归使用小型合成对象和标量断言，不用真实巨大 DOM/多 GiB 分配重演事故；资源失败后查原因，不自动反复重跑。执行及验收边界见仓库 `docs/verify.md`。
