export const WINDOW_CHROME_CHANNELS = {
  state: "polyask:window-chrome-state",
  control: "polyask:window-control"
} as const;

export type WindowControlAction = "minimize" | "toggle-maximize" | "close";

export interface WindowChromeState {
  readonly focused: boolean;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
}

export const INITIAL_WINDOW_CHROME_STATE: WindowChromeState = {
  focused: true,
  maximized: false,
  fullScreen: false
};

export function parseWindowControlAction(value: unknown): WindowControlAction | null {
  if (value === "minimize" || value === "toggle-maximize" || value === "close") return value;
  return null;
}
