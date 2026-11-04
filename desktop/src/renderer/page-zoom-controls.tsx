import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { SiteZoomAction } from '../shared/site-zoom';
import { ZoomInIcon, ZoomOutIcon } from './icons';
import { shell } from './shell-api';
import { shortcutLabel } from './shortcut-label';
import { isMac } from './platform';

export function PageZoomControls({ copy }: { readonly copy: DesktopCopy }): React.JSX.Element {
  const [zoom, setZoom] = useState(1), [failed, setFailed] = useState(false);
  const lifetime = useRef(0), revision = useRef(0);
  const available = typeof shell.getPageZoom === 'function' && typeof shell.onPageZoom === 'function' && typeof shell.changePageZoom === 'function';
  useEffect(() => {
    const life = ++lifetime.current;
    if (!available) return;
    const unsubscribe = shell.onPageZoom(value => { revision.current++; setZoom(value); setFailed(false); });
    const initial = revision.current;
    void shell.getPageZoom().then(value => {
      if (lifetime.current === life && revision.current === initial) setZoom(value);
    }).catch(() => { if (lifetime.current === life && revision.current === initial) setFailed(true); });
    return () => { lifetime.current++; unsubscribe(); };
  }, [available]);
  const change = (action: SiteZoomAction) => {
    const life = lifetime.current, intent = ++revision.current;
    setFailed(false);
    void shell.changePageZoom(action).then(value => {
      if (lifetime.current === life && revision.current === intent) setZoom(value);
    }).catch(() => { if (lifetime.current === life && revision.current === intent) setFailed(true); });
  };
  return <div className="page-zoom" role="group" aria-label={copy.pageZoom}>
    <button type="button" className="page-zoom-out" disabled={!available || zoom <= 0.251}
      aria-label={copy.menuZoomOut} title={`${copy.menuZoomOut} (${shortcutLabel('CmdOrCtrl+-', isMac)})`} onClick={() => change('out')}><ZoomOutIcon /></button>
    <button type="button" className="page-zoom-reset" disabled={!available} aria-label={`${copy.pageZoomReset} · ${Math.round(zoom * 100)}%`}
      title={`${copy.pageZoomReset} (${shortcutLabel('CmdOrCtrl+0', isMac)}) · ${copy.pageZoomWheel}`} onClick={() => change('reset')}>{Math.round(zoom * 100)}%</button>
    <button type="button" className="page-zoom-in" disabled={!available || zoom >= 4.999}
      aria-label={copy.menuZoomIn} title={`${copy.menuZoomIn} (${shortcutLabel('CmdOrCtrl+Plus', isMac)})`} onClick={() => change('in')}><ZoomInIcon /></button>
    {failed && <span className="page-zoom-error" role="status">{copy.pageZoomFailed}</span>}
  </div>;
}
