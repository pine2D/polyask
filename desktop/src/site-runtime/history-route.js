// desktop/src/site-runtime/history-route.js — 逐次提问副本的路由与归属辅助（history.js 之前注入）：问题原文归一化、
// 会话路由判定（首页 / 临时地址）、豆包新会话 local_ → 正式 id 的一次性迁移（rebase）与首问绑定的路由守卫。
// 只读同步：不改 DOM、不开菜单、不产文案；对本轮 entry 的改写与结束都由 history.js 传入的 stop() 收口。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const DOUBAO = /^(?:www\.)?doubao\.com$/;
  function callSpacing(value) {
    let output = "", quote = null, classDepth = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (quote) {
        output += char;
        if (char === "\\" && i + 1 < value.length) output += value[++i];
        else if (quote === "/" && char === "[") classDepth++;
        else if (quote === "/" && char === "]") classDepth = Math.max(0, classDepth - 1);
        else if (char === quote && !classDepth) quote = null;
        continue;
      }
      if ('"\'`/'.includes(char)) quote = char;
      // 2026-10-06 真机：print("x") 被排成 print ("x")。引号/正则内（含未闭合文本）不容忍此差异。
      if (char === " " && /[A-Za-z0-9_]/.test(value[i - 1] || "") && value[i + 1] === "(") continue;
      output += char;
    }
    return output;
  }
  const normalize = text => {
    let value = String(text || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
    // Doubao inserts typography spaces between Han and other glyphs in user bubbles,
    // including quotes (`有没有 "x" 的`, 2026-10-03). Preserve English word spacing,
    // numeric spacing and all substantive text.
    if (DOUBAO.test(location.hostname)) value = callSpacing(value)
      .replace(/(\p{Script=Han}) +(?=\S)/gu, "$1")
      .replace(/(\S) +(?=\p{Script=Han})/gu, "$1");
    return value;
  };
  const same = (node, key, other, otherKey) => key && otherKey ? key === otherKey : node === other;
  function route() {
    const url = new URL(location.href);
    const cid = url.hostname === "chatglm.cn" ? url.searchParams.get("cid") : null;
    // ChatGPT first renders local-chatgpt:<id> (often URL-encoded), then settles
    // to the server conversation. Neither provisional format locks ownership.
    // Doubao (NavigateBeforeSend, 2026-10-04) pushes /chat/local_<digits> for a new chat, then replaces it
    // with /chat/<server id> once the send is acknowledged; the local id does not lock ownership either.
    const local = DOUBAO.test(url.hostname) && /^\/chat\/local_\d+$/.test(url.pathname);
    const provisional = local || (url.hostname === "chatgpt.com" && /^\/c\/(?:WEB|local-chatgpt)(?::|%3a)[a-zA-Z0-9_-]+$/i.test(url.pathname));
    return { id: url.origin + url.pathname + (cid ? "?cid=" + cid : ""), local,
      home: !cid && (provisional || (url.hostname === "yuanbao.tencent.com" && /^\/chat\/[^/]+\/?$/.test(url.pathname)) || /^\/(?:new|app|agent|chat\/?|main\/alltoolsdetail)?$/.test(url.pathname)) };
  }
  // 豆包新会话首问的 local_ → 正式 id 迁移（一次）。D4 第 3 轮 Windows 真机（2026-10-04）：local_ 上绑定后 2.6–5.25 s 页面
  // replaceState 到 /chat/<数字>，再过 315–665 ms 把用户节点整体换成新节点（旧节点脱离、互不包含；新节点插入时已带
  // data-message-id，同一批第 ① 级已命中）。所以「原地补 key、节点不换」的前提不成立，放行条件全部满足才迁移：
  // ① 地址从已记录的 local_ 换到豆包 /chat/<数字>，且仍是同一个历史槽位（Navigation API currentEntry.key：replace 留槽、
  //    push/traverse 换槽）。假定侧栏打开别的会话是 push（未实测，靠 ②③ 兜底），照旧结束；拿不到 key 时 fail-closed 结束。
  // ② 地址与换节点都在绑定后 LOCAL_MIGRATE_MS 内：最慢是九站群发 t3-all9（绑定→换节点 5.92 s；单站 T1 最长 5.18 s），延迟随负载
  //    增长（豆包在发送管线结束时才 replace），取 10 s（对 5.92 s 约 69% 余量，与 Kimi 首屏迁移同值），勿按单站数据收窄。
  // ③ 新用户节点同文（normalize 后）、全页恰好 1 条用户轮次（userCount 由 bind() 再按基线复核）。
  // ④ local_ 阶段可能已锁了旧节点的回答根：换节点时清空，由新一轮定位重新确立（promote 随即升到第 ① 级）。
  // 迁移后 routeId 锁在正式 id；之后再换地址（checkRoute）或再换一次节点（这里）都结束。返回 true 表示刚换了用户节点。
  const DOUBAO_CHAT = /^https:\/\/(?:www\.)?doubao\.com\/chat\/\d+$/;
  const LOCAL_MIGRATE_MS = 10_000;
  function slot() {
    try { const key = window.navigation?.currentEntry?.key; return typeof key === "string" && key ? key : null; } catch (_) { return null; }
  }
  function rebase(e, turn, stop) {
    if (e.ended || !e.localId || !e.user) return false;
    const current = route();
    if (!e.routeId) {
      if (current.id === e.localId) return false;
      if (!DOUBAO_CHAT.test(current.id) || !e.localSlot || slot() !== e.localSlot || Date.now() - e.boundAt > LOCAL_MIGRATE_MS) { stop(e); return false; }
      e.routeId = current.id; e.swapUntil = e.boundAt + LOCAL_MIGRATE_MS;
    }
    // 换了地址交给 checkRoute 结束；节点还在、或还没定位到新节点（重渲染中）时不判，期间 bind() 不归属任何内容。
    if (e.routeId !== current.id || e.user.isConnected || !turn?.user || same(e.user, e.userKey, turn.user, turn.userKey)) return false;
    // 原文锚点按本次问题找节点，同文校验是循环论证，不能给换节点作证。
    if (Date.now() > e.swapUntil || turn.locate === "anchor" || turn.userCount !== 1 || normalize(turn.text) !== e.text) { stop(e); return false; }
    e.user = turn.user; e.userKey = turn.userKey || null; e.swapUntil = 0;
    e.answer = null; e.answerRoot = null; e.answerKey = null;
    return true;
  }
  // 豆包首问只在首页（/chat/）或本轮的 local_ 上确立用户（F5，2026-10-04 审查）：begin 在首页时页面若在绑定前被推到任何
  // /chat/<id>（侧栏点开同文单轮旧会话、或页面自己跳到旧会话），那里的用户与回答都不属于本轮；local_ 之外的正式 id 只能经
  // rebase() 迁移到达（它要求先在 local_ 上绑定）。begin 本身就在 local_ 上（上一轮新会话还没拿到正式 id）时，只认那一个 local_。
  // begin 时已锁会话地址（已有会话里的追问）不受此限，checkRoute 保证地址不变。宁可整轮不取（副本 unavailable）也不取错。
  // 例外：begin 在卡住的 local_ 上（后台页首问 2 分钟后仍是 local_，u1-doubao-4-bgpage-think）追问时，local_ 可能先被原地 replace 成
  // 正式 id、追问气泡后到。同一历史槽位（begin 时记下的 Navigation key，replace 留槽、push 换槽）里的豆包 /chat/<数字> 放行；拿不到 key 照旧结束。
  function freshBind(e) {
    if (!DOUBAO.test(location.hostname) || e.routeId) return true;
    const current = route();
    if (!current.home) return !!e.beginLocal && DOUBAO_CHAT.test(current.id) && !!e.beginSlot && slot() === e.beginSlot;
    return !current.local || !e.beginLocal || current.id === e.beginLocal;
  }
  // 首页（/chat/）上直接绑定后第一次离开首页：local_（push）照常等 rebase()；正式 id 只认同槽 replace（e.boundSlot 在首页绑定时记下），
  // push 到别的 /chat/<id>（同文单轮旧会话）时，bind() 的乐观替换分支会换绑过去、再把 routeId 锁成旧会话，返回 true 由 checkRoute 结束。
  function leftHome(e) {
    if (!DOUBAO.test(location.hostname) || e.routeId || e.localId || !e.user) return false;
    const current = route();
    return !current.home && !(DOUBAO_CHAT.test(current.id) && !!e.boundSlot && slot() === e.boundSlot);
  }
  S.historyRoute = { normalize, same, route, slot, rebase, freshBind, leftHome };
}());
