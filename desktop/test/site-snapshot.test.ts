import assert from "node:assert/strict";
import test from "node:test";
import type { WebContentsView } from "electron";

import { collectSiteDomSnapshot, exportSiteDomSnapshot } from "../src/main/site-snapshot-service";
import type { SiteCommandChannel } from "../src/main/site-command-channel";
import { sampleSiteDomSnapshot } from "../src/preload/site-snapshot-sampler";
import {
  MAX_SNAPSHOT_NODES,
  SITE_SNAPSHOT_KIND,
  SITE_SNAPSHOT_SCHEMA,
  verifySanitizedHtml,
  verifySanitizedSnapshot,
  type SiteDomSnapshotFile,
  type SiteDomSnapshotSample
} from "../src/shared/site-snapshot";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { replayHtml } = require("../scripts/lib/dom-replay.js") as {
  replayHtml: (html: string, opts: { host: string; path: string }) => any;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanHtml, scanMeta } = require("../scripts/lib/dom-fixture-scan.js") as {
  scanHtml: (html: string, token: string) => string[];
  scanMeta: (meta: unknown) => string[];
};

function fakeView(options: {
  url?: string;
  destroyed?: boolean;
  zoom?: number;
} = {}): { view: WebContentsView; setUrl: (next: string) => void; destroy: () => void } {
  let currentUrl = options.url ?? "https://www.kimi.com/chat/19a8f3c2-0d1e-4b5a-9c8d-7e6f5a4b3c2d";
  let destroyed = options.destroyed ?? false;
  const webContents = {
    isDestroyed: () => destroyed,
    getURL: () => currentUrl,
    getZoomFactor: () => options.zoom ?? 1.25
  };
  return {
    view: { webContents } as unknown as WebContentsView,
    setUrl: (next: string) => { currentUrl = next; },
    destroy: () => { destroyed = true; }
  };
}

function fakeChannel(handler: () => Promise<unknown> | unknown): SiteCommandChannel {
  return {
    send: async () => handler() as any
  } as unknown as SiteCommandChannel;
}

test("sampler captures sanitized conversation + body menu portal, strips sidebar/PII, and replays cleanly", async () => {
  const secretPrompt = "请帮我核查 alice@corp.example 与 C:\\Users\\Alice\\secret.docx 的合同条款";
  const page = `
    <aside class="sidebar">
      <a href="/chat/secret-session-999">机密客户对话 13800138000</a>
      <div>sessionid=abcdef0123456789secret</div>
    </aside>
    <main>
      <header><button type="button" aria-haspopup="menu" aria-expanded="true" data-testid="model-picker">Kimi K2 Thinking</button></header>
      <div class="chat-content-list">
        <div class="chat-content-item chat-content-item-user" data-message-id="u-secret-1">
          <div class="user-content">${secretPrompt}</div>
        </div>
        <div class="chat-content-item chat-content-item-assistant" data-message-id="a-secret-1">
          <div class="markdown"><p>真实回答正文 https://internal.corp.example/doc?token=sk-abcdefghijklmnop</p></div>
        </div>
      </div>
      <div class="chat-input-box"><div contenteditable="true" role="textbox" aria-label="发消息给 Kimi">未发送草稿 /home/alice/.ssh/id_rsa</div></div>
    </main>
    <div role="menu" data-state="open">
      <div role="menuitemradio" aria-checked="true">K2 Thinking</div>
      <div role="menuitemradio" aria-checked="false">K2 Fast</div>
    </div>
    <div role="dialog" hidden>隐藏弹窗里的敏感字样 bob@corp.example</div>
  `;
  const live = replayHtml(page, {
    host: "www.kimi.com",
    path: "/chat/19a8f3c2-0d1e-4b5a-9c8d-7e6f5a4b3c2d"
  });
  let sample: SiteDomSnapshotSample;
  const langCalls: string[] = [];
  try {
    const origSetLang = live.window.__AMS_I18N__.setLang.bind(live.window.__AMS_I18N__);
    live.window.__AMS_I18N__.setLang("zh-CN");
    sample = sampleSiteDomSnapshot({
      win: live.window,
      doc: live.document,
      runtime: live.window.__AMS,
      i18n: {
        setLang: (lang: string) => {
          langCalls.push(lang);
          origSetLang(lang);
        }
      },
      locale: "zh-CN",
      now: new Date("2026-11-14T12:00:00Z")
    });
    assert.deepEqual(langCalls, ["en", "zhCN"], "采样须临时切英文拿稳定诊断名并按 resolveLocale 恢复站点原语言");
  } finally {
    live.close();
  }

  assert.equal(sample.ok, true);
  assert.equal(sample.sampling, "full-main");
  assert.equal(sample.path, "/chat/id-1");
  assert.ok((sample.diagnostics?.length ?? 0) > 0);
  assert.equal(sample.diagnostics!.every((item) => /^[\x20-\x7e]+$/.test(item.name)), true, "诊断项名称须固定为英文 ASCII");

  const { view } = fakeView({ zoom: 1.5 });
  const collected = await collectSiteDomSnapshot(
    "kimi",
    view,
    { site: "kimi", phase: "ready" },
    fakeChannel(() => sample),
    "1.34.0"
  );
  assert.equal(collected.ok, true);
  if (!collected.ok) return;

  assert.equal(collected.snapshot.zoomFactor, 1.5);
  assert.doesNotMatch(collected.serialized, /alice|corp\.example|secret|13800138000|机密|真实回答|未发送|Kimi K2|隐藏弹窗|id_rsa/);
  assert.match(collected.snapshot.html, /role="menu"/, "body 级可见弹层菜单应被一并采入");
  assert.doesNotMatch(collected.snapshot.html, /role="dialog"/, "hidden 弹层与 aside 侧栏不应混入");
  assert.match(collected.snapshot.html, /aria-haspopup="menu"/, "固定枚举控制属性应保留");
  assert.match(collected.snapshot.html, /aria-checked="true"/, "菜单选中态枚举属性应保留");

  // 与 JSDOM 版入库门禁双向对账
  assert.deepEqual(scanHtml(collected.snapshot.html, "POLYASK_PROMPT"), []);
  assert.deepEqual(scanMeta(collected.snapshot.fixture), []);

  // 验证 capture-dom-fixture --from-snapshot 可直接导入并回放定位
  const captureModulePath = "../scripts/capture-dom-fixture.mjs";
  const { importSnapshotFixture } = (await import(captureModulePath)) as {
    importSnapshotFixture: (raw: string, opts: { name: string }) => { html: string; meta: { host: string; path: string } };
  };
  const imported = importSnapshotFixture(collected.serialized, { name: "kimi-from-snapshot" });
  const replay = replayHtml(imported.html, { host: imported.meta.host, path: imported.meta.path });
  try {
    const turn = replay.adapter.historyTurn();
    assert.equal(turn.text, "POLYASK_PROMPT");
    assert.equal(turn.user === replay.document.querySelector('[data-polyask-expect~="user"]'), true);
    assert.equal(turn.answer === replay.document.querySelector('[data-polyask-expect~="answer"]'), true);
  } finally {
    replay.close();
  }
});

test("sampler switches to targeted mode when <main> exceeds 8,000 nodes and rejects >20,000 nodes", () => {
  const fillerNodes = "<span>item</span>".repeat(8_050);
  const largeMainPage = `
    <main>
      <header><button type="button" aria-haspopup="listbox">Model</button></header>
      <div class="huge-thread">${fillerNodes}</div>
      <div class="composer-wrap"><textarea>draft text</textarea></div>
    </main>
  `;
  const live = replayHtml(largeMainPage, { host: "chatgpt.com", path: "/" });
  try {
    const sample = sampleSiteDomSnapshot({
      win: live.window,
      doc: live.document,
      runtime: live.window.__AMS,
      i18n: live.window.__AMS_I18N__,
      now: new Date("2026-11-14T12:00:00Z")
    });
    assert.equal(sample.ok, true);
    assert.equal(sample.sampling, "targeted");
    assert.equal((sample.fixture?.stats.elements ?? 0) < 100, true);
  } finally {
    live.close();
  }

  const hugeControl = `<div aria-haspopup="menu">${"<b>x</b>".repeat(MAX_SNAPSHOT_NODES + 50)}</div>`;
  const overLimit = replayHtml(`<div>${hugeControl}</div>`, { host: "chatgpt.com", path: "/" });
  try {
    const sample = sampleSiteDomSnapshot({
      win: overLimit.window,
      doc: overLimit.document,
      runtime: overLimit.window.__AMS,
      i18n: overLimit.window.__AMS_I18N__
    });
    assert.equal(sample.ok, false);
    assert.equal(sample.code, "snapshot_too_large");
  } finally {
    overLimit.close();
  }
});

test("zero-dependency HTML verifier matches JSDOM scanner on malicious and unsanitized inputs", () => {
  const badCases: Record<string, string> = {
    '<a href="/x">lorem</a>': "attr:href",
    '<div style="color:red">lorem</div>': "attr:style",
    "<script>lorem</script>": "element:script",
    '<svg><path class="p"></path></svg>': "element:svg:children",
    '<div aria-expanded="open">lorem</div>': "attr_value:aria-expanded",
    '<button type="image">lorem</button>': "attr_value:type",
    "<p>Real user conversation</p>": "text:not_placeholder",
    "<p>my name is john smith</p>": "text:not_placeholder",
    '<div class="https&#x3a;&#x2f;&#x2f;evil&#x2e;com">lorem</div>': "attr_sensitive:class",
    "<p>lorem &unknownEntity; ipsum</p>": "text:invalid_entity",
    "<p>C:\\Users\\Alice\\Documents\\plan.docx</p>": "sensitive:local_path",
    "<p>session_id=abcdef1234567890</p>": "sensitive:cookie"
  };
  for (const [html, expected] of Object.entries(badCases)) {
    const zeroDep = verifySanitizedHtml(html, "POLYASK_PROMPT").problems;
    assert.equal(zeroDep.includes(expected), true, `${html} 应命中 ${expected}，实际: ${zeroDep.join(",")}`);
  }
  const clean = '<div class="row"><button type="button" aria-haspopup="menu" aria-expanded="false" disabled="">lorem ipsum</button></div>';
  assert.deepEqual(verifySanitizedHtml(clean, "POLYASK_PROMPT").problems, []);
  assert.deepEqual(scanHtml(clean, "POLYASK_PROMPT"), []);
});

test("main-process service guards navigation/auth/privacy and blocks Save dialog when verification fails", async () => {
  // 1. 登录域名与加载中一律拒采
  const auth = fakeView({ url: "https://accounts.google.com/signin" });
  const authRes = await collectSiteDomSnapshot("gemini", auth.view, { site: "gemini", phase: "ready" }, fakeChannel(() => ({ ok: true })), "1.34.0");
  assert.deepEqual(authRes, { ok: false, code: "not_ready" });

  // 2. 采样中途发生跳转时丢弃结果
  const nav = fakeView({ url: "https://www.kimi.com/chat/1" });
  const navRes = await collectSiteDomSnapshot(
    "kimi",
    nav.view,
    { site: "kimi", phase: "ready" },
    fakeChannel(() => {
      nav.setUrl("https://www.kimi.com/chat/2");
      return { ok: true };
    }),
    "1.34.0"
  );
  assert.deepEqual(navRes, { ok: false, code: "not_ready" });

  // 3. 隔离上下文若被篡改回传未脱敏正文，主进程门禁必须在打开保存框前拦截
  const tampered: SiteDomSnapshotSample = {
    ok: true,
    path: "/chat/id-1",
    capturedAt: "2026-11-14",
    viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    diagnostics: [{ name: "Composer", kind: "control", ok: true }],
    sampling: "full-main",
    fixture: {
      schema: 1,
      path: "/chat/id-1",
      promptToken: "POLYASK_PROMPT",
      source: "captured",
      capturedAt: "2026-11-14",
      expect: { userCount: 0, userText: null, answer: false },
      stats: { elements: 1, texts: 1, promptHits: 0, droppedElements: 0, droppedAttrs: 0, truncated: false, marked: 0 }
    },
    html: "<main>未脱敏真实聊天内容 leak@example.com</main>"
  };
  let dialogOpened = false;
  let diskWritten = false;
  const { view } = fakeView();
  const exportRes = await exportSiteDomSnapshot({
    site: "kimi",
    collect: (site) => collectSiteDomSnapshot(site, view, { site: "kimi", phase: "ready" }, fakeChannel(() => tampered), "1.34.0"),
    choosePath: async () => { dialogOpened = true; return "/tmp/should-not-write.json"; },
    write: async () => { diskWritten = true; }
  });
  assert.deepEqual(exportRes, { status: "failed", code: "snapshot_privacy_blocked" });
  assert.equal(dialogOpened, false, "隐私复核未通过时严禁弹出保存对话框");
  assert.equal(diskWritten, false, "隐私复核未通过时严禁写盘");

  // 4. 合法快照正常走保存与取消分支
  const validSnapshot: SiteDomSnapshotFile = {
    schema: SITE_SNAPSHOT_SCHEMA,
    kind: SITE_SNAPSHOT_KIND,
    site: "kimi",
    host: "www.kimi.com",
    path: "/chat/id-1",
    capturedAt: "2026-11-14",
    appVersion: "1.34.0",
    viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    zoomFactor: 1,
    diagnostics: [{ name: "Composer", kind: "control", ok: true }],
    sampling: "full-main",
    fixture: { ...tampered.fixture!, host: "www.kimi.com" },
    html: "<main>lorem ipsum</main>"
  };
  assert.deepEqual(verifySanitizedSnapshot(validSnapshot, { site: "kimi", host: "www.kimi.com" }), { ok: true });
  const cancelled = await exportSiteDomSnapshot({
    site: "kimi",
    collect: async () => ({ ok: true, snapshot: validSnapshot, serialized: JSON.stringify(validSnapshot) }),
    choosePath: async () => null
  });
  assert.deepEqual(cancelled, { status: "cancelled" });
});

test("sampler handles multi-element multi-line prompts, scrubs code-fence/heading/role/route leaks, and keeps targeted mode control-only", async () => {
  const multiLinePrompt = "第一行机密指令\n第二行合同金额";
  const page = `
    <main>
      <header><button type="button" aria-haspopup="menu" data-testid="model-picker">Kimi</button></header>
      <div class="chat-content-list">
        <div class="chat-content-item chat-content-item-user" data-message-id="u-1" data-author="AliceSmith">
          <div class="user-content"><p>第一行机密指令</p>
<p>第二行合同金额</p></div>
        </div>
        <div class="chat-content-item chat-content-item-assistant" data-message-id="a-1">
          <div class="markdown">
            <h2 id="acme-merger-plan">并购方案</h2>
            <pre><code class="language-acme-payroll-alice">salary = 999</code></pre>
            <pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>
          </div>
        </div>
      </div>
      <div class="chat-input-box"><textarea></textarea></div>
    </main>
  `;
  const live = replayHtml(page, { host: "www.kimi.com", path: "/chat/acme-private-project" });
  try {
    const sample = sampleSiteDomSnapshot({
      win: live.window,
      doc: live.document,
      runtime: live.window.__AMS,
      i18n: live.window.__AMS_I18N__,
      now: new Date("2026-11-14T12:00:00Z")
    });
    assert.equal(sample.ok, true);
    assert.equal(sample.path, "/chat/id-1");
    assert.equal(sample.fixture?.expect.userText, "POLYASK_PROMPT-L1\nPOLYASK_PROMPT-L2");
    assert.match(sample.html!, /POLYASK_PROMPT-L1/);
    assert.match(sample.html!, /POLYASK_PROMPT-L2/);
    assert.match(sample.html!, /language-code/);
    assert.match(sample.html!, /language-mermaid/);
    assert.doesNotMatch(sample.html!, /AliceSmith|acme-merger-plan|acme-payroll-alice|acme-private-project|第一行|第二行|并购方案/);
    assert.equal(multiLinePrompt.length > 0, true);
  } finally {
    live.close();
  }

  // Oversized Kimi thread (>8,000 nodes) degrades to control-only targeted snapshot and blocks full-main replay import by default
  const hugeKimi = `
    <main>
      <header><button type="button" aria-haspopup="menu" data-testid="model-picker">Kimi</button></header>
      <div class="chat-content-list">
        <div class="chat-content-item chat-content-item-user" data-message-id="u-1"><div class="user-content">Question</div></div>
        <div class="chat-content-item chat-content-item-assistant" data-message-id="a-1"><div class="markdown"><p>Answer</p></div></div>
        <div>${"<span>pad</span>".repeat(8_020)}</div>
      </div>
      <div class="chat-input-box"><textarea></textarea></div>
    </main>
  `;
  const hugeLive = replayHtml(hugeKimi, { host: "www.kimi.com", path: "/chat/abc" });
  try {
    const degraded = sampleSiteDomSnapshot({
      win: hugeLive.window,
      doc: hugeLive.document,
      runtime: hugeLive.window.__AMS,
      i18n: hugeLive.window.__AMS_I18N__,
      now: new Date("2026-11-14T12:00:00Z")
    });
    assert.equal(degraded.ok, true);
    assert.equal(degraded.sampling, "targeted");
    assert.equal(degraded.path, "/chat/id-1");
    assert.doesNotMatch(degraded.html!, /chat-content-item-user|chat-content-item-assistant/);
    const { view } = fakeView({ url: "https://www.kimi.com/chat/abc" });
    const collected = await collectSiteDomSnapshot("kimi", view, { site: "kimi", phase: "ready" }, fakeChannel(() => degraded), "1.34.0");
    assert.equal(collected.ok, true);
    if (collected.ok) {
      const captureModulePath = "../scripts/capture-dom-fixture.mjs";
      const { importSnapshotFixture } = (await import(captureModulePath)) as {
        importSnapshotFixture: (raw: string, opts: { name: string; allowPartial?: boolean }) => { html: string; meta: { expect: { userCount: number } } };
      };
      assert.throws(() => importSnapshotFixture(collected.serialized, { name: "kimi-degraded" }), /snapshot_not_full_main:targeted/);
      const partial = importSnapshotFixture(collected.serialized, { name: "kimi-degraded", allowPartial: true });
      assert.equal(partial.meta.expect.userCount, 0);
    }
  } finally {
    hugeLive.close();
  }
});
