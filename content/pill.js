// content/pill.js — 三态悬浮控件：handle(默认贴边把手)/always(常显)/hidden。
// displayMode 存 chrome.storage.sync，popup 修改后经 storage.onChanged 实时生效。
(function () {
  "use strict";
  if (document.getElementById("ams-pill-host")) return;

  const host = document.createElement("div");
  host.id = "ams-pill-host";
  host.style.cssText =
    "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{display:block}
      .wrap{display:flex;flex-direction:column;align-items:center}
      .handle{width:36px;height:6px;border-radius:0 0 6px 6px;cursor:pointer;
        background:rgba(120,120,120,.45);transition:background .2s}
      .handle:hover{background:rgba(120,120,120,.8)}
      .pill{display:none;align-items:center;border-radius:999px;overflow:hidden;margin-top:4px;
        background:rgba(30,30,30,.85);box-shadow:0 2px 10px rgba(0,0,0,.25);
        font:13px/1 -apple-system,"Segoe UI",sans-serif;color:#fff;
        opacity:1;transition:opacity .4s}
      .pill.idle{opacity:.35}
      .pill:hover{opacity:1}
      button{all:unset;cursor:pointer;padding:7px 14px;white-space:nowrap}
      button:hover{background:rgba(255,255,255,.14)}
      button.active{background:rgba(255,255,255,.22)}
      .sep{width:1px;align-self:stretch;background:rgba(255,255,255,.22)}
      /* 模式形态 */
      .wrap[data-mode=hidden]{display:none}
      .wrap[data-mode=always] .handle{display:none}
      .wrap[data-mode=always] .pill{display:flex}
      .wrap[data-mode=handle].open .handle{display:none}
      .wrap[data-mode=handle].open .pill{display:flex}
    </style>
    <div class="wrap" id="wrap" data-mode="handle">
      <div class="handle" id="handle"></div>
      <div class="pill" id="pill">
        <button id="think"></button>
        <span class="sep"></span>
        <button id="fast"></button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const wrap = root.getElementById("wrap");
  const pill = root.getElementById("pill");
  const btnT = root.getElementById("think");
  const btnF = root.getElementById("fast");
  const hdl  = root.getElementById("handle");

  function applyTexts() {
    hdl.title        = t("cs_pillHandleTitle");
    btnT.textContent = t("cs_pillThink");
    btnT.title       = t("cs_pillThinkTitle");
    btnF.textContent = t("cs_pillFast");
    btnF.title       = t("cs_pillFastTitle");
  }
  applyTexts();
  document.addEventListener("i18n:changed", applyTexts);

  // 当前档位高亮（同步读，不开菜单）
  function refreshState() {
    const s = window.__AMS && window.__AMS.getState ? window.__AMS.getState() : null;
    btnT.classList.toggle("active", s === "think");
    btnF.classList.toggle("active", s === "fast");
  }

  // handle 模式：hover/click 展开，4s 无交互收回
  let collapseTimer = null;
  function armCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => wrap.classList.remove("open"), 4000);
  }
  function openPill() {
    wrap.classList.add("open");
    refreshState();
    armCollapse();
  }
  hdl.addEventListener("mouseenter", openPill);
  hdl.addEventListener("click", openPill);
  pill.addEventListener("mouseenter", () => { clearTimeout(collapseTimer); pill.classList.remove("idle"); });
  pill.addEventListener("mouseleave", () => { if (wrap.dataset.mode === "handle") armCollapse(); else if (wrap.dataset.mode === "always") armIdle(); });

  // always 模式：闲置半透明
  let idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    pill.classList.remove("idle");
    idleTimer = setTimeout(() => pill.classList.add("idle"), 4000);
  }

  function applyMode(mode) {
    wrap.dataset.mode = mode === "always" || mode === "hidden" ? mode : "handle";
    wrap.classList.remove("open");
    clearTimeout(idleTimer); pill.classList.remove("idle"); // idle 是 always 专属态，防切回 handle 后残留半透明
    if (mode === "always") { refreshState(); armIdle(); }
  }

  chrome.storage.sync.get({ displayMode: "handle" }, (v) => applyMode(v.displayMode));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "sync" && ch.displayMode) applyMode(ch.displayMode.newValue);
  });

  document.addEventListener("ams:switched", refreshState);
  setTimeout(refreshState, 2500); // 页面载入后读一次初始档位

  function act(mode) {
    window.__AMS.runMode(mode);
    if (wrap.dataset.mode === "handle") armCollapse(); else armIdle();
  }
  btnT.addEventListener("click", () => act("think"));
  btnF.addEventListener("click", () => act("fast"));
})();
