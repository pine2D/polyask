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
  for (const [locale, query] of [["en", "Getting started"], ["zh-CN", "快速上手"], ["zh-TW", "快速上手"]]) {
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
    onInsertPrompt={text => effects.push(text)} onSaveTemplate={() => { effects.push("save"); }}
    onDeleteTemplate={id => effects.push(id)} onClose={noop}
  />);
  assert.match(html, /aria-label="快速上手"/);
  assert.match(html, /id="getting-started-panel"[^>]*role="tabpanel"/);
  assert.equal((html.match(/class="getting-started-step"/g) ?? []).length, 4);
  assert.match(html, /aria-controls="getting-started-panel"/);
  assert.match(html, /勾选常用的 AI 站点，一次提问并排对照/);
  assert.doesNotMatch(html, /role="listbox"|role="combobox"/);
  assert.deepEqual(effects, []);
});
