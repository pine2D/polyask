import { assertDiagramSource, renderDiagramWithEngine, type DiagramImage } from './mermaid-engine';
export { DIAGRAM_TEXT_LIMIT, type DiagramImage } from './mermaid-engine';
const cache = new Map<string, DiagramImage>();
let queue: Promise<unknown> = Promise.resolve();

export function renderDiagram(source: string, dark: boolean, signal?: AbortSignal): Promise<DiagramImage> {
  try { assertDiagramSource(source); } catch (error) { return Promise.reject(error); }
  const key = `${dark}:${source}`;
  const job = queue.catch(() => undefined).then(async () => {
    if (signal?.aborted) throw new Error('diagram_cancelled');
    const old = cache.get(key);
    if (old) return old;
    const { default: mermaid } = await import('mermaid');
    const image = await renderDiagramWithEngine(source, dark, mermaid, signal);
    cache.set(key, image);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    return image;
  });
  queue = job;
  return job;
}
