/** Built-in visual definitions shared by the shell, the window and its detached menus. */
type ColorPair = readonly [light: string, dark: string];
type Palette = Record<'canvas' | 'panel' | 'chrome' | 'text' | 'muted' | 'line' | 'control' |
  'hover' | 'accent' | 'onAccent' | 'selection', ColorPair>;

const minimal: Palette = {
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
};

const proof: Palette = {
  canvas: ['#e8e1d5', '#24201e'], panel: ['#fffcf4', '#312c28'], chrome: ['#f4eee1', '#3b3530'],
  text: ['#312c28', '#f4ebdc'], muted: ['#665b50', '#c6b8a7'], line: ['#c3b7a5', '#695f54'],
  control: ['#807466', '#988a7a'], hover: ['#eae0cf', '#4b4139'],
  accent: ['#903c22', '#ffa782'], onAccent: ['#fffaf0', '#351c12'], selection: ['#f3ded0', '#523a2d']
};
const pocket: Palette = {
  canvas: ['#e1e2d6', '#20221e'], panel: ['#fafaf4', '#292c27'], chrome: ['#edf0e4', '#343831'],
  text: ['#282d21', '#eff1df'], muted: ['#4d5445', '#bdc3ae'], line: ['#a8ae9b', '#525a4c'],
  control: ['#717969', '#929b85'], hover: ['#dde2d2', '#424a3c'],
  accent: ['#625000', '#ebce61'], onAccent: ['#fffdf1', '#302909'], selection: ['#e4c957', '#514827']
};
const blueprint: Palette = {
  canvas: ['#dce7ee', '#132432'], panel: ['#f5f9fc', '#192e40'], chrome: ['#e5eff5', '#203b50'],
  text: ['#18384f', '#e5f3ff'], muted: ['#496277', '#adc6d8'], line: ['#809bae', '#496b80'],
  control: ['#546f83', '#799cae'], hover: ['#d0e2ee', '#294b60'],
  accent: ['#125983', '#87d9ef'], onAccent: ['#ffffff', '#12303b'], selection: ['#c9e2f3', '#234a60']
};
const darkroom: Palette = {
  canvas: ['#c7c9c9', '#1c1d1e'], panel: ['#f5f5f2', '#28292a'], chrome: ['#e0e1df', '#323334'],
  text: ['#252627', '#eeeae3'], muted: ['#555758', '#bfbcb6'], line: ['#a1a3a3', '#585959'],
  control: ['#727474', '#919190'], hover: ['#d5d6d3', '#414240'],
  accent: ['#86500b', '#f1b864'], onAccent: ['#fffaf2', '#30210b'], selection: ['#f1e0c4', '#4b3c29']
};
const solstice: Palette = {
  canvas: ['#e5dece', '#172d2d'], panel: ['#faf5e8', '#203837'], chrome: ['#eee6d4', '#294240'],
  text: ['#233746', '#ece8d9'], muted: ['#4e5b60', '#b7c4b9'], line: ['#c2b9a3', '#4d6661'],
  control: ['#7d7a68', '#83998d'], hover: ['#e3dcc9', '#36504c'],
  accent: ['#265d72', '#a8d6c7'], onAccent: ['#fffaf0', '#193431'], selection: ['#dbe6df', '#354f49']
};

export const UI_THEMES = {
  platinum: { label: 'themePlatinum', material: 'platinum', palette: {
    canvas: ['#bfbfbf', '#181818'], text: ['#222222', '#eeeeee'], accent: ['#1e40af', '#7cb4ff']
  } },
  minimal: { label: 'themeMinimal', material: 'flat', palette: minimal },
  proof: { label: 'themeProof', material: 'flat', palette: proof },
  pocket: { label: 'themePocket', material: 'flat', palette: pocket },
  blueprint: { label: 'themeBlueprint', material: 'flat', palette: blueprint },
  darkroom: { label: 'themeDarkroom', material: 'flat', palette: darkroom },
  solstice: { label: 'themeSolstice', material: 'flat', palette: solstice }
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

export function uiThemeDataset(value: unknown) {
  const uiTheme = resolveUiTheme(value);
  return { uiTheme, uiMaterial: UI_THEMES[uiTheme].material };
}

// The shell, detached menus and individual swatches follow the same system appearance.
export const UI_THEME_PALETTE_CSS = UI_THEME_IDS.map(id => {
  const tokens = Object.entries(UI_THEMES[id].palette).map(([name, [light, dark]]) =>
    `--skin-${name}: light-dark(${light}, ${dark});`);
  return `:root[data-ui-theme="${id}"], .theme-swatch[data-swatch="${id}"] { ${tokens.join(' ')} }`;
}).join('\n');
