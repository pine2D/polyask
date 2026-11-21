/** Built-in visual definitions shared by the shell, the window and its detached menus. */
const minimal = {
  canvas: ['#f3f4f5', '#1b1d20'],
  panel: ['#ffffff', '#232529'],
  chrome: ['#f8f9fa', '#292b30'],
  text: ['#25292e', '#edf0f3'],
  muted: ['#59616b', '#aeb5bf'],
  line: ['#c9cdd2', '#494e56'],
  control: ['#79808a', '#818995'],
  hover: ['#e9ecef', '#373b41'],
  accent: ['#245ba6', '#96beff'],
  onAccent: ['#ffffff', '#102544'],
  selection: ['#e3edfa', '#2b405c']
} as const;

export const UI_THEMES = {
  platinum: { label: 'themePlatinum', palette: { canvas: ['#bfbfbf', '#181818'] } },
  minimal: { label: 'themeMinimal', palette: minimal }
} as const;
export type UiTheme = keyof typeof UI_THEMES;
export const DEFAULT_UI_THEME: UiTheme = 'platinum';
export const UI_THEME_IDS = Object.keys(UI_THEMES) as UiTheme[];

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && Object.hasOwn(UI_THEMES, value);
}

/** Keep an unknown well-formed wire ID intact. Resolve it only at the rendering boundary. */
export function resolveUiTheme(value: unknown): UiTheme {
  return isUiTheme(value) ? value : DEFAULT_UI_THEME;
}

// Both documents use the same colors, including live system light/dark changes.
export const UI_THEME_PALETTE_CSS = UI_THEME_IDS.map(id => {
  const tokens = Object.entries(UI_THEMES[id].palette).map(([name, [light, dark]]) =>
    `--skin-${name}: light-dark(${light}, ${dark});`);
  return `:root[data-ui-theme="${id}"] { ${tokens.join(' ')} }`;
}).join('\n');
