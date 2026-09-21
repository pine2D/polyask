import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { app, screen, webContents, type BrowserWindow } from "electron";
import type { DiagnosticSource } from "./runtime-gates";

// Explicit local troubleshooting only: no page text, URLs, account data or IPC
// payloads. Normal runs allocate neither a stream nor event listeners.
export function startWindowTrace(window: BrowserWindow, source: DiagnosticSource): () => void {
  const path = process.env.POLYASK_WINDOW_TRACE;
  if (!path) return () => {};
  let stream: ReturnType<typeof createWriteStream>;
  try {
    mkdirSync(dirname(path), { recursive: true });
    stream = createWriteStream(path, { flags: "wx" });
  } catch { return () => {}; }
  let stopped = false;
  let count = 0;
  const started = Date.now();
  const removers: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const observed = new Set<number>();
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    for (const remove of removers) remove();
    removers.length = 0;
    observed.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    stream.end();
  };
  stream.on("error", dispose);
  const listen = (emitter: NodeJS.EventEmitter, event: string, listener: () => void) => {
    emitter.on(event, listener);
    removers.push(() => emitter.removeListener(event, listener));
  };
  const later = (delay: number, callback: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  };
  const record = (event: string) => {
    if (stopped || window.isDestroyed()) return;
    try {
      const sites = source.getDiagnosticSites().map(({ site, webContentsId, attached, bounds }) => {
        const contents = webContents.fromId(webContentsId);
        if (contents && !observed.has(webContentsId)) {
          observed.add(webContentsId);
          for (const name of ["did-start-loading", "did-stop-loading", "render-process-gone"]) {
            listen(contents, name, () => record(`site:${site}:${name}`));
          }
        }
        return { site, webContentsId, attached, bounds,
          zoom: contents && !contents.isDestroyed() ? contents.getZoomFactor() : null,
          loading: contents && !contents.isDestroyed() ? contents.isLoading() : null };
      });
      const layout = source.getLayout();
      const row = { schema: 1, elapsedMs: Date.now() - started, event,
        window: { minimized: window.isMinimized(), maximized: window.isMaximized(),
          bounds: window.getBounds(), contentSize: window.getContentSize(), zoom: window.webContents.getZoomFactor() },
        layout: { mode: layout.mode, automaticFocus: layout.automaticFocus, page: layout.page, placements: layout.placements }, sites,
        ...(count === 0 ? { runtime: { version: app.getVersion(), platform: process.platform,
          electron: process.versions.electron, chrome: process.versions.chrome, gpu: app.getGPUFeatureStatus(),
          displays: screen.getAllDisplays().map(({ scaleFactor, bounds }) => ({ scaleFactor, bounds })) } } : {}) };
      count++;
      // Backpressure stops recording rather than growing memory or blocking paint.
      if (!stream.write(`${JSON.stringify(row)}\n`) || count >= 4096) dispose();
    } catch { dispose(); }
  };
  for (const event of ["minimize", "restore", "maximize", "unmaximize", "resize", "resized", "show", "hide"]) {
    listen(window, event, () => {
      record(event);
      if (event === "restore" && !stopped) {
        for (const delay of [0, 50, 250, 1000]) later(delay, () => record(`restore+${delay}`));
      }
    });
  }
  listen(window, "closed", dispose);
  later(120_000, dispose);
  record("start");
  return dispose;
}
