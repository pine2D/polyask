// 逐次提问只读快照：归属不明确就停止，不以最后一条回答猜测本轮。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  let entry = null;
  const normalize = text => {
    let value = String(text || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
    // Doubao inserts typography spaces between Han and other glyphs in user bubbles,
    // including quotes (`有没有 "x" 的`, 2026-10-03). Preserve English word spacing,
    // numeric spacing and all substantive text.
    if (/^(?:www\.)?doubao\.com$/.test(location.hostname)) value = value
      .replace(/(\p{Script=Han}) +(?=\S)/gu, "$1")
      .replace(/(\S) +(?=\p{Script=Han})/gu, "$1");
    return value;
  };
  const adapter = () => Object.entries(S.adapters || {}).find(([host]) =>
    location.hostname === host || location.hostname.endsWith("." + host))?.[1];
  const same = (node, key, other, otherKey) => node === other || (!!key && key === otherKey);
  function wasInserted(e, user) {
    for (let node = user; node; node = node.parentNode) if (e.inserted.has(node)) return true;
    return false;
  }
  function stop(e) {
    e.ended = true; e.observer?.disconnect(); if (e.timer) clearTimeout(e.timer); e.inserted = new WeakSet();
    for (const [target, name, handler] of e.listeners || []) target.removeEventListener?.(name, handler, true);
    e.listeners = [];
  }
  function route() {
    const url = new URL(location.href);
    const cid = url.hostname === "chatglm.cn" ? url.searchParams.get("cid") : null;
    // ChatGPT first renders local-chatgpt:<id> (often URL-encoded), then settles
    // to the server conversation. Neither provisional format locks ownership.
    const provisional = url.hostname === "chatgpt.com" && /^\/c\/(?:WEB|local-chatgpt)(?::|%3a)[a-zA-Z0-9_-]+$/i.test(url.pathname);
    return { id: url.origin + url.pathname + (cid ? "?cid=" + cid : ""),
      home: !cid && (provisional || (url.hostname === "yuanbao.tencent.com" && /^\/chat\/[^/]+\/?$/.test(url.pathname)) || /^\/(?:new|app|agent|chat\/?|main\/alltoolsdetail)?$/.test(url.pathname)) };
  }
  function checkRoute(e, turn) {
    const current = route();
    if (e.routeId && e.routeId !== current.id) {
      // Kimi replaces its first optimistic chat URL before the server answer.
      // Only the very same connected first user can authorize this single migration.
      const migrating = e.canMigrate && !e.migrated && !e.answer && e.user?.isConnected && e.user === turn?.user
        && turn.userCount === 1 && normalize(turn.text) === e.text
        && /^https:\/\/(?:www\.)?kimi\.com\/chat\/[^/]+$/.test(e.routeId)
        && /^https:\/\/(?:www\.)?kimi\.com\/chat\/[^/]+$/.test(current.id);
      if (!migrating) { stop(e); return false; }
      e.routeId = current.id; e.migrated = true;
    }
    return true;
  }
  function watchInteraction(e, a) {
    const freeze = () => {
      if (e.ended) return;
      if (!e.user) { stop(e); return; }
      const snapshot = read(e, a);
      if (snapshot.owned && snapshot.text) e.finalSnapshot = { ...snapshot, ended: true };
      stop(e);
    };
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
      e.user = turn.user; e.userKey = turn.userKey || null; e.inserted = new WeakSet();
    } else if (!same(e.user, e.userKey, turn.user, turn.userKey)) {
      // Optimistic message DOM may be replaced by the server turn before any answer.
      // The exact text and unique expected count above still have to match.
      if (!e.answer && !e.user.isConnected) { e.user = turn.user; e.userKey = turn.userKey || null; }
      else { stop(e); return false; }
    }
    const currentRoute = route();
    if (!e.routeId && !currentRoute.home) e.routeId = currentRoute.id;
    return true;
  }
  function read(e, a) {
    const empty = { token: e.token, owned: false };
    const turn = a?.historyTurn?.();
    // Some sites show Stop before rendering the submitted user turn. This only
    // keeps observation alive; no text or URL is attributed until bind succeeds.
    if (!bind(e, turn)) return { ...empty, ended: e.ended,
      generation: !e.ended && a?.generation?.() === "generating" ? "generating" : null };
    if (!turn.answer) return { ...empty, owned: true, generation: a.generation?.() === "generating" ? "generating" : null, url: location.href };
    if (e.answer && !same(e.answerRoot, e.answerKey, turn.answerRoot || turn.answer, turn.answerKey)) { stop(e); return { ...empty, ended: true }; }
    // Missing stop controls are not positive completion evidence. Keep the copy's
    // completion unknown; user actions and route/turn identity end ownership explicitly.
    const generation = a.generation?.() === "generating" ? "generating" : null;
    const text = typeof turn.answer === "string" ? turn.answer : S.toMarkdown(turn.answer);
    if (text?.trim()) { e.answer = turn.answer; e.answerRoot = turn.answerRoot || turn.answer; e.answerKey = turn.answerKey || null; }
    return { token: e.token, owned: true, text: text || null, url: location.href, generation };
  }
  S.history = {
    // 仅提供本轮新增用户消息的正向证据，不序列化正文，不作为“未发送”的判据。
    submitted(token) {
      if (!entry || entry.token !== token || entry.ended) return false;
      try { return bind(entry, adapter()?.historyTurn?.()); } catch (_) { return false; }
    },
    begin(token, text, deadline) {
      if (!token || entry?.token === token) return;
      if (entry) stop(entry);
      entry = null;
      try {
        const a = adapter();
        if (typeof a?.historyTurn !== "function") return;
        const baseline = a.historyTurn();
        if (baseline?.user && !Number.isSafeInteger(baseline.userCount)) return;
        const current = entry = { token, text: normalize(text), baseline, user: null, answer: null, userKey: null,
          answerKey: null, routeId: route().home ? null : route().id,
          canMigrate: /^(?:www\.)?kimi\.com$/.test(location.hostname) && route().home && !baseline?.user,
          migrated: false, finalSnapshot: null, listeners: [], ended: false, inserted: new WeakSet(), observer: null, timer: null };
        watchInteraction(current, a);
        if (typeof MutationObserver === "function") {
          current.observer = new MutationObserver(records => {
            if (current.ended) return;
            if (!current.user) for (const record of records) for (const node of record.addedNodes) {
              // Weak evidence cannot fill up or retain discarded hydration nodes.
              current.inserted.add(node);
            }
            // Bind at insertion time without serializing every streaming mutation.
            try {
              const turn = a.historyTurn(), root = turn?.answerRoot || turn?.answer;
              if (bind(current, turn) && root?.contains && records.some(record => root.contains(record.target))) current.changedAt = Date.now();
            } catch (_) { stop(current); }
          });
          current.observer.observe(document.documentElement, { childList: true, subtree: true });
          const expires = Math.min(Number(deadline) || Date.now() + 90_000, Date.now() + 90_000) + 15 * 60_000 + 45_000;
          current.timer = setTimeout(() => stop(current), Math.max(0, expires - Date.now()));
        }
      } catch (_) { if (entry) stop(entry); entry = null; }
    },
    snapshot(token) {
      if (!entry || entry.token !== token) return { token, owned: false, ended: true };
      if (entry.ended) return entry.finalSnapshot || { token, owned: false, ended: true };
      try { return read(entry, adapter()); } catch (_) { return { token, owned: false }; }
    }
  };
}());
