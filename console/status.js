// console/status.js — 群发进度/结果状态：圆点状态机、错误码翻译、失败汇总、无障碍播报。
// 在 console.js 之后加载，共享其全局（SITES/t/save 等）；progress/lastSend 声明于此，console.js 的事件处理器读写。

// 状态写到芯片：idle 清空 send/done/fail；title 拼「站名 · 原因」（悬停提示）
function setDot(host, state, reason) {
  const chip = document.querySelector('.chip[data-host="' + host + '"]');
  if (!chip) return;
  chip.classList.remove("send", "done", "fail");
  if (state && state !== "idle") chip.classList.add(state);
  chip.title = reason ? chip.dataset.label + " · " + reason : chip.dataset.label + " · " + t("con_chipHint");
}

// 错误码 → 当前语言文案（bg/content 只传 code，避免硬编码中文泄漏到 en/zh_TW 界面）
const ERR_KEYS = { timeout: "con_errTimeout", composer_not_found: "con_errNoComposer", inject_failed: "con_errInject", submit_unconfirmed: "con_errSubmit", tier_unconfirmed: "con_errTier",
  no_window: "con_errNoWindow", not_ready: "con_errNotReady", checkup_ok: "con_checkupOk", no_answer: "con_errNoAnswer" };
function errText(r) { return (ERR_KEYS[r.code] && t(ERR_KEYS[r.code])) || r.reason || t("con_failed"); }
function applyResults(results) {
  (results || []).forEach((r) => {
    if (typeof r.ok === "boolean") {
      // sendAll 提交结果；ok+code（如 tier_unconfirmed）= 绿点带警示 title
      setDot(r.host, r.ok ? "done" : "fail", r.ok ? (ERR_KEYS[r.code] ? t(ERR_KEYS[r.code]) : "") : errText(r));
    } else {
      const okWin = r.windowId != null;                                 // openTile 结果
      setDot(r.host, okWin ? "done" : "fail", r.reused ? t("con_reused") : r.opened ? t("con_opened") : t("con_failed"));
    }
  });
}

// 逐站实时回填：sendAll 期间每站一完成，background 即推单站结果，立刻更新该站圆点（不等全部）
let progress = { total: 0, done: 0 };
let lastSend = null; // {text, tier}
const elSend = document.getElementById("send");
function updateSendLabel() {
  elSend.textContent = (progress.total && progress.done < progress.total) ? t("con_sending", progress.done, progress.total) : t("con_sendAll");
}
function updateRetry() {
  const hasFail = !!document.querySelector(".chip.fail");
  document.getElementById("retry").disabled = !(hasFail && lastSend);
}
// 短暂内联提示（借 failsum 位；中性色，3s 后交还失败汇总）+ 读屏播报
let noteUntil = 0; // 展示期内挡住并发 siteResult/sendStart 触发的 updateFailSum 覆盖
function flashNote(text) {
  const el = document.getElementById("failsum");
  el.textContent = text; el.style.display = ""; el.style.color = "var(--text-2)";
  document.getElementById("live").textContent = text;
  noteUntil = Date.now() + 3000;
  setTimeout(() => { noteUntil = 0; updateFailSum(); }, 3000);
}
// 汇总复制：所选站点的最新回答拼 Markdown 写剪贴板（各站标注当时档位；未适配/未获取的站如实标出）
function copySummary(sites, results) {
  const byHost = {}; results.forEach((r) => { byHost[r.host] = r; });
  const q = (lastSend && lastSend.text) || document.getElementById("prompt").value.trim();
  const md = ["# " + t("con_mdHeader") + " · " + new Date().toLocaleString()];
  if (q) md.push("\n**" + t("con_mdQuestion") + "**: " + q);
  for (const s of sites) {
    const r = byHost[s.host] || { code: "not_ready" };
    const tier = r.state === "think" ? " · " + t("con_mdThink") : r.state === "fast" ? " · " + t("con_mdFast") : "";
    md.push("\n## " + s.label + tier + "\n", r.text ? r.text : "> " + errText(r));
  }
  navigator.clipboard.writeText(md.join("\n")).then(
    () => flashNote(t("con_collectDone", sites.length)),
    () => flashNote(t("con_collectFail"))
  );
}
// 全部结果回齐后在细条内联显示失败汇总（薄弹窗限制下不用浮层），并经 aria-live 播报给读屏
function updateFailSum() {
  if (Date.now() < noteUntil) return; // flashNote 展示期内不覆盖
  const el = document.getElementById("failsum");
  el.style.color = ""; // 复位 flashNote 的中性色
  const fails = [...document.querySelectorAll(".chip.fail")];
  if (!fails.length || !progress.total || progress.done < progress.total) { el.style.display = "none"; el.textContent = ""; return; }
  el.textContent = t("con_failSum", fails.length, fails.map((c) => c.dataset.label).join(" "));
  el.title = fails.map((c) => c.title).join("\n"); // 悬停看逐站原因全文
  el.style.display = "";
  document.getElementById("live").textContent = el.textContent;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.from !== "AMS_BG") return;
  if (msg.type === "sendStart") {
    if (msg.text) lastSend = { text: msg.text, tier: msg.tier || null }; // compose 发起的群发也可重试
    progress = { total: msg.hosts.length, done: 0 };
    msg.hosts.forEach((h) => setDot(h, "send", t("con_sendingDot")));
    updateSendLabel(); updateRetry(); updateFailSum();
  } else if (msg.type === "siteResult" && msg.result) {
    applyResults([msg.result]);
    progress.done++;
    updateSendLabel(); updateRetry(); updateFailSum();
  }
});
