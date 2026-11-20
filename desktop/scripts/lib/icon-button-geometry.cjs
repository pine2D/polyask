// Shared Chromium probe for icon-only button centering & aspect-ratio integrity (returns scalars only).
const ICON_BUTTON_PROBE_SOURCE = `(() => {
  const results = [];
  for (const el of document.querySelectorAll('button, summary')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const svgs = [...el.querySelectorAll('svg')].filter(s => {
      const scs = getComputedStyle(s);
      return scs.display !== 'none' && scs.visibility !== 'hidden' && s.getBoundingClientRect().width > 0;
    });
    if (svgs.length !== 1) continue;
    let visibleText = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (!p || p.closest('svg, .sr-only')) continue;
      let hidden = false, cur = p;
      while (cur && cur !== el) {
        const pcs = getComputedStyle(cur);
        if (pcs.display === 'none' || pcs.visibility === 'hidden') { hidden = true; break; }
        cur = cur.parentElement;
      }
      if (!hidden) visibleText += node.textContent;
    }
    if (visibleText.trim() !== '') continue;
    const sRect = svgs[0].getBoundingClientRect();
    const dx = +(((sRect.left + sRect.right) / 2) - ((rect.left + rect.right) / 2)).toFixed(2);
    const dy = +(((sRect.top + sRect.bottom) / 2) - ((rect.top + rect.bottom) / 2)).toFixed(2);
    const segmented = !!el.closest('.scope-split, .mode-switch, .tier-switch, .question-restore-split');
    results.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || ''),
      label: el.getAttribute('aria-label') || el.getAttribute('title') || '',
      btnW: +rect.width.toFixed(2),
      btnH: +rect.height.toFixed(2),
      svgW: +sRect.width.toFixed(2),
      svgH: +sRect.height.toFixed(2),
      dx,
      dy,
      segmented
    });
  }
  return results;
})()`;

function findIconButtonIssues(items, contextLabel) {
  const issues = [];
  for (const b of items) {
    const id = `${contextLabel} <${b.tag}.${b.cls}> (${b.label})`;
    if (Math.abs(b.dx) > 0.6 || Math.abs(b.dy) > 0.6) {
      issues.push(`${id}: icon off-center dx=${b.dx}px dy=${b.dy}px in ${b.btnW}x${b.btnH}`);
    }
    if (b.svgW < 8 || b.svgH < 8 || Math.abs(b.svgW - b.svgH) > 1.5) {
      issues.push(`${id}: icon SVG deformed ${b.svgW}x${b.svgH} in ${b.btnW}x${b.btnH}`);
    }
    if (!b.segmented && Math.abs(b.btnW - b.btnH) > 6) {
      issues.push(`${id}: standalone icon button non-square ${b.btnW}x${b.btnH}`);
    }
  }
  return issues;
}

module.exports = { ICON_BUTTON_PROBE_SOURCE, findIconButtonIssues };
