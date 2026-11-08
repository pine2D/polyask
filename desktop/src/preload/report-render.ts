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
