// 逐次提问只读快照：归属不明确就停止，不以最后一条回答猜测本轮。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S?.historyRoute) return;
  // 路由判定、原文归一化与豆包 local_ 迁移在 history-route.js（按 300 行上限拆出，preload 先于本卷注入）。
  const { normalize, same, route, slot, freshBind, leftHome } = S.historyRoute;
  const rebase = (e, turn) => S.historyRoute.rebase(e, turn, stop);
  let entry = null;
  // 一批 MutationObserver 回调里定位 + 绑定超过它算一次卡顿（Linux 实测 1.25–1.46s，Windows 最大 98.7ms，2026-10-04）。
  const SLOW_MS = 250;
  const adapter = () => Object.entries(S.adapters || {}).find(([host]) =>
    location.hostname === host || location.hostname.endsWith("." + host))?.[1];
  function wasInserted(e, user) {
    for (let node = user; node; node = node.parentNode) if (e.inserted.has(node)) return true;
    return false;
  }
  function stop(e) {
    e.ended = true; e.observer?.disconnect(); if (e.timer) clearTimeout(e.timer); if (e.soft) clearTimeout(e.soft); e.inserted = new WeakSet();
    for (const [target, name, handler] of e.listeners || []) target.removeEventListener?.(name, handler, true);
    e.listeners = [];
  }
  const KIMI_CHAT = /^https:\/\/(?:www\.)?kimi\.com\/chat\/[^/]+$/;
  function checkRoute(e, turn) {
    const current = route();
    if (e.routeId && e.routeId !== current.id) {
      // Kimi replaces its first optimistic chat URL before the server answer, and in the same batch
      // replaces the optimistic user node (2026-10-03). One migration is allowed for the first turn of an
      // empty conversation with no answer yet: the same connected user, or a disconnected one replaced by a
      // node with the exact prompt text and a unique turn count. No located turn yet (throttled anchor walk,
      // re-render in progress) defers the decision instead of ending the copy; nothing is attributed meanwhile.
      // A replaced node only counts shortly after binding (observed ~50 ms; 10 s leaves wide margin): a later
      // same-text single-turn conversation opened while the stop control still shows must not inherit the copy.
      const eligible = e.canMigrate && !e.migrated && !e.answer && KIMI_CHAT.test(e.routeId) && KIMI_CHAT.test(current.id);
      if (eligible && !turn?.user) return false;
      const replaced = !e.user?.isConnected && e.user !== turn.user && Date.now() - e.boundAt <= 10_000;
      const migrating = eligible && !!e.user && (e.user.isConnected ? e.user === turn.user : replaced)
        && turn.userCount === 1 && normalize(turn.text) === e.text;
      if (!migrating) { stop(e); return false; }
      e.routeId = current.id; e.migrated = true;
      if (e.user !== turn.user) { e.user = turn.user; e.userKey = turn.userKey || null; }
    }
    // 豆包 local_ 地址不锁归属。在 local_ 上绑定后、地址锁定前：仍在 local_ 而已绑用户节点脱离文档（先换 DOM），或地址离开了
    // local_ 却没经 rebase() 放行，都是页面换成了别的会话（侧栏点开同文单轮旧会话时，bind() 的乐观替换分支会换绑过去、promote
    // 再升到第 ① 级，把旧回答记成本轮副本），一律结束。唯一放行的 local_ → 正式 id 迁移见 rebase()。
    if (!e.routeId && e.localId && (!e.user?.isConnected || current.id !== e.localId)) { stop(e); return false; }
    if (leftHome(e)) { stop(e); return false; }
    return true;
  }
  // 定位本轮：② → ① 升级、豆包 local_ 迁移换节点后再试一次升级（新节点同一批里第 ① 级往往已命中）。
  function locateTurn(e, a) {
    const turn = promote(e, a, a?.historyTurn?.(e.locate));
    return rebase(e, turn) ? promote(e, a, turn) : turn;
  }
  // 冻结：最后读一次（force：无 key 锚点根也读）再结束本轮。用户交互与无 key 锚点根的软到期共用。
  function settle(e, a) {
    if (e.ended) return;
    if (!e.user) { stop(e); return; }
    const snapshot = read(e, a, true);
    if (snapshot.owned && snapshot.text) e.finalSnapshot = { ...snapshot, ended: true };
    stop(e);
  }
  function watchInteraction(e, a) {
    const freeze = () => settle(e, a);
    const activate = event => {
      if (!event.isTrusted || (event.type === "beforeinput" && !e.user)) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      const control = event.composedPath?.().some(node => node.matches?.('button,a,[role="button"],[role="menuitem"]')
        || (node.nodeType === 1 && getComputedStyle(node).cursor === "pointer"));
      // While the bound turn is still streaming, scroll/copy controls or a drafted
      // follow-up would truncate the copy. New turns, route and answer changes still end it.
      // Yuanbao hides its stop control once the composer holds a draft, so recent
      // answer DOM growth also counts (streaming gaps are well under 2s).
      const streaming = a?.generation?.() === "generating" || (!!e.changedAt && Date.now() - e.changedAt < 2_000);
      if (e.user && streaming) return;
      if (!e.answer || control || event.type === "beforeinput") freeze();
    };
    for (const name of ["pointerdown", "click", "keydown", "beforeinput"]) {
      document.addEventListener?.(name, activate, true); e.listeners.push([document, name, activate]);
    }
    const navigate = () => stop(e);
    for (const name of ["popstate", "hashchange"]) {
      window.addEventListener?.(name, navigate, true); e.listeners.push([window, name, navigate]);
    }
  }
  function bind(e, turn) {
    if (e.ended || !checkRoute(e, turn) || !turn?.user) return false;
    const expected = (e.baseline?.userCount ?? 0) + 1;
    // Doubao virtualizes older DOM. Stable immediate-predecessor identity proves
    // adjacency even when the baseline node was recycled; route/text checks remain.
    const adjacent = /^(?:www\.)?doubao\.com$/.test(location.hostname)
      && !!e.baseline?.userKey && turn.previousUserKey === e.baseline.userKey
      && !!turn.userKey && turn.userKey !== e.baseline.userKey;
    // More than one new turn means a follow-up occurred before capture; never pick its last answer.
    if (!Number.isSafeInteger(turn.userCount) || (!adjacent && turn.userCount !== expected)) {
      if (turn.userCount > expected || e.user) stop(e);
      return false;
    }
    if (normalize(turn.text) !== e.text) { if (e.user) stop(e); return false; }
    if (!e.user) {
      const old = e.baseline;
      if (old?.user && (same(old.user, old.userKey, turn.user, turn.userKey) || (!old.user.isConnected && !adjacent))) return false;
      if (!old?.user && !wasInserted(e, turn.user)) return false;
      if (!freshBind(e)) { stop(e); return false; }
      e.user = turn.user; e.userKey = turn.userKey || null; e.inserted = new WeakSet(); e.boundAt = Date.now(); e.boundSlot = slot();
      // 定位方法在本轮用户首次确立时冻结：没被采纳的命中（如未插入的同文回显）不冻结，① 级仍可接管。
      if (e.locate && !e.locate.method) e.locate.method = turn.locate || null;
    } else if (!same(e.user, e.userKey, turn.user, turn.userKey)) {
      // Optimistic message DOM may be replaced by the server turn before any answer.
      // The exact text and unique expected count above still have to match.
      if (!e.answer && !e.user.isConnected) { e.user = turn.user; e.userKey = turn.userKey || null; }
      else { stop(e); return false; }
    }
    const currentRoute = route();
    if (!e.routeId && !currentRoute.home) e.routeId = currentRoute.id;
    if (!e.routeId && currentRoute.local && !e.localId) { e.localId = currentRoute.id; e.localSlot = slot(); }
    return true;
  }
  // 首问的第 ② 级让位第 ① 级（一次、单向）：豆包新会话先在 /chat/local_ 下渲染无 data-message-id 的乐观气泡，首次 bind 只能冻结为语义级，
  // 服务端确认后页面换成带 key 的新节点（D4 第 3 轮真机；先经 rebase() 换绑到新节点再升级）。语义级回答根是整条 receive_message，会把思考头带进副本。
  // 冻结是为了 begin 与快照的 userCount 同源：只在基线各级都为空（第 ① 级基线也是 0）时才允许，且第 ① 级的用户必须落在
  // 已绑定的用户节点内、恰好数到 1 条、原文相同；已有回答时第 ① 级的回答也须在已锁的回答根内。换绑后回答从第 ① 级重新锁定。
  function promote(e, a, turn) {
    if (!e.promotable || !e.user || e.locate?.method !== "semantic" || e.ended) return turn;
    const sel = a?.historyTurn?.({ method: "selector" });
    if (sel?.locate !== "selector" || !sel.user || sel.userCount !== 1 || !e.user.contains(sel.user) || normalize(sel.text) !== e.text) return turn;
    if (e.answerRoot && !(sel.answer?.isConnected && e.answerRoot.contains(sel.answer))) return turn;
    e.promotable = false; e.locate.method = "selector"; e.user = sel.user; e.userKey = sel.userKey || null;
    e.answer = null; e.answerRoot = null; e.answerKey = null;
    return sel;
  }
  // 原文锚点给的回答根没有稳定 key：不锁根（流式换包装会被误判成换回答而截断），只读一次就结束本轮，完成状态仍记未知。
  // 读的时机只认正向证据：本轮见过停止键、之后它消失且回答容器 QUIET_MS 无变动；或 force（用户交互冻结、软到期）。
  // 单凭「静止」不算：锚点只在改版后启用，停止键选择器多半一起失效，思考/检索时几秒没有变动也很常见。
  // QUIET_MS：停止键消失后正文仍可能续长，实测最大间隔 1.79s（ChatGPT，2026-10-04），留 ≥20% 余量取 3s。
  const QUIET_MS = 3_000;
  // 回答根换了身份（同一锚点后的兄弟被替换或另选）时静默期从头算：旧根的静止不能替新根作证。
  function noteRoot(e, root) {
    if (e.onceRoot && root && e.onceRoot !== root && e.changedAt) e.changedAt = Date.now();
    if (root) e.onceRoot = root;
  }
  function once(e, a, turn, force) {
    const generating = a.generation?.() === "generating", base = { token: e.token, owned: true, url: location.href, locate: turn.locate };
    if (generating) e.sawGenerating = true;
    noteRoot(e, turn.answerRoot || turn.answer);
    // 回答根从没变动过（changedAt 为空）不读：真回答总要流式长出来，一个本来就静止的根多半是回显或测量副本。
    if (!force && (generating || !e.sawGenerating || !e.changedAt || Date.now() - e.changedAt < QUIET_MS)) return { ...base, generation: generating ? "generating" : null };
    const text = S.toMarkdown(turn.answer);
    if (!text?.trim()) return { ...base, generation: null };
    e.finalSnapshot = { ...base, text, generation: null, ended: true };
    stop(e);
    return e.finalSnapshot;
  }
  function read(e, a, force) {
    const empty = { token: e.token, owned: false };
    // 读正文的这次定位不用锚点缓存（ctx.fresh）：缓存只证明节点还在，不复核同文是否仍唯一。
    let turn;
    if (e.locate) e.locate.fresh = true;
    try { turn = locateTurn(e, a); } finally { if (e.locate) e.locate.fresh = false; }
    // Some sites show Stop before rendering the submitted user turn. This only
    // keeps observation alive; no text or URL is attributed until bind succeeds.
    if (!bind(e, turn)) return { ...empty, ended: e.ended,
      generation: !e.ended && a?.generation?.() === "generating" ? "generating" : null };
    if (!turn.answer) {
      const generating = a.generation?.() === "generating";
      if (generating) e.sawGenerating = true;
      return { ...empty, owned: true, generation: generating ? "generating" : null, url: location.href, locate: turn.locate };
    }
    if (turn.locate === "anchor" && !turn.answerKey) return once(e, a, turn, force);
    if (e.answer && !same(e.answerRoot, e.answerKey, turn.answerRoot || turn.answer, turn.answerKey)) { stop(e); return { ...empty, ended: true }; }
    // Missing stop controls are not positive completion evidence. Keep the copy's
    // completion unknown; user actions and route/turn identity end ownership explicitly.
    const generation = a.generation?.() === "generating" ? "generating" : null;
    const text = typeof turn.answer === "string" ? turn.answer : S.toMarkdown(turn.answer);
    if (text?.trim()) { e.answer = turn.answer; e.answerRoot = turn.answerRoot || turn.answer; e.answerKey = turn.answerKey || null; }
    return { token: e.token, owned: true, text: text || null, url: location.href, generation, locate: turn.locate };
  }
  S.history = {
    normalize, route,
    // 仅提供本轮新增用户消息的正向证据，不序列化正文，不作为“未发送”的判据。
    // 原文锚点按本次问题找节点，文本校验是循环论证，不能当新消息证据。
    submitted(token) {
      if (!entry || entry.token !== token || entry.ended) return false;
      try { const a = adapter(), turn = locateTurn(entry, a); return bind(entry, turn) && turn.locate !== "anchor"; } catch (_) { return false; }
    },
    // options.images：本次附件数。带附件的提问不走原文锚点。
    begin(token, text, deadline, options) {
      if (!token || entry?.token === token) return;
      if (entry) stop(entry);
      entry = null;
      try {
        const a = adapter();
        if (typeof a?.historyTurn !== "function") return;
        // 定位方法冻结（history-locate.js）：基线命中哪一级，本轮就只用哪一级；基线为空时等 bind() 首次确立用户再冻结。原文锚点只给空会话首轮：
        // 首页路由、①② 都没有任何用户轮次、无附件；已有轮次的会话里锚点算不出同源 userCount。
        const locate = { method: null, text: String(text || ""), anchor: false, cache: null, batch: null };
        const baseline = a.historyTurn(locate);
        if (baseline?.user && !Number.isSafeInteger(baseline.userCount)) return;
        if (baseline?.user) locate.method = baseline.locate || null;
        locate.anchor = !baseline?.user && route().home && !(Number(options?.images) > 0);
        const current = entry = { token, text: normalize(text), baseline, locate, user: null, answer: null, userKey: null,
          answerKey: null, routeId: route().home ? null : route().id,
          canMigrate: /^(?:www\.)?kimi\.com$/.test(location.hostname) && route().home && !baseline?.user,
          beginLocal: route().local ? route().id : null, beginSlot: slot(), boundSlot: null,
          migrated: false, localId: null, localSlot: null, swapUntil: 0, promotable: !baseline?.user, finalSnapshot: null, listeners: [], ended: false, inserted: new WeakSet(), observer: null, timer: null,
          soft: null, sawGenerating: false, onceRoot: null, slow: 0 };
        watchInteraction(current, a);
        if (typeof MutationObserver === "function") {
          current.observer = new MutationObserver(records => {
            if (current.ended) return;
            if (!current.user) for (const record of records) for (const node of record.addedNodes) {
              // Weak evidence cannot fill up or retain discarded hydration nodes.
              current.inserted.add(node);
            }
            // Bind at insertion time without serializing every streaming mutation.
            // 观测：本批定位 + 绑定耗时超过 SLOW_MS 的次数（只计数，经快照进 Alt+H 报告）。ctx.batch 让同一批里的
            // 多级定位共用一次 findComposer（同步回调内 DOM 不变）。
            const started = Date.now();
            current.locate.batch = {};
            try {
              const turn = locateTurn(current, a), root = turn?.answerRoot || turn?.answer;
              if (bind(current, turn) && root?.contains) {
                // 回答容器的变动：内部增删、原地改写文本（characterData），以及回答根与用户气泡同批插入。
                if (records.some(record => root.contains(record.target) || [...record.addedNodes].some(node => node.contains?.(root)))) current.changedAt = Date.now();
                if (current.locate.method === "anchor") noteRoot(current, root);
                // 无 key 锚点根的正向证据：停止键可能只亮几秒，主进程每 5 秒才拉一次快照，在这里补采样。
                if (current.locate.method === "anchor" && !current.sawGenerating && a.generation?.() === "generating") current.sawGenerating = true;
              }
            } catch (_) { stop(current); }
            finally { current.locate.batch = null; if (Date.now() - started > SLOW_MS) current.slow = Math.min(current.slow + 1, Number.MAX_SAFE_INTEGER); }
          });
          current.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
          const start = Math.min(Number(deadline) || Date.now() + 90_000, Date.now() + 90_000), expires = start + 15 * 60_000 + 45_000;
          // 无 key 锚点根始终没等到正向证据时的降级读：赶在主进程观察窗（提交结果起 15 分钟）收口前读一次。
          current.soft = setTimeout(() => { if (current.user && current.locate.method === "anchor" && !current.answer) settle(current, a); },
            Math.max(0, start + 12 * 60_000 - Date.now()));
          current.timer = setTimeout(() => stop(current), Math.max(0, expires - Date.now()));
        }
      } catch (_) { if (entry) stop(entry); entry = null; }
    },
    snapshot(token) {
      if (!entry || entry.token !== token) return { token, owned: false, ended: true };
      const slow = entry.slow ? { slowObserver: entry.slow } : {};
      if (entry.ended) return { ...(entry.finalSnapshot || { token, owned: false, ended: true }), ...slow };
      try { return { ...read(entry, adapter()), ...slow }; } catch (_) { return { token, owned: false, ...slow }; }
    }
  };
}());
