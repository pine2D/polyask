import { useEffect, useState } from "react";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { WINDOW_TITLEBAR_HEIGHT } from "../shared/display";
import {
  INITIAL_WINDOW_CHROME_STATE,
  type WindowChromeState,
  type WindowControlAction
} from "../shared/window-chrome";
import { shell } from "./shell-api";

export interface WindowTitleBarProps {
  readonly copy: DesktopCopy;
  readonly isMac: boolean;
  readonly preview?: boolean;
}

function MinimizeGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 9 9" width="9" height="9" shapeRendering="crispEdges">
      <rect x="2" y="5" width="5" height="1" fill="currentColor" />
    </svg>
  );
}

function ZoomGlyph({ zoomed }: { readonly zoomed: boolean }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 9 9" width="9" height="9" shapeRendering="crispEdges">
      <path
        d={zoomed ? "M1.5 1.5h6v6h-6zM1.5 4.5h3v3" : "M1.5 1.5h6v6h-6z"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function CloseGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 9 9" width="9" height="9">
      <path d="M2.2 2.2 6.8 6.8M6.8 2.2 2.2 6.8" fill="none" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

export function WindowTitleBar({ copy, isMac, preview = false }: WindowTitleBarProps): React.JSX.Element {
  const [state, setState] = useState<WindowChromeState>(INITIAL_WINDOW_CHROME_STATE);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("has-window-titlebar");
    root.style.setProperty("--window-titlebar-height", `${WINDOW_TITLEBAR_HEIGHT}px`);
    let active = true;
    const api = shell as Partial<typeof shell>;
    if (typeof api.getWindowChromeState === "function") {
      void api.getWindowChromeState().then((next) => {
        if (active && next) setState(next);
      }).catch(() => {});
    }
    const unsubscribe = typeof api.onWindowChromeState === "function"
      ? api.onWindowChromeState((next) => { if (active && next) setState(next); })
      : undefined;
    return () => {
      active = false;
      unsubscribe?.();
      root.classList.remove("has-window-titlebar");
    };
  }, []);

  const act = (action: WindowControlAction): void => {
    const api = shell as Partial<typeof shell>;
    if (typeof api.windowControl !== "function") return;
    void api.windowControl(action).then((next) => {
      if (next) setState(next);
    }).catch(() => {});
  };

  const zoomed = state.maximized || state.fullScreen;
  const zoomLabel = zoomed ? copy.restoreWindow : copy.maximizeWindow;
  const title = preview
    ? formatCopy(copy.previewWindowTitle, { title: copy.appTitle })
    : copy.appTitle;

  const controls = isMac ? (
    <div className="window-tbox-group is-mac">
      <button type="button" className="window-tbox is-close" aria-label={copy.closeWindow} title={copy.closeWindow} onClick={() => act("close")}><CloseGlyph /></button>
      <button type="button" className="window-tbox" aria-label={copy.minimizeWindow} title={copy.minimizeWindow} disabled={state.fullScreen} onClick={() => act("minimize")}><MinimizeGlyph /></button>
      <button type="button" className="window-tbox" aria-label={zoomLabel} title={zoomLabel} onClick={() => act("toggle-maximize")}><ZoomGlyph zoomed={zoomed} /></button>
    </div>
  ) : (
    <div className="window-tbox-group">
      <button type="button" className="window-tbox" aria-label={copy.minimizeWindow} title={copy.minimizeWindow} disabled={state.fullScreen} onClick={() => act("minimize")}><MinimizeGlyph /></button>
      <button type="button" className="window-tbox" aria-label={zoomLabel} title={zoomLabel} onClick={() => act("toggle-maximize")}><ZoomGlyph zoomed={zoomed} /></button>
      <button type="button" className="window-tbox is-close" aria-label={copy.closeWindow} title={copy.closeWindow} onClick={() => act("close")}><CloseGlyph /></button>
    </div>
  );

  return (
    <div
      className="window-titlebar"
      role="region"
      aria-label={copy.windowMenu}
      data-window-focused={state.focused ? "true" : "false"}
      data-window-maximized={zoomed ? "true" : "false"}
    >
      {isMac ? controls : null}
      <span className="window-stripe" aria-hidden="true" />
      <span className="window-title">{title}</span>
      <span className="window-stripe" aria-hidden="true" />
      {!isMac ? controls : null}
    </div>
  );
}
