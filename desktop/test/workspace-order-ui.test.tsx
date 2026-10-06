import assert from "node:assert/strict";
import test from "node:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SiteKey } from "../src/shared/contracts";
import type { WorkspaceState } from "../src/shared/workspace";
import { getCopy } from "../src/shared/copy";
import { SITES } from "../src/main/sites";
import { WorkspaceSites } from "../src/renderer/workspace-sites";
import { useWorkspaceFlow } from "../src/renderer/use-workspace-flow";
import { setShellApi } from "../src/renderer/shell-api";

async function mount(element: React.JSX.Element) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<div id='root'></div>");
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(element));
  return { document: dom.window.document as Document, window: dom.window,
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      setShellApi(null);
    }
  };
}

test("keyboard moves and checkbox toggles retain the user's selected site order", async () => {
  let selected: readonly SiteKey[] = [];
  function Fixture() {
    const [keys, setKeys] = useState<readonly SiteKey[]>(["kimi", "claude", "gemini"]);
    selected = keys;
    return <WorkspaceSites copy={getCopy("en")} sites={SITES} selected={new Set(keys)} groups={[]}
      onSelectionChange={setKeys} onSaveGroup={async () => true} onDeleteGroup={() => {}} />;
  }
  const h = await mount(<Fixture />);
  try {
    const order = () => [...h.document.querySelectorAll<HTMLInputElement>('input[name="scope-sites"]:checked')].map(input => input.value);
    assert.deepEqual(order(), ["kimi", "claude", "gemini"]);
    const handle = h.document.querySelector<HTMLButtonElement>('[data-site-key="claude"] .site-drag-handle');
    assert.ok(handle, "selected sites need a keyboard-accessible drag handle");
    handle.focus();
    await act(async () => handle.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    assert.deepEqual(selected, ["claude", "kimi", "gemini"]);
    assert.equal(h.document.activeElement, handle);
    await act(async () => h.document.querySelector<HTMLInputElement>('input[value="kimi"]')!.click());
    assert.deepEqual(selected, ["claude", "gemini"]);
    await act(async () => h.document.querySelector<HTMLInputElement>('input[value="kimi"]')!.click());
    assert.deepEqual(selected, ["claude", "gemini", "kimi"]);
    const up = h.document.querySelector<HTMLButtonElement>('[data-site-key="kimi"] [data-move="up"]')!;
    await act(async () => up.click());
    assert.deepEqual(selected, ["claude", "kimi", "gemini"]);
    assert.match(h.document.querySelector('[aria-live="polite"]')!.textContent!, /Kimi/);
  } finally { await h.close(); }
});

test("internal drag commits once at drop; cancellation and foreign drops keep selection", async () => {
  const changes: SiteKey[][] = [];
  function Fixture() {
    const [keys, setKeys] = useState<readonly SiteKey[]>(["kimi", "claude", "gemini"]);
    return <WorkspaceSites copy={getCopy("en")} sites={SITES} selected={new Set(keys)} groups={[]}
      onSelectionChange={next => { changes.push([...next]); setKeys(next); }} onSaveGroup={async () => true} onDeleteGroup={() => {}} />;
  }
  const h = await mount(<Fixture />);
  try {
    const handle = h.document.querySelector('[data-site-key="kimi"] .site-drag-handle');
    assert.ok(handle, "selected sites need a drag source");
    const target = h.document.querySelector('[data-site-key="gemini"]')!;
    const drag = async (element: Element, type: string) => act(async () => {
      const event = new h.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { clientY: { value: 1 }, dataTransfer: { value: { setData() {}, effectAllowed: "", dropEffect: "" } } });
      element.dispatchEvent(event);
    });
    await drag(target, "drop");
    assert.deepEqual(changes, []);
    await drag(handle, "dragstart");
    await drag(target, "dragover");
    assert.deepEqual(changes, [], "preview must not persist partial drag positions");
    await drag(handle, "dragend");
    await drag(target, "drop");
    assert.deepEqual(changes, [], "cancelled drags must not commit");
    await drag(handle, "dragstart");
    await drag(target, "dragover");
    await drag(target, "drop");
    assert.deepEqual(changes, [["claude", "gemini", "kimi"]]);
  } finally { await h.close(); }
});

test("workspace hook preserves reorder payloads and ignores late selection acknowledgements", async () => {
  const pending: Array<{ keys: readonly SiteKey[]; finish: (state: WorkspaceState) => void }> = [];
  setShellApi({ setSelection: (keys: readonly SiteKey[]) => new Promise<WorkspaceState>(finish => pending.push({ keys, finish })) } as any);
  let flow!: ReturnType<typeof useWorkspaceFlow>;
  function Fixture() {
    flow = useWorkspaceFlow(SITES, "failed", () => {});
    return <span>{flow.workspace.selectedSites.join(",")}</span>;
  }
  const h = await mount(<Fixture />);
  try {
    await act(async () => flow.changeSelection(["kimi", "claude"]));
    await act(async () => flow.changeSelection(["claude", "kimi"]));
    assert.deepEqual(pending.map(p => p.keys), [["kimi", "claude"], ["claude", "kimi"]]);
    // Main publishes workspace-state before resolving its IPC request; an old
    // publication must not overwrite a later optimistic reorder.
    await act(async () => flow.accept({ selectedSites: ["kimi", "claude"], tier: null, groups: [] }));
    assert.equal(h.document.querySelector("span")!.textContent, "claude,kimi");
    await act(async () => pending[1].finish({ selectedSites: ["claude", "kimi"], tier: null, groups: [] }));
    await act(async () => pending[0].finish({ selectedSites: ["kimi", "claude"], tier: null, groups: [] }));
    assert.equal(h.document.querySelector("span")!.textContent, "claude,kimi");
    await act(async () => flow.toggleSite("gemini"));
    assert.deepEqual(pending[2].keys, ["claude", "kimi", "gemini"]);
  } finally { await h.close(); }
});

test("late recovery bootstrap cannot overwrite a subsequent successful reorder", async () => {
  let fail!: (error: Error) => void;
  let finishSelection!: (state: WorkspaceState) => void;
  let finishRecovery!: (state: { workspace: WorkspaceState }) => void;
  let first = true;
  setShellApi({
    setSelection: () => first ? (first = false, new Promise<WorkspaceState>((_resolve, reject) => { fail = reject; }))
      : new Promise<WorkspaceState>(resolve => { finishSelection = resolve; }),
    bootstrap: () => new Promise(resolve => { finishRecovery = resolve; })
  } as any);
  let flow!: ReturnType<typeof useWorkspaceFlow>;
  function Fixture() {
    flow = useWorkspaceFlow(SITES, "failed", () => {});
    return <span>{flow.workspace.selectedSites.join(",")}</span>;
  }
  const h = await mount(<Fixture />);
  try {
    await act(async () => flow.changeSelection(["kimi", "claude"]));
    await act(async () => fail(new Error("failed")));
    await act(async () => flow.changeSelection(["gemini", "kimi", "claude"]));
    await act(async () => finishSelection({ selectedSites: ["gemini", "kimi", "claude"], tier: null, groups: [] }));
    await act(async () => finishRecovery({ workspace: { selectedSites: ["claude", "kimi"], tier: null, groups: [] } }));
    assert.equal(h.document.querySelector("span")!.textContent, "gemini,kimi,claude");
  } finally { await h.close(); }
});
