import type { PopupAnchor } from "../shared/popup-anchor";

export type PlatinumPopupEntry<Id extends string = string> =
  | { readonly type: "separator" }
  | {
      readonly type?: "item";
      readonly id?: Id;
      readonly label: string;
      readonly enabled?: boolean;
      readonly checked?: boolean;
      readonly checkable?: boolean;
      readonly accelerator?: string;
    };

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildPlatinumPopupHtml<Id extends string>(
  entries: readonly PlatinumPopupEntry<Id>[],
  anchor: PopupAnchor,
  platform: NodeJS.Platform
): string {
  const checkColumn = entries.some((entry) => entry.type !== "separator" && (entry.checkable || entry.checked !== undefined));
  const payload = escapeJsonForScript({ entries, anchor, checkColumn });
  return `<!doctype html>
<html data-platform="${platform}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>ready</title>
<style>
  :root {
    color-scheme: light dark;
    --font-ui: "Charcoal", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif;
    --font-mono: "Monaco", "Cascadia Mono", "Consolas", ui-monospace, monospace;
    --menu-bg: #dddddd;
    --menu-fg: #222222;
    --menu-border: #262626;
    --menu-hi: #ffffff;
    --menu-lo: #777777;
    --menu-shadow: 2px 2px 0 #262626;
    --menu-active-bg: #333333;
    --menu-active-fg: #ffffff;
    --menu-disabled-fg: #6f6f6f;
    --menu-disabled-etch: 1px 1px 0 rgba(255, 255, 255, 0.7);
    --menu-sep-top: #848484;
    --menu-sep-bottom: #ffffff;
    --scroll-track: #aaaaaa;
    --scroll-thumb: #cccccc;
    --scroll-thumb-hi: #ffffff;
    --scroll-thumb-lo: #777777;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --menu-bg: #363636;
      --menu-fg: #eeeeee;
      --menu-border: #080808;
      --menu-hi: #585858;
      --menu-lo: #141414;
      --menu-shadow: 2px 2px 0 #050505;
      --menu-active-bg: #e0e0e0;
      --menu-active-fg: #141414;
      --menu-disabled-fg: #9a9a9a;
      --menu-disabled-etch: none;
      --menu-sep-top: #141414;
      --menu-sep-bottom: #525252;
      --scroll-track: #161616;
      --scroll-thumb: #4a4a4a;
      --scroll-thumb-hi: #6e6e6e;
      --scroll-thumb-lo: #242424;
    }
  }
  * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
  html, body {
    margin: 0; width: 100%; height: 100%; overflow: hidden;
    background: transparent; font: 12.5px/1.35 var(--font-ui);
  }
  #backdrop { position: fixed; inset: 0; background: transparent; }
  #menu {
    position: fixed; left: 8px; top: 8px;
    min-width: 188px; max-width: min(440px, calc(100vw - 8px));
    max-height: calc(100vh - 8px); overflow-y: auto; overflow-x: hidden;
    padding: 2px 1px;
    background: var(--menu-bg); color: var(--menu-fg);
    border: 1px solid var(--menu-border); border-radius: 0;
    box-shadow: inset 1px 1px 0 var(--menu-hi), inset -1px -1px 0 var(--menu-lo), var(--menu-shadow);
    outline: none;
  }
  #menu::-webkit-scrollbar { width: 14px; }
  #menu::-webkit-scrollbar-track { background: var(--scroll-track); border-left: 1px solid var(--menu-border); }
  #menu::-webkit-scrollbar-thumb {
    background-color: var(--scroll-thumb);
    background-image: linear-gradient(to bottom, rgba(255,255,255,.78) 0 1px, rgba(38,38,38,.58) 1px 2px, rgba(255,255,255,.78) 2px 3px, rgba(38,38,38,.58) 3px 4px, rgba(255,255,255,.78) 4px 5px, rgba(38,38,38,.58) 5px 6px);
    background-size: 7px 6px; background-repeat: no-repeat; background-position: center;
    border: 1px solid var(--menu-border);
    box-shadow: inset 1px 1px 0 var(--scroll-thumb-hi), inset -1px -1px 0 var(--scroll-thumb-lo);
  }
  .plat-sep {
    height: 2px; margin: 3px 1px;
    background: linear-gradient(to bottom, var(--menu-sep-top) 0 1px, var(--menu-sep-bottom) 1px 2px);
  }
  .plat-item {
    display: grid;
    grid-template-columns: ${checkColumn ? "14px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto"};
    align-items: center; column-gap: 10px;
    min-height: 23px; padding: 3px 11px;
    font-weight: 600; cursor: default; white-space: nowrap;
  }
  .plat-label { overflow: hidden; text-overflow: ellipsis; }
  .plat-accel {
    margin-left: 14px; font: 700 11px/1 var(--font-mono);
    opacity: .84; font-variant-numeric: tabular-nums;
  }
  .plat-check { display: inline-grid; place-items: center; width: 12px; height: 12px; }
  .plat-check[data-checked="true"]::before {
    content: ""; width: 7px; height: 3.5px;
    border-left: 2px solid currentColor; border-bottom: 2px solid currentColor;
    transform: translateY(-1px) rotate(-45deg);
  }
  .plat-item[aria-disabled="true"] {
    color: var(--menu-disabled-fg);
    text-shadow: var(--menu-disabled-etch);
  }
  .plat-item[data-active="true"] {
    background: var(--menu-active-bg);
    color: var(--menu-active-fg);
    text-shadow: none;
  }
  .plat-item[data-active="true"] .plat-accel { opacity: 1; }
  @media (forced-colors: active) {
    #menu { background: Canvas; color: CanvasText; border-color: CanvasText; box-shadow: none; }
    .plat-sep { background: GrayText; height: 1px; }
    .plat-item[aria-disabled="true"] { color: GrayText; text-shadow: none; }
    .plat-item[data-active="true"] { background: Highlight; color: HighlightText; }
  }
</style>
</head>
<body>
<div id="backdrop"></div>
<div id="menu" role="menu" tabindex="-1"></div>
<script>
(() => {
  const data = ${payload};
  const menu = document.getElementById("menu");
  const backdrop = document.getElementById("backdrop");
  const rows = [];
  const enabledIndices = [];
  let activePos = -1;
  const send = (msg) => { document.title = msg; };

  data.entries.forEach((entry, index) => {
    if (entry.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "plat-sep";
      sep.setAttribute("role", "separator");
      menu.appendChild(sep);
      rows.push(null);
      return;
    }
    const enabled = entry.enabled !== false && entry.id !== undefined;
    const row = document.createElement("div");
    row.className = "plat-item";
    row.setAttribute("role", entry.checkable || entry.checked !== undefined ? "menuitemcheckbox" : "menuitem");
    if (entry.checked !== undefined) row.setAttribute("aria-checked", String(Boolean(entry.checked)));
    if (!enabled) row.setAttribute("aria-disabled", "true");
    row.dataset.index = String(index);
    if (data.checkColumn) {
      const check = document.createElement("span");
      check.className = "plat-check";
      check.setAttribute("aria-hidden", "true");
      if (entry.checked) check.dataset.checked = "true";
      row.appendChild(check);
    }
    const label = document.createElement("span");
    label.className = "plat-label";
    label.textContent = entry.label;
    row.appendChild(label);
    const accel = document.createElement("span");
    accel.className = "plat-accel";
    accel.textContent = entry.accelerator || "";
    row.appendChild(accel);
    if (enabled) {
      const pos = enabledIndices.length;
      enabledIndices.push(index);
      row.addEventListener("pointermove", () => setActive(pos));
      row.addEventListener("click", (e) => { e.stopPropagation(); send("pick:" + index); });
    } else {
      row.addEventListener("pointermove", () => setActive(-1));
      row.addEventListener("click", (e) => e.stopPropagation());
    }
    menu.appendChild(row);
    rows.push(row);
  });

  function setActive(pos) {
    if (activePos === pos) return;
    if (activePos >= 0 && rows[enabledIndices[activePos]]) delete rows[enabledIndices[activePos]].dataset.active;
    activePos = pos;
    if (activePos >= 0 && rows[enabledIndices[activePos]]) {
      const el = rows[enabledIndices[activePos]];
      el.dataset.active = "true";
      el.scrollIntoView({ block: "nearest" });
    }
  }

  menu.addEventListener("pointerleave", () => setActive(-1));
  backdrop.addEventListener("mousedown", (e) => { e.preventDefault(); send("cancel"); });
  backdrop.addEventListener("contextmenu", (e) => { e.preventDefault(); send("cancel"); });

  function place() {
    const a = data.anchor;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = a.align === "end" ? (a.x + (a.width || 0) - w) : a.x;
    left = Math.max(4, Math.min(left, vw - w - 4));
    let top = a.y + (a.height || 0) + 2;
    if (top + h > vh - 4 && a.y - h - 2 >= 4) top = a.y - h - 2;
    else top = Math.max(4, Math.min(top, vh - h - 4));
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  place();
  window.addEventListener("resize", place);
  if (data.anchor.keyboard && enabledIndices.length) setActive(0);
  menu.focus();

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); send("cancel"); return; }
    if (!enabledIndices.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((activePos + 1) % enabledIndices.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(activePos <= 0 ? enabledIndices.length - 1 : activePos - 1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(enabledIndices.length - 1); }
    else if ((e.key === "Enter" || e.key === " ") && activePos >= 0) {
      e.preventDefault();
      send("pick:" + enabledIndices[activePos]);
    }
  });
})();
</script>
</body>
</html>`;
}
