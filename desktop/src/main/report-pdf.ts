import { BrowserWindow, session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ReportPdfOptions } from './report-export-service';
import { REPORT_CSP } from './report-template';

export const REPORT_PDF_TIMEOUT_MS = 30_000;
const SCHEME = 'polyask-report';
let printing = false;

async function destroyReportWindow(window: BrowserWindow | null, contents: WebContents | null): Promise<void> {
  if (!contents || contents.isDestroyed()) {
    if (window && !window.isDestroyed()) window.destroy();
    return;
  }
  // BrowserWindow.destroy 返回时 WebContents 仍可能存活；等真正销毁后才释放模板和会话钩子。
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); contents.removeListener('destroyed', finish); resolve(); };
    const timer = setTimeout(() => { contents.removeListener('destroyed', finish); reject(new Error('report_pdf_failed')); }, 2_000);
    contents.once('destroyed', finish);
    if (window && !window.isDestroyed()) window.destroy();
    if (contents.isDestroyed()) finish();
  });
}

/** 独立内存会话仅服务此模板；不用外壳或站点的登录态、preload 和权限。 */
export async function printReportPdf(html: string, options: ReportPdfOptions & { readonly timeoutMs?: number }): Promise<Uint8Array> {
  options.guard();
  if (options.signal.aborted) throw new Error('report_source_changed');
  if (printing) throw new Error('report_busy');
  const token = randomUUID(), url = `${SCHEME}://${token}/report.html`;
  // Electron 会缓存 Session 对象；复用专用内存分区，避免每次打印遗留一个会话。
  const isolated = session.fromPartition('polyask-reports', { cache: false });
  printing = true;
  let window: BrowserWindow | null = null;
  let contents: WebContents | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStopped: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const cancel = () => rejectStopped(new Error('report_source_changed'));
  const failed = () => rejectStopped(new Error('report_pdf_failed'));
  const prevent = (event: { preventDefault(): void }) => event.preventDefault();
  try {
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on('will-download', prevent);
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== url || details.resourceType !== 'mainFrame' }));
    isolated.protocol.handle(SCHEME, request => request.url === url
      ? new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': REPORT_CSP, 'Cache-Control': 'no-store' } })
      : new Response('', { status: 404 }));
    window = new BrowserWindow({ show: false, width: 860, height: 1100, webPreferences: {
      session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true,
      javascript: false, webviewTag: false, devTools: false, spellcheck: false, disableDialogs: true,
      navigateOnDragDrop: false
    } });
    contents = window.webContents;
    const page = contents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', prevent);
    contents.on('will-frame-navigate', prevent);
    contents.on('will-redirect', prevent);
    contents.on('will-attach-webview', prevent);
    contents.once('render-process-gone', failed);
    window.once('closed', failed);
    options.signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => rejectStopped(new Error('report_pdf_timeout')), options.timeoutMs ?? REPORT_PDF_TIMEOUT_MS);
    const generate = async () => {
      // 主进程发起的唯一 loadURL 不经过 will-navigate，其余导航全部拒绝。
      await window!.loadURL(url); options.guard();
      if (options.signal.aborted || page.isDestroyed()) throw new Error('report_source_changed');
      const pdf = await page.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
        generateTaggedPDF: true, generateDocumentOutline: true });
      options.guard();
      return pdf;
    };
    return await Promise.race([generate(), stopped]);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal.removeEventListener('abort', cancel);
    window?.removeListener('closed', failed);
    contents?.removeListener('render-process-gone', failed);
    try { await destroyReportWindow(window, contents); }
    finally {
      try {
        isolated.protocol.unhandle(SCHEME);
        isolated.webRequest.onBeforeRequest(null);
        isolated.removeListener('will-download', prevent);
        isolated.setPermissionRequestHandler(null);
        isolated.setPermissionCheckHandler(null);
      } finally { printing = false; }
    }
  }
}
