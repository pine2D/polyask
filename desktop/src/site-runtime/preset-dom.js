// 仅用于显式预设交互；候选必须有当前菜单归属和唯一、完整的标签。
(function () {
  'use strict';
  const S = window.__AMS; if (!S) return;
  const fail = S.presetFail;
  const visible = el => !!el?.isConnected && !el.closest('[hidden],[aria-hidden="true"],[role="menu"][data-state="closed"],[role="dialog"][data-state="closed"]') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const enabled = el => !!el && !el.closest('[disabled],[aria-disabled="true"],[data-disabled]:not([data-disabled="false"])');
  const text = el => (el?.textContent || '').replace(/[\u200b-\u200d\ufeff]/g, '').trim();
  function firstText(el) {
    if (!el) return '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && text(node)) return text(node);
      if (node.nodeType === 1 && !node.matches('svg,[aria-hidden="true"],[hidden]')) {
        const found = firstText(node); if (found) return found;
      }
    }
    return '';
  }
  const check = (deadline, context) => S.presetCheck(deadline, context);
  async function wait(find, deadline, url, ms = 1400) {
    check(deadline, url);
    const value = await S.waitFor(() => { check(deadline, url); return find(); }, ms, 60, deadline);
    check(deadline, url); if (!value) fail(); return value;
  }
  const act = (deadline, url, action) => { check(deadline, url); return S.tierAction(deadline, action); };
  function click(el, deadline, url, open = false) {
    if (!visible(el) || !enabled(el)) fail();
    act(deadline, url, () => open ? S.openMenu(el) : el.click());
  }
  function labels(items, secondary = false) {
    const names = items.map(item => item.label);
    if (names.length > (secondary ? 12 : 50) || names.some(name => !S.presetName(name, secondary ? 24 : 48)) || new Set(names).size !== names.length) fail();
    return names;
  }
  function unique(items, label) {
    labels(items); const found = items.filter(item => item.label === label);
    if (found.length !== 1) fail(); return found[0];
  }
  function selected(items) {
    labels(items); const found = items.filter(item => item.selected);
    if (found.length !== 1) fail(); return found[0].label;
  }
  function owned(trigger, selector = '[role="menu"]') {
    if (!trigger || trigger.getAttribute('aria-expanded') === 'false') return null;
    const ids = (trigger.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
    const roots = [...document.querySelectorAll(selector)].filter(visible).filter(root =>
      ids.includes(root.id) || trigger.id && (root.getAttribute('aria-labelledby') || '').split(/\s+/).includes(trigger.id));
    if (roots.length > 1) fail(); return roots[0] || null;
  }
  async function close(roots, deadline, cleanup) {
    for (const root of roots()) root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    S.escMenus();
    if (cleanup) await cleanup(deadline);
    if (roots().length && Date.now() < deadline) await S.waitFor(() => !roots().length, 500, 40, deadline);
    if (roots().length) fail();
  }
  S.presetDom = { visible, enabled, text, firstText, check, wait, act, click, labels, unique, selected, owned, close };
})();
