"use strict";
// 豆包新会话首问副本（D4，2026-10-04 Windows 真机 6/6 复现）：先推入 /chat/local_<digits>，用户气泡还没有 data-message-id，
// 第 ① 级零命中、首次 bind 冻结为第 ② 级语义；约 2–4 s 后用户节点的 message_action_bar 补插 <time>今天 16:20</time>，
// 语义级用户文本变成「原文 + 今天16:20」，bind() 判原文不符结束本轮 → 副本 0 字。第 3 轮真机实测的后续序列：replace 到
// /chat/<id> → 315–665 ms 后用户节点被整体换成新节点（带 data-message-id），经 rebase() 迁移；原地补 key 作为变体保留。
// 页面结构取自 fixtures-dom/doubao-single-turn.html 的真实属性（send_message / receive_message / message_content /
// message_text_content / message_action_bar），在 jsdom 里跑整条 preload 链。
const assert = require("node:assert/strict");
const test = require("node:test");
const { replayHtml } = require("./lib/dom-replay");

const PROMPT = "PolyAsk 测试 R5O：请用一句话解释彩虹是怎么形成的。";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const PAGE = '<main class="chat"><div class="message-list"><div class="list_items"></div></div>'
  + '<div class="composer"><textarea data-testid="chat_input_input"></textarea></div></main>';
const USER = '<div class="v_list_row"><div data-testid="union_message"><div data-testid="send_message" data-message-role="user" class="flex flex-row w-full justify-end">'
  + '<div class="flex flex-col"><div data-testid="message_content" class="flex-row flex w-full justify-end">'
  + `<div class="content-KTJ1Rj"><div data-testid="message_text_content" class="container-qX9Csx md-box-root"><div class="container-enLQFx">${PROMPT}</div></div></div></div>`
  + '<div class="select-none"><div class="flex flex-col justify-end h-40" data-testid="message_action_bar"></div></div></div></div></div></div>';
const ANSWER = '<div class="v_list_row"><div data-testid="union_message"><div data-testid="receive_message" data-message-role="assistant" class="flex flex-row w-full group">'
  + '<div class="flex flex-col"><div data-testid="message_content" class="relative grid w-full">'
  + '<div data-copy-ignore class="think-head">已完成思考</div>'
  + '<div data-testid="message_text_content" data-streaming="true" class="container-qX9Csx md-box-root"><p>阳光射入水滴</p></div></div>'
  + '<div data-testid="message_action_bar"></div></div></div></div></div>';

function withRun(body) {
  const run = replayHtml(PAGE, { host: "www.doubao.com", path: "/chat/" });
  return Promise.resolve().then(() => body(run)).finally(() => run.close());
}
function append(run, html) {
  const box = run.document.createElement("div");
  box.innerHTML = html;
  run.document.querySelector(".list_items").append(...box.children);
}
// 首问起步：begin → push local_ → 用户与回答节点（尚无 data-message-id）插入 → 第 ② 级绑定。
async function firstTurn(run, html = USER + ANSWER) {
  run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
  run.window.history.pushState(null, "", "/chat/local_6289182192238156");
  append(run, html);
  await tick();
  const bound = run.S.history.snapshot("tok");
  assert.deepEqual({ owned: bound.owned, locate: bound.locate }, { owned: true, locate: "semantic" }, "local_ 阶段由第 ② 级接住");
}
const stamp = (run) => {
  const time = run.document.createElement("time");
  time.textContent = "今天 16:20";
  run.document.querySelector('[data-message-role="user"] [data-testid="message_action_bar"]').append(time);
};

test("Doubao new chat: the action-bar <time> inserted after binding does not end the first prompt's copy", () =>
  withRun(async (run) => {
    await firstTurn(run);
    stamp(run);
    await tick();
    const stamped = run.S.history.snapshot("tok");
    assert.equal(stamped.ended, undefined, "时间戳不是用户原文，不得判原文不符");
    assert.equal(stamped.owned, true);
    assert.equal(run.S.historyLocate.locate({ method: "semantic" }).text.replace(/\s+/g, " ").trim(), PROMPT, "第 ② 级用户文本只取正文");
  }));

test("Doubao new chat: local_ → /chat/<id> with late data-message-id promotes once to level one and keeps the copy end to end", () =>
  withRun(async (run) => {
    await firstTurn(run);
    stamp(run);
    await tick();
    // 服务端确认：replace 到正式会话地址，原节点补上 data-message-id（属性变更不触发 childList 观察，下一次快照读时接管）。
    run.window.history.replaceState(null, "", "/chat/38445541558442754");
    const [user, answer] = run.document.querySelectorAll('[data-testid="message_content"]');
    user.setAttribute("data-message-id", "57495761471870721");
    answer.setAttribute("data-message-id", "57495761471870722");
    const promoted = run.S.history.snapshot("tok");
    assert.deepEqual({ owned: promoted.owned, locate: promoted.locate, text: promoted.text }, { owned: true, locate: "selector", text: "阳光射入水滴" },
      "第 ① 级接管后只读 .md-box-root，思考头不进副本");
    assert.equal(promoted.url, "https://www.doubao.com/chat/38445541558442754");
    const body = answer.querySelector('[data-testid="message_text_content"]');
    body.querySelector("p").textContent = "阳光射入水滴后经折射、反射再折射，分解成七色光，形成彩虹。";
    body.setAttribute("data-streaming", "false");
    await tick();
    const final = run.S.history.snapshot("tok");
    assert.deepEqual({ owned: final.owned, text: final.text, locate: final.locate },
      { owned: true, text: "阳光射入水滴后经折射、反射再折射，分解成七色光，形成彩虹。", locate: "selector" });
    assert.equal(run.S.history.submitted("tok"), true);
    run.window.history.pushState(null, "", "/chat/99999999999999999");
    assert.equal(run.S.history.snapshot("tok").ended, true, "正式会话地址已锁定：离开即结束");
  }));

// D4 第 3 轮 Windows 真机（t1-doubao-2..5，2026-10-04）的真实序列：local_ 上第 ② 级绑定 → 2.6–4.7 s 后 replaceState 到 /chat/<17 位 id>
// → 315–625 ms 后豆包把用户节点整体换成新节点（旧节点脱离、互不包含），新节点插入时已带 data-message-id，同一批 ① 已命中。
// 旧实现在这一批 stop()（local_ 守卫：地址未锁且旧节点脱离），副本 unavailable。
const SERVER = "/chat/38445542823827970";
const keyed = (html, id) => html.replace('data-testid="message_content"', `data-testid="message_content" data-message-id="${id}"`);
function swapRows(run, answer = "阳光射入水滴", id = 24533762) {
  run.document.querySelector(".list_items").innerHTML = "";
  append(run, keyed(USER, String(id)) + keyed(ANSWER.replace("阳光射入水滴", answer), String(id + 1)));
}
const EMPTY = ANSWER.replace("<p>阳光射入水滴</p>", "").replace('<div data-copy-ignore class="think-head">已完成思考</div>', "");
for (const variant of ["same batch, answer locked on local_", "interim batch, no answer yet", "snapshot before the observer runs"]) {
  test(`Doubao new chat: local_ → server id replace followed by a user-node swap migrates once (${variant})`, () =>
    withRun(async (run) => {
      // 第 1 种：local_ 阶段快照已锁回答根（e.answer 已置位）；第 2 种：local_ 阶段回答仍空，replace 后、换节点前还有一批变动。
      await firstTurn(run, variant.startsWith("interim") ? USER + EMPTY : USER + ANSWER);
      stamp(run);
      await tick();
      run.window.history.replaceState(null, "", SERVER);
      if (variant.startsWith("interim")) {
        run.document.querySelector('[data-testid="receive_message"] [data-testid="message_text_content"]').innerHTML = "<p>阳光</p>";
        await tick();
        assert.equal(run.S.history.snapshot("tok").owned, true, "replace 后、换节点前副本仍归属本轮");
      }
      const old = run.document.querySelector('[data-message-role="user"]');
      swapRows(run);
      assert.equal(old.isConnected, false);
      if (!variant.startsWith("snapshot")) await tick();
      const migrated = run.S.history.snapshot("tok");
      assert.deepEqual({ owned: migrated.owned, ended: migrated.ended, locate: migrated.locate, text: migrated.text, url: migrated.url },
        { owned: true, ended: undefined, locate: "selector", text: "阳光射入水滴", url: `https://www.doubao.com${SERVER}` },
        "换节点后迁移到正式会话并升到第 ① 级，思考头不进副本");
      const body = run.document.querySelector('[data-message-id="24533763"] [data-testid="message_text_content"]');
      body.querySelector("p").textContent = "阳光射入水滴后经折射、反射再折射，形成彩虹。";
      await tick();
      assert.equal(run.S.history.snapshot("tok").text, "阳光射入水滴后经折射、反射再折射，形成彩虹。");
      assert.equal(run.S.history.submitted("tok"), true);
      // 同一 data-message-id 的重渲染仍是同一条消息，不算换节点。
      swapRows(run, "阳光射入水滴后经折射、反射再折射，形成彩虹。");
      await tick();
      assert.equal(run.S.history.snapshot("tok").owned, true, "同 key 重渲染不结束");
      // 只迁移一次：再换成另一个节点（同文、单轮、不同 key）即结束，旧副本不被新节点的回答覆盖。
      swapRows(run, "第二次换节点的回答", 24533800);
      await tick();
      const again = run.S.history.snapshot("tok");
      assert.deepEqual({ owned: again.owned, ended: again.ended }, { owned: false, ended: true });
    }));
}

test("Doubao new chat: after migrating to the server id, a second replace to another id ends the copy", () =>
  withRun(async (run) => {
    await firstTurn(run);
    run.window.history.replaceState(null, "", SERVER);
    swapRows(run);
    await tick();
    assert.equal(run.S.history.snapshot("tok").locate, "selector");
    run.window.history.replaceState(null, "", "/chat/38445542823827999");
    assert.equal(run.S.history.snapshot("tok").ended, true, "第二次迁移一律结束");
  }));

test("Doubao new chat: a replace to the server id without the Navigation API fails closed", () =>
  withRun(async (run) => {
    delete run.window.navigation;
    await firstTurn(run);
    run.window.history.replaceState(null, "", SERVER);
    swapRows(run);
    await tick();
    assert.deepEqual({ owned: run.S.history.snapshot("tok").owned, ended: run.S.history.snapshot("tok").ended }, { owned: false, ended: true },
      "拿不到历史槽位就分不清 replace 与 push，按旧行为结束");
  }));

test("Doubao new chat: a level-one bubble outside the bound user never takes over the turn", () =>
  withRun(async (run) => {
    await firstTurn(run, USER);
    // 回答未出现（没有已锁回答根可比）时，选择器数到「1 条用户、同文」，但它不在已绑定的用户节点里：不得据此换绑。
    append(run, `<div data-message-id="x-1" class="justify-end"><div data-testid="message_text_content">${PROMPT}</div></div>`);
    await tick();
    assert.equal(run.adapter.historyTurn({ method: "selector" }).userCount, 1, "噪声让第 ① 级恰好数到 1，用例才有意义");
    const snapshot = run.S.history.snapshot("tok");
    assert.deepEqual({ owned: snapshot.owned, locate: snapshot.locate }, { owned: true, locate: "semantic" });
  }));

test("generic level two: <time> and action-bar subtrees are not part of the user text", () => {
  const run = replayHtml('<main><div class="thread">'
    + `<div data-message-author-role="user" data-message-id="u-1"><p>${PROMPT}</p><div class="msg-actions"><time>10:20</time><span>Edited</span></div></div>`
    + '<div data-message-author-role="assistant" data-message-id="a-1"><div class="markdown"><p>ok</p></div></div>'
    + '</div><div class="composer"><div contenteditable="true"></div></div></main>', { host: "www.kimi.com", path: "/chat/id-1" });
  try {
    const turn = run.S.historyLocate.locate({ method: "semantic" });
    assert.equal(run.S.history.normalize(turn.text), run.S.history.normalize(PROMPT));
  } finally { run.close(); }
});

test("Doubao level one reads only the single message text container of the user bubble", () => {
  const run = replayHtml(PAGE, { host: "www.doubao.com", path: "/chat/38445541558442754" });
  try {
    append(run, USER + ANSWER);
    const [user, answer] = run.document.querySelectorAll('[data-testid="message_content"]');
    user.setAttribute("data-message-id", "u-1");
    answer.setAttribute("data-message-id", "a-1");
    // 正文容器之外的同节点内容（时间戳、发送状态位）不进用户文本。
    user.insertAdjacentHTML("beforeend", '<div data-send-message-status="true"><time>今天 16:20</time></div>');
    const turn = run.adapter.historyTurn({ method: "selector" });
    assert.equal((turn.user) === (user), true);
    assert.equal(run.S.history.normalize(turn.text), run.S.history.normalize(PROMPT));
  } finally { run.close(); }
});

// local_ 不锁归属：离开它只能经 rebase() 迁移（同一 Navigation API 槽位、绑定后 10 s 内、同文、uc=1，仅一次）。回答仍空（深度思考中、e.answer 未置位）时用户在侧栏点开一个同文单轮旧会话，
// 乐观替换分支曾换绑过去、promote 再升到第 ① 级，把旧会话的回答记成本轮副本（审查复现，2026-10-04）。
for (const order of ["address first", "DOM first"]) test(`Doubao new chat: navigating from local_ to another same-text single-turn conversation ends the copy (${order})`, () =>
  withRun(async (run) => {
    const empty = ANSWER.replace("<p>阳光射入水滴</p>", "").replace('<div data-copy-ignore class="think-head">已完成思考</div>', "");
    await firstTurn(run, USER + empty);
    if (order === "address first") run.window.history.pushState(null, "", "/chat/11111");
    run.document.querySelector(".list_items").innerHTML = "";
    append(run, USER + ANSWER.replace("阳光射入水滴", "昨天的旧回答"));
    await tick();
    if (order === "DOM first") run.window.history.pushState(null, "", "/chat/11111");
    const [user, answer] = run.document.querySelectorAll('[data-testid="message_content"]');
    user.setAttribute("data-message-id", "old-u");
    answer.setAttribute("data-message-id", "old-a");
    await tick();
    const snapshot = run.S.history.snapshot("tok");
    assert.equal(snapshot.text ?? null, null, "别的会话的回答不得记成本轮副本");
    assert.deepEqual({ owned: snapshot.owned, ended: snapshot.ended }, { owned: false, ended: true });
  }));

// Chromium：display:none 的元素 innerText 退回 textContent，外层 innerText 却不含它。hover 前隐藏的操作条文字恰好也在原文里时，
// 按字符串删会删掉原文那一段，第 ② 级用户文本对不上、副本丢失。jsdom 的 innerText 只是 textContent，这里按真实语义补上。
test("generic level two: a hidden action bar whose label also appears in the prompt leaves the prompt intact", () => {
  const prompt = "请把这段话复制成三种语气";
  const run = replayHtml('<main><div class="thread">'
    + `<div data-message-author-role="user" data-message-id="u-1"><p>${prompt}</p><div class="msg-actions"><span>复制</span></div></div>`
    + '</div><div class="composer"><div contenteditable="true"></div></div></main>', { host: "www.kimi.com", path: "/chat/id-1" });
  try {
    const user = run.document.querySelector('[data-message-author-role="user"]');
    const bar = user.querySelector(".msg-actions");
    Object.defineProperty(user, "innerText", { configurable: true, get: () => prompt });
    user.checkVisibility = () => true;
    bar.checkVisibility = () => false;
    assert.equal(run.S.history.normalize(run.S.historyLocate.locate({ method: "semantic" }).text), prompt);
    bar.checkVisibility = () => true; // 渲染中的操作条照常剔除
    Object.defineProperty(user, "innerText", { get: () => prompt + "\n复制" });
    assert.equal(run.S.history.normalize(run.S.historyLocate.locate({ method: "semantic" }).text), prompt);
  } finally { run.close(); }
});

// D1（2026-10-05 Windows 第五轮）：首页弹出「下载电脑版」推广弹窗（Radix Dialog）时，aria-hidden 库的 hideOthers 给 <main>
// 加 aria-hidden="true" 并打 data-aria-hidden 标记；排除区把它当隐藏子树，local_ 阶段第 ② 级零命中，副本封存为 unavailable。
// 带标记的 aria-hidden 是「弹窗期间对读屏让位」，不是隐藏内容；不带标记的 aria-hidden 仍照旧排除。
const modal = (run, marker) => {
  const main = run.document.querySelector("main");
  main.setAttribute("aria-hidden", "true");
  if (marker) main.setAttribute("data-aria-hidden", "true");
  const dialog = run.document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.textContent = "下载电脑版";
  run.document.body.append(dialog);
};

test("Doubao new chat: a Radix modal hiding <main> (data-aria-hidden) does not block first-prompt binding", () =>
  withRun(async (run) => {
    modal(run, true);
    await firstTurn(run);
    assert.match(run.S.history.snapshot("tok").text, /阳光射入水滴/);
  }));

test("Doubao new chat: aria-hidden without the modal marker still fences the subtree", () =>
  withRun(async (run) => {
    modal(run, false);
    run.S.history.begin("tok", PROMPT, Date.now() + 44_000, { images: 0 });
    run.window.history.pushState(null, "", "/chat/local_6289182192238156");
    append(run, USER + ANSWER);
    await tick();
    assert.notEqual(run.S.history.snapshot("tok").owned, true);
  }));

// aria-hidden 包对原本就 aria-hidden 的同层节点也照打 data-aria-hidden（1.2.6 源码）：标记分不出新旧，
// 只有包住输入框的那层（<main>）豁免；<main> 之外带标记的隐藏区里的用户节点仍不参与定位。
test("Doubao new chat: a marked aria-hidden region outside the composer column stays fenced during the modal", () =>
  withRun(async (run) => {
    modal(run, true);
    const stale = run.document.createElement("div");
    stale.setAttribute("aria-hidden", "true");
    stale.setAttribute("data-aria-hidden", "true");
    stale.innerHTML = '<div data-testid="send_message" data-message-role="user">隐藏区里的旧提问</div>';
    run.document.body.append(stale);
    await firstTurn(run);
    assert.match(run.S.history.snapshot("tok").text, /阳光射入水滴/);
  }));
