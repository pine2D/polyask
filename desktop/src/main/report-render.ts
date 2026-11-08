import { BrowserWindow, session, nativeImage, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ReportPdfOptions } from './report-export-service';
import { destroyReportWindow } from './report-pdf';
import { REPORT_DIAGRAM_LIMIT, validReportPng } from './report-visuals';

let busy = false;
const SCHEME = 'polyask-report-render';
/** Bundled preload only. Source strings cross contextBridge as data; no source HTML is loaded. */
export async function renderReportDiagrams(sources: readonly string[], options: ReportPdfOptions, preload: string): Promise<Map<string, string>> {
  options.guard();
  if (options.signal.aborted) throw new Error('report_source_changed');
  if (busy) throw new Error('report_busy');
  const selected = sources.slice(0, REPORT_DIAGRAM_LIMIT).filter(source => source.length <= 20_000);
  const result = new Map<string, string>();
  if (!selected.length) return result;
  busy = true;
  const isolated = session.fromPartition('polyask-report-render', { cache: false });
  const url = `${SCHEME}://${randomUUID()}/index.html`;
  let contents: WebContents | null = null;
  let window: BrowserWindow | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let rejectStopped: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const cancel = () => rejectStopped(new Error('report_source_changed'));
  const failed = () => rejectStopped(new Error('diagram_failed'));
  const prevent = (event: { preventDefault(): void }) => event.preventDefault();
  try {
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on('will-download', prevent);
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== url || details.resourceType !== 'mainFrame' }));
    isolated.protocol.handle(SCHEME, request => request.url === url ? new Response(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>', { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
      } }) : new Response('', { status: 404 }));
    window = new BrowserWindow({ show: false, webPreferences: { session: isolated, preload,
      sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, javascript: true,
      webviewTag: false, devTools: false, spellcheck: false, disableDialogs: true, navigateOnDragDrop: false } });
    const page = window.webContents; contents = page;
    page.setWindowOpenHandler(() => ({ action: 'deny' }));
    page.on('will-navigate', prevent); page.on('will-frame-navigate', prevent);
    page.on('will-redirect', prevent); page.on('will-attach-webview', prevent);
    window.once('closed', failed); page.once('render-process-gone', failed);
    options.signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => rejectStopped(new Error('report_pdf_timeout')), Math.max(0, Math.min(30_000, (options.deadline ?? Date.now() + 30_000) - Date.now())));
    // A stuck diagram must also release promptly after source deletion/reset/window closure.
    poll = setInterval(() => { try { options.guard(); } catch (error) { rejectStopped(error as Error); } }, 100);
    const render = async () => {
      await window!.loadURL(url); options.guard();
      if (options.signal.aborted || page.isDestroyed()) throw new Error('report_source_changed');
      const images: unknown = await page.executeJavaScript(`window.reportRender(${JSON.stringify(selected).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')})`);
      options.guard();
      if (!Array.isArray(images) || images.length !== selected.length) return;
      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        // Validate before native decoding, then re-encode to discard metadata and trailing payloads.
        if (!validReportPng(image)) continue;
        const decoded = nativeImage.createFromDataURL(image);
        if (decoded.isEmpty()) continue;
        const png = `data:image/png;base64,${decoded.toPNG().toString('base64')}`;
        if (validReportPng(png)) result.set(selected[index], png);
      }
    };
    try { await Promise.race([render(), stopped]); }
    catch (error) { options.guard(); if (error instanceof Error && error.message === 'report_pdf_timeout') throw error; if (options.signal.aborted) throw new Error('report_source_changed'); /* keep readable code */ }
    options.guard();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    options.signal.removeEventListener('abort', cancel);
    window?.removeListener('closed', failed);
    contents?.removeListener('render-process-gone', failed);
    try { await destroyReportWindow(window, contents); }
    finally {
      isolated.protocol.unhandle(SCHEME); isolated.webRequest.onBeforeRequest(null);
      isolated.removeListener('will-download', prevent);
      isolated.setPermissionRequestHandler(null); isolated.setPermissionCheckHandler(null); busy = false;
    }
  }
}
