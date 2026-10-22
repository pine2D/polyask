// Compare rendered user Markdown without confusing literal punctuation with formatting.
// The parser is bundled from desktop's existing dependency; no page globals or remote code.
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  let parser, expected = null;
  const actual = new WeakMap();
  const FORMATS = /^(H[1-6]|STRONG|B|EM|I|UL|OL|LI|BLOCKQUOTE|PRE|CODE|TABLE|TR|TD|TH|HR|A|DEL|S)$/;
  function fingerprint(root, normalize) {
    const structure = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    // Tree order is explicit for both inert template content and the live page.
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!FORMATS.test(node.tagName)) continue;
      let hidden = false;
      for (let p = node; p && p !== root; p = p.parentElement) if (S.mdHead.drop(p)) { hidden = true; break; }
      if (hidden) continue;
      const tag = ({ B: 'STRONG', I: 'EM', S: 'DEL' })[node.tagName] || node.tagName;
      // Code spaces/newlines are content. The outer normalized text alone cannot guard them.
      const text = tag === 'CODE' ? node.textContent : S.toMarkdown(node);
      structure.push([tag, /^(PRE|CODE)$/.test(tag) ? text : normalize(text)]);
    }
    // Structure also distinguishes a literal '# title' paragraph from a heading;
    // the answer exporter deliberately does not escape every block-leading character.
    return JSON.stringify([normalize(S.toMarkdown(root)), structure]);
  }
  S.matchesPromptMarkup = (root, source, normalize) => {
    try {
      if (!expected || expected.source !== source) {
        parser ||= new (require('markdown-it'))({ html: false, linkify: false, typographer: false }).disable('image');
        // A detached template is inert: never insert its content into the page.
        // Raw HTML and Markdown images cannot create executable or fetching nodes.
        const template = document.createElement('template');
        template.innerHTML = '<div>' + parser.render(source) + '</div>';
        expected = { source, value: fingerprint(template.content.firstElementChild, normalize) };
      }
      const html = root.innerHTML;
      let cached = actual.get(root);
      if (!cached || cached.html !== html) {
        cached = { html, value: fingerprint(root, normalize) };
        actual.set(root, cached);
      }
      return cached.value === expected.value;
    } catch (_) { return false; }
  };
}());
