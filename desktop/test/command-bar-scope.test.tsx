import assert from "node:assert/strict";
import test from "node:test";
import React, { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandBar } from "../src/renderer/command-bar";
import { getCopy } from "../src/shared/copy";

const noop = () => undefined;
function render(overrides: Partial<ComponentProps<typeof CommandBar>> = {}) {
  return renderToStaticMarkup(<CommandBar
    copy={getCopy("en")} promptRef={createRef()} text="Question" tier={null}
    runState="idle" auxiliaryBusy={false} layoutMode="overview" selectedCount={3}
    failureCount={0} cancelledCount={0} scopeLabel="Custom · 3" healthAttention={0}
    panelTab={null} imageControl={null} sendBlockedReason={null} synthesisPending={false}
    syncStatus={{ state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
    isMac={false} expanded={false} onTextChange={noop} onSubmit={noop} onCancel={noop}
    onTierChange={noop} onLayoutChange={noop} onExpandedChange={noop} onOpenPanel={noop}
    onShowGroupMenu={noop} onOpenMore={noop} onPasteImages={noop} {...overrides}
  />);
}

test("send has a localized scope name even when narrow layouts hide its text", () => {
  for (const [locale, name] of [["en", "Send to 3 sites"], ["zh-CN", "发送至 3 个站点"], ["zh-TW", "傳送至 3 個網站"]]) {
    const html = render({ copy: getCopy(locale) });
    assert.ok(html.includes(`aria-label="${name}"`));
    assert.ok(html.includes(`title="${name}"`));
    assert.match(html, /class="send-count"[^>]*>3<\/span>/);
  }
  assert.match(render({ selectedCount: 1 }), /aria-label="Send to 1 site"/);
  assert.match(render({ selectedCount: 9 }), /aria-label="Send to 9 sites"/);
});

test("blocked sending keeps the reason separate from the action name", () => {
  const html = render({ sendBlockedReason: "Unsupported image sites" });
  assert.match(html, /class="send [^"]*"[^>]*title="Unsupported image sites"[^>]*aria-label="Send to 3 sites"[^>]*disabled=""/);
  assert.match(render({ selectedCount: 0 }), /class="send [^"]*"[^>]*disabled=""/);
});

test("cancel and cancelling retain accessible names without send counts", () => {
  for (const runState of ["sending", "cancelling"] as const) {
    const html = render({ runState });
    assert.ok(html.includes(`aria-label="${runState === "sending" ? "Cancel" : "Cancelling…"}"`));
    assert.doesNotMatch(html, /class="send-count"/);
  }
});
