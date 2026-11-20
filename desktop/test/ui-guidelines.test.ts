import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readSource } from "./fixtures";

const DESKTOP_ROOT = path.join(__dirname, "..");
const renderer = (file: string) => readSource(`src/renderer/${file}`);

test("desktop forms expose stable names and disable browser autofill where it is noise", () => {
  const files = [
    renderer("command-bar.tsx"),
    renderer("prompt-composer.tsx"),
    renderer("archive-workspace.tsx"),
    renderer("archive-detail.tsx"),
    renderer("archive-metadata.tsx"),
    renderer("synthesis-workspace.tsx"),
    renderer("synthesis-payload-preview.tsx"),
    renderer("settings-workspace.tsx"),
    renderer("workspace-drawer.tsx"),
    renderer("workspace-sites.tsx")
  ].join("\n");
  for (const name of ["prompt", "archive-search", "archive-tags", "archive-note", "synthesis-target", "synthesis-tier", "synthesis-instruction", "synthesis-preview", "clear-cloud-confirmation", "group-name"]) {
    assert.match(files, new RegExp(`name="${name}"`));
  }
  assert.ok([...files.matchAll(/autoComplete="off"/g)].length >= 7);
});

test("image previews reserve geometry and dense long lists skip offscreen rendering", () => {
  const picker = renderer("image-picker.tsx");
  const css = renderer("styles.css");
  assert.match(picker, /<img[^>]+width=\{[1-9]\d*\}[^>]+height=\{[1-9]\d*\}/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size:\s*68px/);
});

test("desktop focus, reduced motion and Windows high contrast remain explicit", () => {
  const css = renderer("styles.css") + renderer("command-bar.css") + renderer("settings.css") + renderer("accessibility.css");
  assert.doesNotMatch(css, /outline:\s*none/);
  assert.doesNotMatch(css, /transition:\s*all/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test("desktop motion uses shared curves, 120ms drawer slide, and 0ms mechanical snap elsewhere", () => {
  const css = renderer("styles.css") + renderer("command-bar.css") + renderer("panel-motion.css") + renderer("settings.css") + renderer("accessibility.css");
  assert.match(css, /--ease-out:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/);
  assert.match(css, /--ease-in-out:\s*cubic-bezier\(0\.77,\s*0,\s*0\.175,\s*1\)/);
  assert.match(css, /--ease-drawer:\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/);
  assert.match(css, /\.workspace-drawer\[data-state\][\s\S]*transition:\s*transform 120ms var\(--ease-drawer\)/);
  assert.match(css, /\.page-tab-indicator\s*\{\s*display:\s*none;\s*\}/);
  assert.match(renderer("index.tsx"), /requestedPage\.current\?\.page === next\.page[\s\S]*request\?\.inputMethod \?\? "keyboard"/);
});

test("main-menu page changes are announced while renderer-requested changes stay deduplicated", () => {
  const app = renderer("index.tsx");
  assert.match(app, /const request = requestedPage\.current\?\.page === next\.page[\s\S]*if \(!request\)[\s\S]*sitePageChanged/);
  assert.match(app, /requestedPage\.current = null/);
});

test("workspace drawers retain a closing state long enough for interruptible transitions", () => {
  const app = renderer("index.tsx");
  const drawer = renderer("workspace-drawer.tsx");
  assert.match(app, /useWorkspaceMotion\(/);
  assert.match(renderer("use-workspace-motion.ts"), /usePresence\(drawerOpen/);
  assert.match(drawer, /data-state=\{props\.open \? "open" : "closed"\}/);
});

test("occasional full-workspace surfaces enter without animating native site bounds", () => {
  const app = renderer("index.tsx");
  const stages = renderer("surface-stages.tsx");
  const workbench = renderer("workbench-stage.tsx");
  const css = renderer("styles.css");
  assert.match(app, /<AppSurfaceRouter/);
  assert.match(stages, /className="surface-stage"/);
  assert.match(stages, /<WorkbenchMainStage/);
  assert.match(workbench, /className=\{`app-shell\$\{/);
  assert.doesNotMatch(app + stages + workbench, /app-shell surface-stage/);
  assert.match(css, /\.surface-stage[\s\S]*transition:\s*none/);
  assert.doesNotMatch(css, /webcontents|web-contents/i);
});

test("the high-frequency command surface opens without motion", () => {
  const css = renderer("styles.css");
  const start = css.indexOf(".command-surface {");
  const end = css.indexOf("\n}", start);
  const rule = css.slice(start, end);
  assert.ok(start >= 0);
  assert.doesNotMatch(rule, /transition|animation|transform/);
  assert.doesNotMatch(
    renderer("index.tsx") + renderer("surface-stages.tsx") + renderer("app-commands.tsx"),
    /surface-stage[^\n]*CommandPalette/
  );
});

test("the command surface keeps scrolling inside the result list", () => {
  const css = renderer("styles.css");
  assert.match(css, /\.command-surface\s*{[^}]*--command-block-pad:[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.command-palette\s*{[^}]*max-height:\s*min\(680px,\s*calc\(100vh - 2 \* var\(--command-block-pad\)\)\)/s);
  assert.match(css, /\.command-results\s*{[^}]*overflow:\s*auto/s);
});

test("Drive idle success color requires an active connection", () => {
  const css = renderer("settings.css");
  // The dot follows the single sync conclusion; only a connected, idle device gets tone "ok" (see sync-overview.test.tsx).
  assert.match(css, /\.sync-state\[data-tone="ok"\] i\s*\{\s*background:\s*var\(--success\);\s*\}/);
  assert.doesNotMatch(css, /\.sync-state\[data-state="idle"\] i\s*\{/);
});

test("custom tab lists support arrow-key focus and explicit panels", () => {
  const command = renderer("command-palette.tsx");
  const drawer = renderer("workspace-drawer.tsx");
  for (const source of [command, drawer]) {
    assert.match(source, /pageTabKeyAction/);
    assert.match(source, /onKeyDown/);
    assert.match(source, /tabIndex=/);
    assert.match(source, /aria-controls=/);
  }
});

test("answer comparison contains long unbroken content", () => {
  assert.match(renderer("styles.css"), /\.archive-compare-paragraph\s*>\s*p[^}]*overflow-wrap:\s*anywhere/s);
});

test("manual update feedback stays visible on the active surface", () => {
  const settings = renderer("settings-workspace.tsx");
  const app = renderer("index.tsx");
  const appCommands = renderer("app-commands.tsx");
  assert.match(settings, /setFeedback\("about", props\.copy\.updatePageOpened\)/);
  assert.match(settings, /setFeedback\("about", props\.copy\.updatePageFailed\)/);
  assert.match(app, /buildAppCommands\(/);
  assert.match(appCommands, /const checkForUpdates = \(\): void => \{[\s\S]*changeSurface\("sites"\)/);
  assert.match(appCommands, /"check-updates": checkForUpdates/);
});

test("Platinum widgets zero UA button padding on composer toggle, style disclosure triangles, and keep hover neutral", () => {
  const composer = renderer("composer.css");
  const widgets = renderer("platinum-widgets.css");
  const history = renderer("question-history.css");
  const theme = renderer("theme.css");
  const commandBar = renderer("command-bar.css");
  assert.match(composer, /\.prompt-composer \[data-composer-toggle\]\s*\{[^}]*padding:\s*0;/s);
  assert.match(widgets, /:is\(#root, body\) details > summary\s*\{\s*list-style:\s*none;\s*\}/);
  assert.match(widgets, /:is\(#root, body\) details:not\(\.question-menu\):not\(\.archive-record-context\) > summary:not\(\[hidden\]\)::before/);
  assert.doesNotMatch(widgets, /data:image/);
  assert.match(commandBar, /\.scope-split button:hover:not\(:disabled, \[aria-expanded="true"\], \[aria-pressed="true"\], :active\)/);
  assert.match(history, /\.question-legacy\s*\{[^}]*margin:\s*12px 10px 16px;/s);
  assert.match(theme, /--hover-soft:\s*#eeeeee;/);
  assert.match(theme, /--hover-soft:\s*#2a2a2a;/);
});

test("Platinum Gray Variation stays purple-free and locks atomic icon-only button centering", () => {
  const forbiddenPurple = /#(?:9999ff|ccccff|dcdcff|333399|5c5c9e|9e9eff|32325c|2b2b4e|6666aa|8585cc|b4b4ff|282831|353540|2b2b34|1f1f26|2a2a33)\b/i;
  for (const file of readdirSync(path.join(DESKTOP_ROOT, "src/renderer")).filter((f) => f.endsWith(".css"))) {
    assert.doesNotMatch(renderer(file), forbiddenPurple, `src/renderer/${file} must not reintroduce lavender/purple tokens`);
  }
  const popupTemplate = readSource("src/main/platinum-popup-template.ts");
  assert.doesNotMatch(popupTemplate, forbiddenPurple, "platinum-popup-template.ts must stay purple-free");
  assert.match(popupTemplate, /--menu-active-bg:\s*#333333;/);
  assert.match(popupTemplate, /--scroll-thumb:\s*#cccccc;/);

  const theme = renderer("theme.css");
  assert.match(theme, /--plat-scroll-thumb:\s*#cccccc;/);
  assert.match(theme, /--accent-soft:\s*#dcdcdc;/);
  assert.match(theme, /--selection-soft:\s*#f5f5f5;/);
  assert.match(theme, /--menu-active-bg:\s*#333333;/);

  const widgets = renderer("platinum-widgets.css");
  assert.match(widgets, /:is\(#root, body\) :is\(button, summary\) > svg\s*\{[^}]*display:\s*block;[^}]*flex-shrink:\s*0;/s);
  assert.match(widgets, /:is\(#root, body\) :is\([\s\S]*button\.question-icon-action[\s\S]*button\.library-menu-trigger[\s\S]*button\.markdown-link-details[\s\S]*\.question-menu > summary[\s\S]*\)\s*\{[^}]*padding:\s*0;[^}]*place-items:\s*center;/);

  const historyList = renderer("question-history-list.tsx");
  assert.match(historyList, /<details className="question-menu"><summary[^>]*><MoreIcon \/><\/summary>/);
  assert.doesNotMatch(historyList, /···/);
});

test("cross-layer motion durations, WebContentsView geometry tokens, popups, portals, and stateful hovers stay locked", () => {
  // 1. CSS <-> TS motion exit constants must match 1:1 (prevents 140ms zombie reserve delays).
  const motionTs = renderer("motion.ts");
  const panelMs = Number(motionTs.match(/PANEL_EXIT_MS\s*=\s*(\d+)/)?.[1]);
  const composerMs = Number(motionTs.match(/COMPOSER_EXIT_MS\s*=\s*(\d+)/)?.[1]);
  const panelCssMs = Number(renderer("panel-motion.css").match(/transition:\s*transform\s+(\d+)ms/)?.[1]);
  const composerBlock = renderer("composer.css").match(/\.prompt-composer\s*\{([^}]*)\}/s)?.[1] ?? "";
  const composerCssMs = /transition:\s*none/.test(composerBlock)
    ? 0
    : Number(composerBlock.match(/transition:[^;]*?(\d+)ms/)?.[1]);
  assert.equal(panelMs, panelCssMs, "PANEL_EXIT_MS in motion.ts must equal panel-motion.css transition duration");
  assert.equal(composerMs, composerCssMs, "COMPOSER_EXIT_MS in motion.ts must equal composer.css transition duration");

  // 2. Shell <-> Native WebContentsView geometry gates must use shared display tokens, pre-paint layout effects, and flushSync on layout IPC.
  const workspaceMotion = renderer("use-workspace-motion.ts");
  assert.match(workspaceMotion, /WINDOW_TITLEBAR_HEIGHT/);
  assert.match(workspaceMotion, /useLayoutEffect\(\(\)\s*=>\s*shell\.setComposerExpanded\(/);
  assert.match(renderer("index.tsx"), /shell\.onLayout\(\(next\)\s*=>\s*flushSync\(/);
  assert.match(renderer("site-find-markers.tsx"), /SITE_FIND_MARKER_WIDTH\s*-\s*TILE_FRAME_INSET/);

  // 3. Zero OS-native Menu.popup() leakage across main process (all popups must use showPlatinumPopupMenu).
  for (const file of readdirSync(path.join(DESKTOP_ROOT, "src/main")).filter((f) => f.endsWith(".ts"))) {
    const src = readSource(`src/main/${file}`);
    assert.doesNotMatch(src, /\.popup\s*\(/, `src/main/${file} must use showPlatinumPopupMenu instead of OS Menu.popup()`);
  }

  // 4. Shared widget/field stylesheets must scope via :is(#root, body) rather than #root-only or manual portal whitelists.
  const widgetsCss = renderer("platinum-widgets.css");
  const fieldsCss = renderer("fields.css");
  assert.doesNotMatch(widgetsCss, /(?:^|\n)\s*#root\b/, "platinum-widgets.css must use :is(#root, body) so all portals inherit widgets");
  assert.match(widgetsCss, /:is\(#root, body\) select\b/);
  assert.match(widgetsCss, /:is\(#root, body\) input\[type="checkbox"\]/);
  assert.match(fieldsCss, /:is\(#root, body\) :is\(textarea:not\(\[name="prompt"\]\)/);

  // 5. Stateful toolbar buttons must exclude active/expanded/pressed states from :hover background brightening.
  const barCss = renderer("command-bar.css");
  for (const selector of [
    /\.scope-split button:hover:not\([^)]*\[aria-expanded="true"\]/,
    /\.health-trigger:hover:not\([^)]*\.active/,
    /\.mode-switch button:hover:not\([^)]*\.active/,
    /\.tier-switch button:hover:not\([^)]*\.active/,
    /\.workspace-actions > button:hover:not\([^)]*\.active/,
    /\.page-tabs button:hover:not\([^)]*\[aria-selected="true"\]/
  ]) {
    assert.match(barCss, selector);
  }
});
