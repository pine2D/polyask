import assert from "node:assert/strict";
import test from "node:test";
import { buildAppCommands, LATEST_RELEASE_URL } from "../src/renderer/app-commands";
import { setShellApi } from "../src/renderer/shell-api";
import { getCopy } from "../src/shared/copy";

const copy = getCopy("en");

function createOptions(overrides: Partial<Parameters<typeof buildAppCommands>[0]> = {}): Parameters<typeof buildAppCommands>[0] {
  return {
    copy,
    layout: { mode: "overview", focused: "claude", page: 0, pageCount: 2, placements: [] },
    openedSites: ["claude", "chatgpt"],
    participatingSites: new Set(["claude"]),
    statuses: {
      claude: { site: "claude", phase: "generating" },
      chatgpt: { site: "chatgpt", phase: "failed", code: "load_failed" }
    },
    siteNavigationHistory: { claude: { back: true, forward: false } },
    drawerOpen: true,
    composer: { expanded: false, setExpanded() {} },
    promptRef: { current: null },
    requestedPage: { current: null },
    setPageInputMethod() {},
    setAnnouncement() {},
    changeSurface() {},
    changeDrawerOpen() {},
    changePanelState() {},
    openPanel() {},
    openCommandSurface() {},
    openTaskSetup() {},
    openSettings() {},
    setMode() {},
    changeTier() {},
    closeQuestionHistory() {},
    openQuestionHistory() {},
    closeImagePicker() {},
    collectAndCopy: async () => {},
    collectAndCompare: async () => {},
    collectSynthesis: async () => {},
    synthesisPending: false,
    retrySitesCount: 1,
    requestRetryReview() {},
    clearArchiveNavigation() {},
    startNewSession: async () => {},
    ...overrides
  };
}

test("buildAppCommands gates conditional commands on page count, history, participation, and site status", () => {
  const events: string[] = [];
  const requestedPage: { current: { readonly page: number; readonly inputMethod: "keyboard" | "pointer" } | null } = { current: null };
  setShellApi({
    setPage: (page: number) => events.push(`page:${page}`),
    stepHistory: (offset: number) => events.push(`history:${offset}`)
  } as any);
  try {
    const commands = buildAppCommands(createOptions({
      requestedPage,
      setAnnouncement: (text) => events.push(`announce:${text}`),
      changeSurface: (surface) => events.push(`surface:${surface}`),
      changeDrawerOpen: (open) => events.push(`drawer:${open}`),
      setMode: (mode, focused) => events.push(`mode:${mode}:${focused}`)
    }));
    assert.equal(typeof commands["show-page-1"], "function");
    assert.equal(typeof commands["show-page-2"], "function");
    assert.equal(commands["show-page-3"], undefined);
    assert.equal(typeof commands["site-back"], "function");
    assert.equal(commands["site-forward"], undefined);
    assert.equal(typeof commands["collect-answers"], "function");
    assert.equal(commands["collect-synthesis"], undefined);
    assert.equal(typeof commands["retry-failed"], "function");
    assert.equal(typeof commands["next-unfinished"], "function");
    assert.equal(typeof commands["next-failed"], "function");

    commands["show-page-2"]!();
    assert.deepEqual(requestedPage.current, { page: 1, inputMethod: "keyboard" });
    assert.equal(events.includes("page:1"), true);

    events.length = 0;
    commands["next-failed"]!();
    assert.deepEqual(events, ["surface:sites", "drawer:false", "mode:focus:chatgpt"]);

    const emptyParticipation = buildAppCommands(createOptions({
      layout: { mode: "overview", focused: "claude", page: 0, pageCount: 1, placements: [] },
      openedSites: ["claude"],
      participatingSites: new Set(),
      statuses: {},
      siteNavigationHistory: {},
      retrySitesCount: 0
    }));
    assert.equal(emptyParticipation["next-page"], undefined);
    assert.equal(emptyParticipation["next-site"], undefined);
    assert.equal(emptyParticipation["collect-answers"], undefined);
    assert.equal(emptyParticipation["new-session"], undefined);
    assert.equal(emptyParticipation["retry-failed"], undefined);
  } finally {
    setShellApi(null);
  }
});

test("check-updates opens the official GitHub releases URL and announces result", async () => {
  const opened: string[] = [];
  const notices: string[] = [];
  setShellApi({
    openExternal: async (url: string) => { opened.push(url); }
  } as any);
  try {
    const commands = buildAppCommands(createOptions({
      setAnnouncement: (text) => notices.push(text)
    }));
    commands["check-updates"]!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(opened, [LATEST_RELEASE_URL]);
    assert.deepEqual(notices, [copy.updatePageOpened]);
  } finally {
    setShellApi(null);
  }
});
