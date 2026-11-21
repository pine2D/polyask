import { webContents, WebContentsView, type BrowserWindow } from "electron";
import { normalizePopupAnchor, type PopupAnchor } from "../shared/popup-anchor";
import { buildPlatinumPopupHtml, type PlatinumPopupEntry } from "./platinum-popup-template";
import { onWindowUiTheme, windowUiTheme } from "./native-shell-policy";

export type { PlatinumPopupEntry } from "./platinum-popup-template";

export interface PlatinumPopupObserver {
  onOpen?(info: { readonly entries: readonly PlatinumPopupEntry[]; readonly anchor: PopupAnchor; readonly view: WebContentsView | null }): void;
  onClose?(): void;
}

const activeByWindow = new WeakMap<BrowserWindow, () => void>();
let popupObserver: PlatinumPopupObserver | null = null;

export function setPlatinumPopupObserver(observer: PlatinumPopupObserver | null): void {
  popupObserver = observer;
}

function defaultAnchorFor(window: BrowserWindow, align: "start" | "end" = "start"): PopupAnchor {
  const [contentWidth] = window.getContentSize();
  const zoom = window.webContents.getZoomFactor() || 1;
  const cssWidth = contentWidth / zoom;
  return align === "end"
    ? { x: Math.max(8, cssWidth - 8), y: 66, width: 0, height: 0, align: "end", keyboard: true }
    : { x: 8, y: 66, width: 0, height: 0, align: "start", keyboard: true };
}

export function showPlatinumPopupMenu<Id extends string>(
  window: BrowserWindow,
  entries: readonly PlatinumPopupEntry<Id>[],
  rawAnchor?: unknown,
  fallbackAlign: "start" | "end" = "start"
): Promise<Id | null> {
  if (window.isDestroyed()) return Promise.resolve(null);
  activeByWindow.get(window)?.();

  const anchor = normalizePopupAnchor(rawAnchor) ?? defaultAnchorFor(window, fallbackAlign);
  const [contentWidth, contentHeight] = window.getContentSize();
  if (contentWidth <= 0 || contentHeight <= 0) return Promise.resolve(null);

  return new Promise<Id | null>((resolve) => {
    let settled = false;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const shellContents = window.webContents;
    const zoom = shellContents.getZoomFactor() || 1;
    const previousFocus = webContents.getFocusedWebContents();

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });
    view.setBackgroundColor("#00000000");
    let loaded = false;
    const initialTheme = windowUiTheme(window);
    const updateTheme = (): void => {
      if (!loaded || view.webContents.isDestroyed()) return;
      const theme = windowUiTheme(window);
      void view.webContents.executeJavaScript(`document.documentElement.dataset.uiTheme = ${JSON.stringify(theme)}`).catch(cancel);
    };

    const finish = (value: Id | null, closedByBlur = false): void => {
      if (settled) return;
      settled = true;
      if (blurTimer) clearTimeout(blurTimer);
      if (activeByWindow.get(window) === cancel) activeByWindow.delete(window);
      window.off("blur", onWindowBlur);
      window.off("resize", cancel);
      window.off("closed", cancel);
      unsubscribeTheme();
      if (!shellContents.isDestroyed()) shellContents.off("did-navigate", cancel);
      if (!window.isDestroyed()) {
        try { window.contentView.removeChildView(view); } catch { /* Already detached */ }
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
      if (!closedByBlur && !window.isDestroyed() && previousFocus && !previousFocus.isDestroyed()) {
        previousFocus.focus();
      }
      popupObserver?.onClose?.();
      resolve(value);
    };

    const cancel = (): void => finish(null);
    const onWindowBlur = (): void => {
      if (window.isDestroyed() || !window.isFocused()) finish(null, true);
    };

    activeByWindow.set(window, cancel);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    view.webContents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      if (title === "cancel") {
        cancel();
        return;
      }
      if (!title.startsWith("pick:")) return;
      const index = Number(title.slice(5));
      const picked = Number.isInteger(index) ? entries[index] : undefined;
      if (picked && picked.type !== "separator" && picked.enabled !== false && picked.id !== undefined) {
        finish(picked.id);
      } else {
        cancel();
      }
    });

    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: contentWidth, height: contentHeight });
    view.webContents.once("did-finish-load", () => {
      if (settled || view.webContents.isDestroyed()) return;
      loaded = true;
      if (windowUiTheme(window) !== initialTheme) updateTheme();
      view.webContents.setZoomFactor(zoom);
      view.webContents.focus();
      popupObserver?.onOpen?.({ entries, anchor, view });
      blurTimer = setTimeout(() => {
        if (!settled && !window.isDestroyed()) window.on("blur", onWindowBlur);
      }, 40);
    });

    window.on("resize", cancel);
    window.on("closed", cancel);
    const unsubscribeTheme = onWindowUiTheme(window, updateTheme);
    shellContents.on("did-navigate", cancel);

    const html = buildPlatinumPopupHtml(entries, anchor, process.platform, initialTheme);
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(cancel);
  });
}
