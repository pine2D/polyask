import { contextBridge } from 'electron';
import mermaid from 'mermaid';
import { renderDiagramWithEngine } from '../renderer/mermaid-engine';

// Trusted bundled code runs in its own sandbox, never in the final report window.
contextBridge.exposeInMainWorld('reportRender', async (sources: unknown) => {
  if (!Array.isArray(sources) || sources.length > 24 || sources.some(item => typeof item !== 'string' || item.length > 20_000)) return [];
  const results: (string | null)[] = [];
  for (const source of sources) {
    try {
      const diagram = await renderDiagramWithEngine(source, false, mermaid);
      const width = Math.ceil(diagram.width * 2), height = Math.ceil(diagram.height * 2);
      if (width > 4096 || height > 4096 || width * height > 8 * 1024 * 1024) throw new Error('diagram_limit');
      const image = new Image();
      image.src = diagram.url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('diagram_failed');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      results.push(canvas.toDataURL('image/png'));
      canvas.width = 0; canvas.height = 0;
    } catch { results.push(null); }
  }
  return results;
});

contextBridge.exposeInMainWorld('reportFitMath', async () => {
  // Mirror the final A4 content box and print font; no user-controlled style enters here.
  const style = document.createElement('style');
  style.textContent = 'body { width:178mm; max-width:none; margin:0; padding:0; font-size:10.5pt; }';
  document.head.append(style);
  await document.fonts.ready;
  const page = document.createElement('div');
  page.style.height = '261mm'; document.body.append(page);
  const pageHeight = page.getBoundingClientRect().height; page.remove();
  const formulas = [...document.querySelectorAll<MathMLElement>('math[data-report-math]')];
  if (formulas.length > 2048) return []; // Bound repeated placements as well as unique formulas.
  const seen = new Set<number>(), rejected = new Set<number>();
  for (const formula of formulas) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const id = Number(formula.dataset.reportMath);
    if (!Number.isInteger(id) || id < 0 || id >= 256) return [];
    seen.add(id);
    if (formula.getBoundingClientRect().height > pageHeight - 1) { rejected.add(id); continue; }
    let container = formula.parentElement;
    while (container && getComputedStyle(container).display === 'inline') container = container.parentElement;
    if (!container) { rejected.add(id); continue; }
    const box = container.getBoundingClientRect(), css = getComputedStyle(container);
    const left = box.left + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
    const right = box.right - parseFloat(css.paddingRight) - parseFloat(css.borderRightWidth);
    for (const node of [formula, ...formula.querySelectorAll('*')]) {
      const bounds = node.getBoundingClientRect();
      if (!Number.isFinite(bounds.right) || bounds.left < left - .5 || bounds.right > right + .5) { rejected.add(id); break; }
    }
  }
  return [...seen].filter(id => !rejected.has(id));
});
