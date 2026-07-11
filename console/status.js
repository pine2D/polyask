// console/status.js — 群发进度/结果状态：圆点状态机、错误码翻译、失败汇总、无障碍播报。
// 在 console.js 之后加载，共享其全局（SITES/t/save 等）；progress/lastSend 声明于此，console.js 的事件处理器读写。

// 状态写到芯片：idle 清空 send/open/done/fail；title 拼「站名 · 原因」（悬停提示）。
// aria-label 同步状态：title 对读屏/触屏不可靠，可访问名须自带状态信息。
function setDot(host, state, reason) {
  const chip = document.querySelector('.chip[data-host="' + host + '"]');
  if (!chip) return;
  chip.classList.remove("send", "open", "done", "fail");
  if (state && state !== "idle") chip.classList.add(state);
  chip.title = reason ? chip.dataset.label + " · " + reason : chip.dataset.label + " · " + t("con_chipHint");
  chip.setAttribute("aria-label", reason ? chip.dataset.label + " · " + reason : chip.dataset.label);
}

// 错误码 → 当前语言文案（bg/content 只传 code，避免硬编码中文泄漏到 en/zh_TW 界面）
const ERR_KEYS = { timeout: "con_errTimeout", composer_not_found: "con_errNoComposer", inject_failed: "con_errInject", submit_unconfirmed: "con_errSubmit", tier_unconfirmed: "con_errTier",
  no_window: "con_errNoWindow", not_ready: "con_errNotReady", checkup_ok: "con_checkupOk", no_answer: "con_errNoAnswer", error: "con_errGeneric" };
// error 码 = 意外异常兜底：主文案用词条（不让英文异常原文裸露在 zh 界面），原始 reason 附在后面供排障
function errText(r) {
  const base = ERR_KEYS[r.code] && t(ERR_KEYS[r.code]);
  if (base) return r.code === "error" && r.reason ? base + " · " + r.reason : base;
  return r.reason || t("con_failed");
}
// closeAll 乐观清零后，在途群发的迟到 siteResult/回调会把刚清空的芯片重新点亮——
// 进入忽略态直到用户下一次动作（sendStart 推送或 tile/checkup 点击）解除
let ignoreResults = false;
function applyResults(results) {
  if (ignoreResults) return;
  (results || []).forEach((r) => {
    if (typeof r.ok === "boolean") {
      // sendAll 提交结果；ok+code（如 tier_unconfirmed）= 绿点带警示 title
      setDot(r.host, r.ok ? "done" : "fail", r.ok ? (ERR_KEYS[r.code] ? t(ERR_KEYS[r.code]) : "") : errText(r));
    } else {
      // openTile 结果用「open」态（空心绿圈）：与「已回答」的实心绿勾区分，平铺后满屏绿勾曾被误读为已回复
      const okWin = r.windowId != null;
      setDot(r.host, okWin ? "open" : "fail", r.reused ? t("con_reused") : r.opened ? t("con_opened") : t("con_failed"));
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
  let miss = 0; // 无回答的站数：提示里如实标注，别让用户把错误占位贴给别人而不自知
  for (const s of sites) {
    const r = byHost[s.host] || { code: "not_ready" };
    if (!r.text) miss++;
    const tier = r.state === "think" ? " · " + t("con_mdThink") : r.state === "fast" ? " · " + t("con_mdFast") : "";
    md.push("\n## " + s.label + tier + "\n", r.text ? r.text : "> " + errText(r));
  }
  navigator.clipboard.writeText(md.join("\n")).then(
    () => flashNote(miss ? t("con_collectDonePart", sites.length, miss) : t("con_collectDone", sites.length)),
    () => flashNote(t("con_collectFail"))
  );
}
// 全部结果回齐后在细条内联显示失败汇总（薄弹窗限制下不用浮层），并经 aria-live 播报给读屏
function updateFailSum() {
  if (Date.now() < noteUntil) return; // flashNote 展示期内不覆盖
  const el = document.getElementById("failsum");
  el.style.color = ""; // 复位 flashNote 的中性色
  const fails = [...document.querySelectorAll(".chip.fail")];
  const finished = !!progress.total && progress.done >= progress.total;
  if (!fails.length || !finished) {
    el.style.display = "none"; el.textContent = "";
    if (finished && !fails.length) document.getElementById("live").textContent = t("con_allDone", progress.total); // 全绿也要给读屏一个完成信号
    return;
  }
  el.textContent = t("con_failSum", fails.length, fails.map((c) => c.dataset.label).join(" "));
  el.title = fails.map((c) => c.title).join("\n"); // 悬停看逐站原因全文
  el.style.display = "";
  document.getElementById("live").textContent = el.textContent;
}
// 芯片状态的客户端兜底：回调/推送断掉（SW 被杀、扩展重载）时圆点会永久卡"发送中"，
// 到点仍是 send 态就地翻超时失败（bg 22s 超时必推结果，故正常路径下 26s 兜底不会触发）
function armDotTimeouts(hosts, ms) {
  hosts.forEach((h) => setTimeout(() => {
    const chip = document.querySelector('.chip[data-host="' + h + '"]');
    if (!chip || !chip.classList.contains("send")) return;
    setDot(h, "fail", t("con_errTimeout"));
    if (progress.total && progress.done < progress.total) { progress.done++; updateSendLabel(); }
    updateRetry(); updateFailSum();
  }, ms || 26000));
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.from !== "AMS_BG") return;
  if (msg.type === "sendStart") {
    ignoreResults = false; // 新一轮群发开始，恢复接收结果
    if (msg.text) lastSend = { text: msg.text, tier: msg.tier || null }; // compose 发起的群发也可重试
    progress = { total: msg.hosts.length, done: 0 };
    msg.hosts.forEach((h) => setDot(h, "send", t("con_sendingDot")));
    armDotTimeouts(msg.hosts);
    updateSendLabel(); updateRetry(); updateFailSum();
  } else if (msg.type === "siteResult" && msg.result) {
    if (ignoreResults) return; // closeAll 后的迟到结果不复活芯片
    applyResults([msg.result]);
    progress.done++;
    updateSendLabel(); updateRetry(); updateFailSum();
  }
});
