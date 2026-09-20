import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPalette, type CommandPaletteMode } from "../src/renderer/command-palette";
import { COMMANDS } from "../src/shared/commands";
import { getCopy } from "../src/shared/copy";
import { searchCommands } from "../src/renderer/command-search";

const noop = () => undefined;
test("on-demand guide is searchable in all three languages", () => {
  for (const [locale, query] of [["en", "Getting started"], ["zh-CN", "开始使用"], ["zh-TW", "開始使用"]]) {
    assert.deepEqual(searchCommands(query, COMMANDS, getCopy(locale)).map(item => item.id), ["open-getting-started"]);
  }
});

test("opening the guide renders four steps without executing commands or editing drafts", () => {
  const effects: string[] = [];
  const html = renderToStaticMarkup(<CommandPalette
    copy={getCopy("zh-CN")} commands={COMMANDS} menuShortcuts={[]} groups={[]}
    library={{templates:[],history:[]}} draft="Keep my draft" isMac={false}
    mode={"guide" as CommandPaletteMode} onModeChange={noop}
    onExecute={id => effects.push(id)} onApplyGroup={id => effects.push(id)}
    onInsertPrompt={text => effects.push(text)} onSaveTemplate={() => effects.push("save")}
    onDeleteTemplate={id => effects.push(id)} onClose={noop}
  />);
  assert.match(html, /aria-label="开始使用"/);
  assert.match(html, /id="getting-started-panel"[^>]*role="tabpanel"/);
  assert.equal((html.match(/class="getting-started-step"/g) ?? []).length, 4);
  assert.match(html, /aria-controls="getting-started-panel"/);
  assert.match(html, /不会自动更改站点选择或发送问题/);
  assert.doesNotMatch(html, /role="listbox"|role="combobox"/);
  assert.deepEqual(effects, []);
});
