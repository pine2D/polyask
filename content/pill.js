// content/pill.js — 顶部居中悬浮胶囊（Shadow DOM 隔离站点样式）。
(function () {
  "use strict";
  if (document.getElementById("ams-pill-host")) return;

  const host = document.createElement("div");
  host.id = "ams-pill-host";
  host.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .pill{display:flex;align-items:center;border-radius:999px;overflow:hidden;
        background:rgba(30,30,30,.82);box-shadow:0 2px 10px rgba(0,0,0,.25);
        font:13px/1 -apple-system,"Segoe UI",sans-serif;color:#fff;
        opacity:1;transition:opacity .4s}
      .pill.idle{opacity:.35}
      .pill:hover{opacity:1}
      button{all:unset;cursor:pointer;padding:7px 14px;white-space:nowrap}
      button:hover{background:rgba(255,255,255,.14)}
      .sep{width:1px;align-self:stretch;background:rgba(255,255,255,.22)}
    </style>
    <div class="pill" id="pill">
      <button id="think">🧠 思考</button>
      <span class="sep"></span>
      <button id="fast">⚡ 快速</button>
    </div>`;
  document.documentElement.appendChild(host);

  const pill = root.getElementById("pill");
  let idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    pill.classList.remove("idle");
    idleTimer = setTimeout(() => pill.classList.add("idle"), 4000);
  }
  pill.addEventListener("mouseenter", armIdle);
  armIdle();

  root.getElementById("think").addEventListener("click", () => { window.__AMS.runMode("think"); armIdle(); });
  root.getElementById("fast").addEventListener("click", () => { window.__AMS.runMode("fast"); armIdle(); });
})();
