import assert from "node:assert/strict";
import test from "node:test";
import { getCopy } from "../src/shared/copy";
import { normalizePopupAnchor } from "../src/shared/popup-anchor";
import { buildCommandMenuEntries, buildGroupMenuEntries } from "../src/main/native-menus";
import { buildPlatinumPopupHtml } from "../src/main/platinum-popup-template";

test("Platinum group and command menus build crisp sections and human-readable shortcuts", () => {
  const copy = getCopy("zh-CN");
  assert.deepEqual(buildGroupMenuEntries([], copy), [{ label: copy.noSavedGroups, enabled: false }]);
  assert.deepEqual(
    buildGroupMenuEntries([{ id: "g1", name: "主力四站", sites: ["claude", "chatgpt"], updatedAt: 1, deviceId: "dev" }], copy),
    [{ id: "g1", label: "主力四站", enabled: true }]
  );

  const entries = buildCommandMenuEntries(
    ["open-task-setup", "collect-answers", "new-session", "open-question-history", "open-command-palette", "open-settings"],
    copy,
    "standard",
    "win32"
  );
  assert.equal(entries.some((entry) => entry.type === "separator"), true, "grouped commands insert grooved Platinum separators");
  const settingsItem = entries.find((entry) => entry.type !== "separator" && entry.id === "open-settings");
  assert.equal(settingsItem?.type !== "separator" ? settingsItem?.accelerator : undefined, "Ctrl+,", "comma shortcut never renders as localized OS Ctrl+逗号");

  const macEntries = buildCommandMenuEntries(["open-command-palette", "open-settings"], copy, "obsidian", "darwin");
  const macPalette = macEntries.find((entry) => entry.type !== "separator" && entry.id === "open-command-palette");
  const macSettings = macEntries.find((entry) => entry.type !== "separator" && entry.id === "open-settings");
  assert.equal(macPalette?.type !== "separator" ? macPalette?.accelerator : undefined, "⌘P");
  assert.equal(macSettings?.type !== "separator" ? macSettings?.accelerator : undefined, "⌘,");

  assert.throws(() => buildCommandMenuEntries([], copy), /invalid_command_menu/);
  assert.throws(() => buildCommandMenuEntries(["open-settings", "open-settings"], copy), /invalid_command_menu/);
});

test("Platinum popup anchor validation and HTML template enforce strict CSP and script escaping", () => {
  assert.equal(normalizePopupAnchor(null), undefined);
  assert.equal(normalizePopupAnchor({ x: Number.NaN, y: 10 }), undefined);
  assert.deepEqual(normalizePopupAnchor({ x: 120, y: 44, width: 26, height: 26, align: "end", keyboard: true }), {
    x: 120, y: 44, width: 26, height: 26, align: "end", keyboard: true
  });

  const html = buildPlatinumPopupHtml(
    [
      { id: "safe", label: "</script><img src=x>", checked: true, checkable: true, accelerator: "Ctrl+1" },
      { type: "separator" },
      { label: "Disabled note", enabled: false }
    ],
    { x: 12, y: 44, width: 24, height: 24, align: "start" },
    "win32"
  );
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /data:image/);
});
