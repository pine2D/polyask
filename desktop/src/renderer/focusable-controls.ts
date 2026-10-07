const CANDIDATES = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]';

function editable(node: HTMLElement | null): boolean {
  while (node) {
    const value = node.getAttribute('contenteditable')?.toLowerCase();
    if (value === '' || value === 'true' || value === 'plaintext-only') return true;
    if (value === 'false') return false;
    node = node.parentElement;
  }
  return false;
}

function visible(node: HTMLElement): boolean {
  if (node.closest('[hidden],[inert]')) return false;
  // Real browsers can check rendered boxes; jsdom has no layout, so use styles there.
  if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const view = node.ownerDocument.defaultView;
  if (!view) return false;
  const visibility = view.getComputedStyle(node).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    if (style.display === 'none' || parseFloat(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
    if (ancestor !== node && ancestor.tagName === 'DETAILS' && !ancestor.hasAttribute('open')) {
      const summary = [...ancestor.children].find(child => child.tagName === 'SUMMARY');
      if (!summary?.contains(node)) return false;
    }
  }
  return true;
}

/** Visible controls in sequential keyboard order, for local focus circles. */
export function focusableControls(root: HTMLElement): HTMLElement[] {
  if (!root.isConnected) return [];
  const controls = [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(node => {
    if (node.matches(':disabled,input[type="hidden"]') || !visible(node)) return false;
    const tabIndex = node.getAttribute('tabindex');
    if (tabIndex !== null && !Number.isNaN(parseInt(tabIndex, 10))) return node.tabIndex >= 0;
    if (node.matches('a[href],button,input,select,textarea')) return true;
    if (node.tagName === 'SUMMARY') return node.parentElement?.tagName === 'DETAILS'
      && [...node.parentElement.children].find(child => child.tagName === 'SUMMARY') === node;
    return editable(node) && !editable(node.parentElement);
  });
  const rank = (node: HTMLElement) => node.tabIndex > 0 ? node.tabIndex : Infinity;
  return controls.sort((a, b) => {
    const order = rank(a) - rank(b);
    return (Number.isNaN(order) ? 0 : order) || (a.compareDocumentPosition(b) & 4 ? -1 : 1);
  });
}
