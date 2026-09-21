// 逐次提问只读快照：归属不明确就停止，不以最后一条回答猜测本轮。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  let entry = null;
  const normalize = text => String(text || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  const adapter = () => Object.entries(S.adapters || {}).find(([host]) =>
    location.hostname === host || location.hostname.endsWith("." + host))?.[1];
  const same = (node, key, other, otherKey) => node === other || (!!key && key === otherKey);
  function stop(e) { e.ended = true; e.observer?.disconnect(); if (e.timer) clearTimeout(e.timer); e.inserted = []; }
  function bind(e, turn) {
    if (e.ended || !turn?.user) return false;
    const expected = (e.baseline?.userCount ?? 0) + 1;
    // More than one new turn means a follow-up occurred before capture; never pick its last answer.
    if (!Number.isSafeInteger(turn.userCount) || turn.userCount !== expected) {
      if (turn.userCount > expected || e.user) stop(e);
      return false;
    }
    if (normalize(turn.text) !== e.text) { if (e.user) stop(e); return false; }
    if (!e.user) {
      const old = e.baseline;
      if (old?.user && (same(old.user, old.userKey, turn.user, turn.userKey) || !old.user.isConnected)) return false;
      if (!old?.user && !e.inserted.some(node => node === turn.user || node.contains?.(turn.user))) return false;
      e.user = turn.user; e.userKey = turn.userKey || null; e.inserted = [];
    } else if (!same(e.user, e.userKey, turn.user, turn.userKey)) { stop(e); return false; }
    return true;
  }
  function read(e, a) {
    const empty = { token: e.token, owned: false };
    const turn = a?.historyTurn?.();
    if (!bind(e, turn)) return { ...empty, ended: e.ended };
    if (!turn.answer) return { ...empty, owned: true };
    if (e.answer && !same(e.answer, e.answerKey, turn.answer, turn.answerKey)) { stop(e); return { ...empty, ended: true }; }
    const generation = a.generation?.() ?? null;
    const text = typeof turn.answer === "string" ? turn.answer : S.toMarkdown(turn.answer);
    if (e.completed && (generation === "generating" || text !== e.completeText)) { stop(e); return { ...empty, ended: true }; }
    if (generation === "complete") { e.completed = true; e.completeText = text; }
    e.answer = turn.answer; e.answerKey = turn.answerKey || null;
    return { token: e.token, owned: true, text: text || null, url: location.href, generation };
  }
  S.history = {
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
          answerKey: null, completed: false, completeText: null, ended: false, inserted: [], observer: null, timer: null };
        if (typeof MutationObserver === "function") {
          current.observer = new MutationObserver(records => {
            if (current.ended) return;
            if (!current.user) for (const record of records) for (const node of record.addedNodes) {
              if (current.inserted.length < 500) current.inserted.push(node);
            }
            // Bind at DOM insertion time, not the first 5-second polling tick. After binding,
            // remember the first observed completion so regeneration between probes cannot replace it.
            try {
              const turn = a.historyTurn();
              if (bind(current, turn)) {
                const generation = a.generation?.();
                if (current.completed && generation === "generating") stop(current);
                else if (!current.completed && generation === "complete" && turn.answer) read(current, a);
              }
            } catch (_) { stop(current); }
          });
          current.observer.observe(document.documentElement, { childList: true, subtree: true });
          const expires = Math.min(Number(deadline) || Date.now() + 90_000, Date.now() + 90_000) + 15 * 60_000 + 45_000;
          current.timer = setTimeout(() => stop(current), Math.max(0, expires - Date.now()));
        }
      } catch (_) { if (entry) stop(entry); entry = null; }
    },
    snapshot(token) {
      if (!entry || entry.token !== token || entry.ended) return { token, owned: false, ended: true };
      try { return read(entry, adapter()); } catch (_) { return { token, owned: false }; }
    }
  };
}());
