"use strict";
// 真站脱敏 fixture 上的「模拟改版」回放：只把 history-adapters.js 的两张第 ① 级选择器表在 jsdom 内存里换成不存在的名字
// （不改 fixture 的 DOM），看第 ② 级语义信号 / 第 ③ 级原文锚点能否接上、接上的是不是同一份回答。
// 期望值来自 2026-10-03 九站真机 spike（docs/verify.md「采集定位 spike」）：拿不准的站必须是 null，不得拿错。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ROOT } = require("./lib/desktop-anchors");
const { listFixtures, loadFixture, replayFixture } = require("./lib/dom-replay");

const SOURCE = fs.readFileSync(path.join(ROOT, "desktop/src/site-runtime/history-adapters.js"), "utf8");
const NONE = '"[data-polyask-drift-none]"';
const DRIFTED = SOURCE.replace(/const (users|answerRoots) = \{[\s\S]*?\n {2}\};/g,
  (table) => table.replace(/: (['"])(?:(?!\1).)*\1/g, `: ${NONE}`));
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// semantic/anchor：漂移后整链（ctx 未冻结）依次试出的级别；md：same = 与第 ① 级正文一致，superset = 多带了站点附件
// （豆包语义节点含搜索卡与时间戳），null = 拿不准、返回空；uc：锚点在本页给出的轮次数（2 = 其后还有实质内容，bind 会拒绝）。
// frozenAnchor：把方法冻结为锚点时的结果（第 ② 级先命中的站单独验）。firstTurn：在首页路由上模拟空会话首轮、走 begin/snapshot。
const EXPECT = {
  "claude-single-turn": { chain: "semantic", md: "same", frozenAnchor: { uc: 1, md: "same" } },
  "chatgpt-single-turn": { chain: "anchor", uc: 2, md: "same", firstTurn: { home: "/", owned: false } },
  "gemini-single-turn": { chain: "semantic", md: "same", frozenAnchor: { uc: 2, md: "same" } },
  "deepseek-single-turn": { chain: null, md: null, frozenAnchor: null },
  "doubao-single-turn": { chain: "semantic", md: "superset", frozenAnchor: null },
  "qianwen-single-turn": { chain: "anchor", uc: 1, md: "same", firstTurn: { home: "/", owned: true } },
  "kimi-single-turn": { chain: "anchor", uc: 1, md: "same", firstTurn: { home: "/", owned: true } },
  "yuanbao-single-turn": { chain: null, md: null, frozenAnchor: null },
  "chatglm-single-turn": { chain: null, md: null, frozenAnchor: null }
};

function drift(run) {
  assert.notEqual(DRIFTED, SOURCE, "选择器表替换失败：history-adapters.js 结构变了，先改这里的正则");
  vm.runInContext(`(function () {\n${DRIFTED}\n})()`, run.dom.getInternalVMContext(), { filename: "history-adapters.drifted.js" });
  assert.equal(run.adapter.historyTurn({ method: "selector" }).user, null, "漂移后第 ① 级必须零命中，用例才有意义");
}
function relation(run, turn, expected) {
  const text = turn?.answer ? run.S.toMarkdown(turn.answer) : null;
  if (!text) return null;
  if (text === expected) return "same";
  return text.includes(expected) ? "superset" : "different";
}

const captured = listFixtures().filter((name) => loadFixture(name).meta.source === "captured");
test("every captured fixture has a drift expectation", () => {
  assert.deepEqual(captured.filter((name) => !EXPECT[name]), [], "新采集的 fixture 先在 EXPECT 里登记漂移后的期望");
});

for (const name of captured.filter((item) => EXPECT[item])) {
  const want = EXPECT[name];
  test(`fixture ${name}: selector drift is recovered by level ${want.chain || "none"} without a different answer`, () => {
    const run = replayFixture(name);
    try {
      const level1 = run.adapter.historyTurn();
      assert.equal(level1.locate, "selector");
      const expected = run.S.toMarkdown(level1.answer);
      assert.ok(expected, "第 ① 级必须读出正文");
      const prompt = run.meta.expect.userText;
      drift(run);
      const ctx = { method: null, text: prompt, anchor: true, cache: null };
      const turn = run.adapter.historyTurn(ctx);
      assert.equal(turn.locate ?? null, want.chain);
      assert.equal(ctx.method, null, "historyTurn 只定位不冻结：冻结只在 begin 基线命中或 bind 首次确立用户时发生");
      if (want.chain) assert.equal(run.S.history.normalize(turn.text), prompt);
      if (want.uc) assert.equal(turn.userCount, want.uc);
      assert.equal(relation(run, turn, expected), want.md);
      if ("frozenAnchor" in want) {
        const anchored = run.adapter.historyTurn({ method: "anchor", text: prompt, anchor: true, cache: null });
        if (!want.frozenAnchor) assert.equal(anchored.user, null);
        else {
          assert.equal(anchored.userCount, want.frozenAnchor.uc);
          assert.equal(relation(run, anchored, expected), want.frozenAnchor.md);
        }
      }
    } finally { run.close(); }
  });
}

// 空会话首轮：首页路由上先拿掉本轮问答，begin 后再插回，等 MutationObserver 归属。
// 锚点回答根有稳定 key 走常规读取，没有 key 的等正向结束证据后只读一次；两者都必须与第 ① 级正文一致。
for (const name of captured.filter((item) => EXPECT[item]?.firstTurn)) {
  const want = EXPECT[name].firstTurn;
  test(`fixture ${name}: first turn on a drifted page ${want.owned ? "is owned by the anchor" : "stays unowned"}`, async () => {
    const fixture = loadFixture(name);
    const expectedRun = replayFixture(fixture);
    let expected;
    try { expected = expectedRun.S.toMarkdown(expectedRun.adapter.historyTurn().answer); } finally { expectedRun.close(); }
    const run = replayFixture(fixture, { path: want.home });
    try {
      const user = run.document.querySelector('[data-polyask-expect~="user"]');
      const root = run.document.querySelector('[data-polyask-expect~="answer-root"]');
      let shared = user.parentElement;
      while (!shared.contains(root)) shared = shared.parentElement;
      const turns = [...shared.children].filter((child) => child.contains(user) || child.contains(root));
      for (const node of turns) node.remove();
      drift(run);
      run.S.history.begin("tok", fixture.meta.expect.userText, Date.now() + 44_000, { images: 0 });
      for (const node of turns) shared.append(node);
      await tick();
      let snapshot = run.S.history.snapshot("tok");
      if (want.owned && snapshot.text === undefined) {
        // 无 key 的锚点根只认正向结束证据：见过停止键、之后它消失且回答容器 2 秒无变动，才读一次。
        run.adapter.generation = () => "generating";
        run.S.history.snapshot("tok");
        run.adapter.generation = () => null;
        const now = run.window.Date.now;
        run.window.Date.now = () => now() + 2_100;
        try { snapshot = run.S.history.snapshot("tok"); } finally { run.window.Date.now = now; }
      }
      assert.equal(snapshot.owned, want.owned);
      if (want.owned) {
        assert.equal(snapshot.locate, "anchor");
        assert.equal(snapshot.text, expected);
        assert.equal(run.S.history.submitted("tok"), false, "锚点命中不作 submissionEvidence=message 的证据");
      }
    } finally { run.close(); }
  });
}
