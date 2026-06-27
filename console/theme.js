// console/theme.js — 主题：auto(随系统)/light/dark。console 与 compose 共用。
// 真值存 storage.sync.amsTheme（跨设备，popup 里改）；另镜像到 localStorage 供 <head>
// 内联脚本同步抢先应用、消除首帧闪烁。auto 时不设 data-theme，交给 console.css 的 @media 跟随系统。
(function () {
  function apply(pref) {
    const root = document.documentElement;
    if (pref === "light" || pref === "dark") root.dataset.theme = pref;
    else root.removeAttribute("data-theme");
    try { localStorage.amsTheme = pref || "auto"; } catch (e) {}
  }
  chrome.storage.sync.get({ amsTheme: "auto" }, (v) => apply(v.amsTheme));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "sync" && c.amsTheme) apply(c.amsTheme.newValue);
  });
})();
