import { useEffect, useState } from 'react';
import { getCopy } from '../shared/copy';
import { CopyIcon, ZoomInIcon, ZoomOutIcon, FitIcon } from './icons';
import { renderDiagram, type DiagramImage } from './mermaid-renderer';

export function MermaidPreview({ source }: { readonly source: string }): React.JSX.Element {
  const copy = getCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
  const [code, setCode] = useState(false), [zoom, setZoom] = useState(1), [notice, setNotice] = useState('');
  const [dark, setDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  const [result, setResult] = useState<{ source: string; dark: boolean; image?: DiagramImage; error?: string }>();
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setDark(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setZoom(1); setNotice('');
    if (source.trim()) void renderDiagram(source, dark, controller.signal).then(image => {
      if (active) setResult({ source, dark, image });
    }).catch(error => { if (active) setResult({ source, dark, error: String(error.message) }); });
    return () => { active = false; controller.abort(); };
  }, [source, dark]);
  const current = result?.source === source && result.dark === dark ? result : undefined;
  const failed = !source.trim() || !!current?.error;
  const showCode = code || failed || !current?.image;
  const message = !source.trim() ? copy.readingDiagramMissing : current?.error === 'diagram_limit' ? copy.readingDiagramLimit : current?.error ? copy.readingDiagramFailed : !current ? copy.readingDiagramLoading : '';
  return <figure className="mermaid-preview" aria-label={copy.readingDiagram}>
    <figcaption><span className="mermaid-label">mermaid</span><div className="mermaid-tabs" role="group" aria-label={copy.readingDiagram}>
      <button type="button" aria-pressed={!code} onClick={() => setCode(false)}>{copy.readingPreview}</button>
      <button type="button" aria-pressed={code} onClick={() => setCode(true)}>{copy.readingSource}</button>
    </div><div className="mermaid-actions">
      <button type="button" disabled={showCode || zoom <= .5} aria-label={copy.readingZoomOut} data-hint={copy.readingZoomOut} onClick={() => setZoom(z => Math.max(.5, z - .25))}><ZoomOutIcon /></button>
      <button type="button" disabled={showCode || zoom >= 3} aria-label={copy.readingZoomIn} data-hint={copy.readingZoomIn} onClick={() => setZoom(z => Math.min(3, z + .25))}><ZoomInIcon /></button>
      <button type="button" disabled={showCode} aria-label={copy.readingZoomReset} data-hint={copy.readingZoomReset} onClick={() => setZoom(1)}><FitIcon /></button>
      <button type="button" disabled={!source.trim()} aria-label={copy.readingCopySource} data-hint={copy.readingCopySource} onClick={() => {
        void navigator.clipboard.writeText(source).then(() => setNotice(copy.readingSourceCopied)).catch(() => setNotice(copy.readingCopyFailed));
      }}><CopyIcon /></button>
    </div></figcaption>
    {message && <p className="mermaid-notice" role="status">{message}</p>}
    {!showCode && current?.image && <div className="mermaid-canvas" tabIndex={0} role="region" aria-label={copy.readingDiagram}>
      <img src={current.image.url} alt={copy.readingDiagram} style={{ width: `${zoom * 100}%`, maxWidth: `${current.image.width * zoom}px` }} />
    </div>}
    <pre hidden={!showCode}><code>{source}</code></pre>
    <span className="sr-only" aria-live="polite">{notice}</span>
  </figure>;
}
