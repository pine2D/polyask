export interface DiagramImage { readonly url: string; readonly width: number; readonly height: number }
export const DIAGRAM_TEXT_LIMIT = 20_000;
const cache = new Map<string, DiagramImage>();
let queue: Promise<unknown> = Promise.resolve(), serial = 0;

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

export function renderDiagram(source: string, dark: boolean, signal?: AbortSignal): Promise<DiagramImage> {
  // 保守计算语句分隔符（标签内也计数），先挡住单行数千个独立节点；边数限额不能保护这种图。
  if (source.length > DIAGRAM_TEXT_LIMIT || source.split(/[;\n&]/).length > 250) return Promise.reject(new Error('diagram_limit'));
  // 原始源码仍保留；回答里的配置指令不能改外壳的安全、预算或主题配置。
  if (/%%\s*\{|^---\s*\n[\s\S]*?\bconfig\s*:/m.test(source)) return Promise.reject(new Error('diagram_invalid'));
  const key = `${dark}:${source}`;
  const job = queue.catch(() => undefined).then(async () => {
    if (signal?.aborted) throw new Error('diagram_cancelled');
    const old = cache.get(key);
    if (old) return old;
    const { default: mermaid } = await import('mermaid');
    if (signal?.aborted) throw new Error('diagram_cancelled');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
      layout: 'dagre', htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: DIAGRAM_TEXT_LIMIT, maxEdges: 200,
      suppressErrorRendering: true, secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'flowchart', 'theme', 'layout'] });
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
    document.body.append(host);
    try {
      const image = imageOf((await mermaid.render(`history-diagram-${++serial}`, source, host)).svg);
      cache.set(key, image);
      if (cache.size > 12) cache.delete(cache.keys().next().value!);
      return image;
    }
    finally { host.remove(); }
  });
  queue = job;
  return job;
}
