import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { registerWindowChromeIpc, type ManagedChromeWindow } from "../src/main/window-chrome-ipc";
import { WINDOW_CHROME_CHANNELS, type WindowChromeState } from "../src/shared/window-chrome";

test("window chrome IPC enforces trusted shell sender, drives frameless controls, and cleans up after close", async () => {
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const sent: Array<{ channel: string; payload: WindowChromeState }> = [];
  let destroyed = false;
  let focused = true;
  let maximized = false;
  let fullScreen = false;
  let minimizes = 0;
  let closes = 0;

  const contents = {
    isDestroyed: () => destroyed,
    send: (channel: string, payload: WindowChromeState) => { sent.push({ channel, payload }); }
  };
  const win = Object.assign(new EventEmitter(), {
    get webContents() {
      if (destroyed) throw new Error("Object has been destroyed");
      return contents;
    },
    isDestroyed: () => destroyed,
    isFocused: () => focused,
    isMaximized: () => maximized,
    isFullScreen: () => fullScreen,
    minimize: () => { minimizes += 1; },
    maximize: () => { maximized = true; },
    unmaximize: () => { maximized = false; },
    setFullScreen: (flag: boolean) => { fullScreen = flag; },
    close: () => { closes += 1; }
  }) as ManagedChromeWindow;

  const dispose = registerWindowChromeIpc({
    handle: (channel, listener) => { handlers.set(channel, listener); },
    removeHandler: (channel) => { handlers.delete(channel); }
  }, win, (event) => event === "trusted");

  const getState = handlers.get(WINDOW_CHROME_CHANNELS.state)!;
  const control = handlers.get(WINDOW_CHROME_CHANNELS.control)!;
  assert.throws(() => getState("site-frame"), /untrusted_sender/);
  assert.throws(() => control("site-frame", "minimize"), /untrusted_sender/);
  assert.throws(() => control("trusted", "resize-arbitrary"), /invalid_request/);

  assert.deepEqual(getState("trusted"), { focused: true, maximized: false, fullScreen: false });

  focused = false;
  win.emit("blur");
  assert.deepEqual(sent.at(-1), {
    channel: WINDOW_CHROME_CHANNELS.state,
    payload: { focused: false, maximized: false, fullScreen: false }
  });

  assert.deepEqual(control("trusted", "toggle-maximize"), { focused: false, maximized: true, fullScreen: false });
  assert.deepEqual(control("trusted", "toggle-maximize"), { focused: false, maximized: false, fullScreen: false });

  fullScreen = true;
  assert.deepEqual(control("trusted", "toggle-maximize"), { focused: false, maximized: false, fullScreen: false });

  control("trusted", "minimize");
  assert.equal(minimizes, 1);
  control("trusted", "close");
  assert.equal(closes, 1);

  // Simulate post-closed teardown where accessing win.webContents would throw.
  destroyed = true;
  win.emit("focus");
  assert.equal(sent.length, 1, "destroyed window emits no stale IPC pushes");
  dispose();
  assert.equal(handlers.size, 0);
  assert.equal(win.listenerCount("focus"), 0);
});
