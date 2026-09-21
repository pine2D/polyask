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
  S.history = {
    begin(token, text) {
      if (!token || entry?.token === token) return;
      entry?.observer?.disconnect();
      entry = null;
      try {
        const a = adapter();
        if (typeof a?.historyTurn !== "function") return;
        const baseline = a.historyTurn();
        entry = { token, text: normalize(text), baseline, user: null, answer: null, userKey: null,
          answerKey: null, completed: false, ended: false, inserted: [], observer: null };
        if (!baseline?.user && typeof MutationObserver === "function") {
          const current = entry;
          entry.observer = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
              if (current.inserted.length < 500) current.inserted.push(node);
            }
          });
          entry.observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (_) { entry = null; }
    },
    snapshot(token) {
      const empty = { token, owned: false };
      if (!entry || entry.token !== token) return { ...empty, ended: true };
      if (entry.ended) return { ...empty, ended: true };
      try {
        const a = adapter(), turn = a?.historyTurn?.();
        if (!turn?.user || normalize(turn.text) !== entry.text) {
          if (entry.user) entry.ended = true;
          return { ...empty, ended: entry.ended };
        }
        if (!entry.user) {
          const old = entry.baseline;
          if (old?.user && (same(old.user, old.userKey, turn.user, turn.userKey) || !old.user.isConnected)) return empty;
          if (!old?.user && !entry.inserted.some(node => node === turn.user || node.contains?.(turn.user))) return empty;
          entry.observer?.disconnect(); entry.inserted = [];
          entry.user = turn.user; entry.userKey = turn.userKey || null;
        } else if (!same(entry.user, entry.userKey, turn.user, turn.userKey)) {
          entry.ended = true; return { ...empty, ended: true };
        }
        if (!turn.answer) return { ...empty, owned: true };
        if (entry.answer && !same(entry.answer, entry.answerKey, turn.answer, turn.answerKey)) {
          entry.ended = true; return { ...empty, ended: true };
        }
        const generation = a.generation?.() ?? null;
        if (entry.completed && generation === "generating") { entry.ended = true; return { ...empty, ended: true }; }
        if (generation === "complete") entry.completed = true;
        entry.answer = turn.answer; entry.answerKey = turn.answerKey || null;
        const text = typeof turn.answer === "string" ? turn.answer : S.toMarkdown(turn.answer);
        return { token, owned: true, text: text || null, url: location.href, generation };
      } catch (_) { return empty; }
    }
  };
}());
