export interface DiagramImage { readonly url: string; readonly width: number; readonly height: number }
export const DIAGRAM_TEXT_LIMIT = 20_000;
let serial = 0;

// 图片上下文隔离 SVG；再剔除主动内容及外部资源，不把站点 HTML 注入外壳。
function imageOf(svg: string): DiagramImage {
  if (svg.length > 2_000_000) throw new Error('diagram_limit');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('diagram_invalid');
  const root = doc.documentElement;
  root.querySelectorAll('script,foreignObject,image').forEach(node => node.remove());
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || (attr.localName === 'href' && !attr.value.startsWith('#'))) node.removeAttributeNode(attr);
      else if (/url\(\s*['"]?(?!#)/i.test(attr.value)) throw new Error('diagram_invalid');
    }
    if (node.localName === 'style' && /@import|url\(\s*['"]?(?!#)/i.test(node.textContent ?? '')) throw new Error('diagram_invalid');
  }
  const bounds = (root.getAttribute('viewBox') ?? '').split(/[ ,]+/).map(Number);
  const width = bounds[2], height = bounds[3];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 20_000 || height > 20_000) throw new Error('diagram_limit');
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
  return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root)), width, height };
}

export async function renderDiagramWithEngine(source: string, dark: boolean, mermaid: typeof import('mermaid').default, signal?: AbortSignal): Promise<DiagramImage> {
  assertDiagramSource(source);
  if (signal?.aborted) throw new Error('diagram_cancelled');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
    layout: 'dagre', htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: DIAGRAM_TEXT_LIMIT, maxEdges: 200,
    suppressErrorRendering: true, secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'flowchart', 'theme', 'layout'] });
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try { return imageOf((await mermaid.render(`history-diagram-${++serial}`, source, host)).svg); }
  finally { host.remove(); }
}

export function assertDiagramSource(source: string): void {
  // Count label separators too: edge limits alone cannot bound thousands of independent nodes.
  if (source.length > DIAGRAM_TEXT_LIMIT || source.split(/[;\n&]/).length > 250) throw new Error('diagram_limit');
  // Source directives cannot override the trusted rendering configuration.
  if (/%%\s*\{|^---\s*\n[\s\S]*?\bconfig\s*:/m.test(source)) throw new Error('diagram_invalid');
}
