// 固定只读程序，在独立世界运行；只返回位置，不修改 DOM、选区、焦点或滚动。
const READ_POSITIONS = String.raw`async function(query, expected) {
  if (!query || query.length > 512 || !Number.isSafeInteger(expected) || expected <= 0) return null;
  const root = document.scrollingElement || document.documentElement;
  if (!root || !document.body) return null;
  const style = getComputedStyle(root), bodyStyle = getComputedStyle(document.body);
  const bar = getComputedStyle(root, '::-webkit-scrollbar');
  if (root.scrollHeight > root.clientHeight + 1 && !['hidden', 'clip'].includes(style.overflowY) &&
      !['hidden', 'clip'].includes(bodyStyle.overflowY) && style.scrollbarWidth !== 'none' &&
      bar.display !== 'none' && bar.width !== '0px') return null;
  const deadline = performance.now() + 350;
  const styles = new WeakMap(), visible = new WeakMap(), owners = new WeakMap(), blocks = new WeakMap();
  const css = element => { if (!styles.has(element)) styles.set(element, getComputedStyle(element)); return styles.get(element); };
  const shown = element => {
    if (!element) return true;
    if (visible.has(element)) return visible.get(element);
    const value = !element.matches('script,style,noscript,template,input,textarea,select,[hidden],[contenteditable]:not([contenteditable="false"])') &&
      css(element).display !== 'none' && !['hidden', 'collapse'].includes(css(element).visibility) && shown(element.parentElement);
    visible.set(element, value); return value;
  };
  const owner = element => {
    if (!element || element === root) return root;
    if (owners.has(element)) return owners.get(element);
    const value = element.scrollHeight > element.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(css(element).overflowY)
      ? element : owner(element.parentElement);
    owners.set(element, value); return value;
  };
  const block = element => {
    if (!element) return document.body;
    if (blocks.has(element)) return blocks.get(element);
    const value = /^(inline|contents)/.test(css(element).display) ? block(element.parentElement) : element;
    blocks.set(element, value); return value;
  };
  const pattern = new RegExp(query.replace(/[{}.*+?^$()|[\]\\]/g, '\\$&'), 'giu');
  let current = null, text = '', parts = [], count = 0, scrollOwner = null, invalid = false;
  const positions = new Set();
  const flush = () => {
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(text));) {
      if (performance.now() > deadline) { invalid = true; break; }
      const start = parts.find(part => part.end > match.index);
      const endOffset = match.index + match[0].length;
      const end = parts.find(part => part.end >= endOffset);
      if (!start || !end) { invalid = true; break; }
      const range = document.createRange();
      range.setStart(start.node, match.index - start.start); range.setEnd(end.node, endOffset - end.start);
      const rect = range.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) continue;
      count++;
      const container = owner(start.node.parentElement);
      if (scrollOwner && scrollOwner !== container) { invalid = true; break; }
      scrollOwner = container;
      const top = container === root ? 0 : container.getBoundingClientRect().top + container.clientTop;
      const ratio = (rect.top - top + container.scrollTop) / Math.max(1, container.scrollHeight);
      positions.add(Math.round(Math.max(0, Math.min(1, ratio)) * 999) / 999);
    }
    text = ''; parts = [];
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let visited = 0, characters = 0, slice = performance.now();
  for (let node; (node = walker.nextNode());) {
    if (++visited > 50000 || performance.now() > deadline) return null;
    if (performance.now() - slice > 8) { await new Promise(resolve => setTimeout(resolve, 0)); slice = performance.now(); }
    if (!shown(node.parentElement)) { flush(); current = null; continue; }
    const parent = block(node.parentElement);
    if (parent !== current) { flush(); current = parent; }
    if (invalid) return null;
    const value = node.nodeValue || '';
    if ((characters += value.length) > 1000000) return null;
    parts.push({ node, start: text.length, end: text.length + value.length }); text += value;
  }
  flush();
  if (invalid || count !== expected || !scrollOwner || scrollOwner.scrollHeight <= scrollOwner.clientHeight + 1) return null;
  return [...positions].sort((a, b) => a - b);
}`;

export function findPositionScript(query: string, matches: number): string {
  return `(${READ_POSITIONS})(${JSON.stringify(query)},${JSON.stringify(matches)})`;
}
