import type { EventEmitter } from "node:events";
import {
  WINDOW_CHROME_CHANNELS,
  parseWindowControlAction,
  type WindowChromeState
} from "../shared/window-chrome";

interface WindowChromeIpc {
  handle(channel: string, listener: (event: any, value?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export interface ManagedChromeWindow extends EventEmitter {
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, payload: WindowChromeState): void;
  };
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  setFullScreen(flag: boolean): void;
  close(): void;
}

const WINDOW_EVENTS = [
  "focus",
  "blur",
  "maximize",
  "unmaximize",
  "enter-full-screen",
  "leave-full-screen"
] as const;

export function readWindowChromeState(window: ManagedChromeWindow): WindowChromeState {
  if (window.isDestroyed()) return { focused: false, maximized: false, fullScreen: false };
  return {
    focused: window.isFocused(),
    maximized: window.isMaximized(),
    fullScreen: window.isFullScreen()
  };
}

export function registerWindowChromeIpc(
  ipc: WindowChromeIpc,
  window: ManagedChromeWindow,
  trusted: (event: any) => boolean
): () => void {
  // Retain shellContents before closed so disposal never touches window.webContents post-destroy.
  const shellContents = window.webContents;
  const push = (): void => {
    if (window.isDestroyed() || shellContents.isDestroyed()) return;
    shellContents.send(WINDOW_CHROME_CHANNELS.state, readWindowChromeState(window));
  };
  for (const eventName of WINDOW_EVENTS) window.on(eventName, push);

  ipc.handle(WINDOW_CHROME_CHANNELS.state, (event) => {
    if (!trusted(event)) throw new Error("untrusted_sender");
    return readWindowChromeState(window);
  });

  ipc.handle(WINDOW_CHROME_CHANNELS.control, (event, rawAction) => {
    if (!trusted(event)) throw new Error("untrusted_sender");
    const action = parseWindowControlAction(rawAction);
    if (!action) throw new Error("invalid_request");
    if (window.isDestroyed()) return { focused: false, maximized: false, fullScreen: false };
    if (action === "minimize") window.minimize();
    else if (action === "toggle-maximize") {
      if (window.isFullScreen()) window.setFullScreen(false);
      else if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else {
      window.close();
    }
    return readWindowChromeState(window);
  });

  return () => {
    for (const eventName of WINDOW_EVENTS) window.removeListener(eventName, push);
    ipc.removeHandler(WINDOW_CHROME_CHANNELS.state);
    ipc.removeHandler(WINDOW_CHROME_CHANNELS.control);
  };
}
