// DOM fixture 入库门禁：desktop/scripts/fixtures-dom/ 里每个文件都必须过脱敏扫描。仓库公开，
// 扫描器本身也要证明「会红」——下面的负例逐条喂敏感形状，防止规则被改坏后整组假绿。
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { FIXTURE_DIR, scanFixtureDir, scanHtml, scanMeta } = require("./lib/dom-fixture-scan");
const { findSensitive } = require("./lib/dom-fixture-sanitize");

test("every committed DOM fixture passes the sanitizer scan", () => {
  assert.ok(fs.existsSync(path.join(FIXTURE_DIR, "README.md")), "fixtures-dom/README.md 是格式说明，不能删");
  assert.ok(fs.readdirSync(FIXTURE_DIR).some((file) => file.endsWith(".html")), "至少要有一个 fixture，否则门禁空转");
  assert.deepEqual(scanFixtureDir(), []);
});

test("sensitive shapes are rejected", () => {
  // 假密钥样本拼接书写：完整字面量会被 GitHub 推送保护当成真凭据拦下（值不变）。
  const cases = {
    url: ["see https://example.test/a", "//cdn.example.test/x.js", "www.example", "blob:https"],
    email: ["someone@example.test"],
    phone: ["13800138000", "138 0013 8000 1"],
    uuid: ["0f8fad5b-d9cb-469f-a165-70867728950e"],
    hex: ["a3f9c2d1e4b5a6978877665544332211"],
    base64: ["QWxhZGRpbjpvcGVuIHNl" + "c2FtZQ9xYz1234AbCdEf"],
    jwt: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
    token: ["sk-abcdefghijklmnop", "sk_live_abcdefghijkl", "ghp_abcdefghijklmnop1234", "xoxb-1234567890-abc", "AKIA" + "ABCDEFGHIJKLMNOP",
      "AIzaSyAbcdefghijklmnopqrstu", "Bearer abcdefghijklmn"],
  };
  for (const [kind, values] of Object.entries(cases)) {
    for (const value of values) assert.ok(findSensitive(value).includes(kind), `${kind} 漏检: ${value}`);
  }
});

test("ordinary class names and placeholders are not false positives", () => {
  for (const value of ["file:text-sm", "text-token-text-secondary-foreground-strong", "group-data-[state=open]:rotate-180",
    "chat-content-item-assistant", "id-12", "label-3", "lorem ipsum dolor", "POLYASK_PROMPT-L2", "w-1/2", "@container",
    "skill-arg-hint-sr", "pkg-manager-selector", "rk-row-container"]) {
    assert.deepEqual(findSensitive(value), [], value);
  }
});

test("unsanitized markup is rejected element by element", () => {
  const bad = {
    '<a href="/x">lorem</a>': "attr:href",
    '<div style="color:red">lorem</div>': "attr:style",
    '<img src="/a.png">': "attr:src",
    "<script>lorem</script>": "element:script",
    '<svg><path class="p"></path></svg>': "element:svg:children",
    '<div data-message-id="m9">lorem</div>': "attr_value:data-message-id",
    '<div aria-label="Copy">lorem</div>': "attr_value:aria-label",
    '<div id=":r1a:">lorem</div>': "attr_value:id",
    "<p>Hello World</p>": "text:not_placeholder",
    "<p>lorem 42</p>": "text:not_placeholder",
    "<!-- lorem --><p>lorem</p>": "comment",
    '<div data-polyask-expect="question">lorem</div>': "attr_value:data-polyask-expect",
    // 全小写的真实英文不是占位：每个词都得在 FILLER 词表里
    "<p>my name is john smith and my bank pin is four two</p>": "text:not_placeholder",
    // 实体编码绕不过：门禁按解码后的属性值复核
    '<div class="john&#64;example&#46;com">lorem</div>': "attr_value:class",
    '<div class="https&#x3a;&#x2f;&#x2f;evil&#x2e;com">lorem</div>': "attr_sensitive:class",
    '<div class="before:content-[&#39;secret_text&#39;]">lorem</div>': "attr_value:class",
  };
  for (const [html, problem] of Object.entries(bad)) assert.ok(scanHtml(html, "POLYASK_PROMPT").includes(problem), `${html} 应报 ${problem}`);
  assert.deepEqual(scanHtml('<div class="x" data-message-id="id-1" aria-label="label-1" data-polyask-expect="user"><p>POLYASK_PROMPT</p></div>', "POLYASK_PROMPT"), []);
  assert.deepEqual(scanHtml("<p>POLYASK_PROMPT-L1\nPOLYASK_PROMPT-L2</p>", "POLYASK_PROMPT"), []);
  assert.deepEqual(scanHtml("<p>lorem ipsum dolor sit amet consectetur a</p><p>dolor sit</p><p>lore</p>", "POLYASK_PROMPT"), [], "长度档截断出的末词前缀合法");
  assert.ok(scanHtml("<p>lore ipsum</p>", "POLYASK_PROMPT").includes("text:not_placeholder"), "只有末词允许是前缀");
  assert.ok(scanHtml("<p>OTHER_TOKEN</p>", "POLYASK_PROMPT").includes("text:not_placeholder"));
});

test("fixture meta is whitelisted and sanitized", () => {
  const good = { schema: 1, host: "www.kimi.com", path: "/chat/id-1", promptToken: "POLYASK_PROMPT", source: "captured",
    capturedAt: "2026-10-03", expect: { userCount: 1, userText: "POLYASK_PROMPT", answer: true }, stats: { elements: 3, truncated: false } };
  assert.deepEqual(scanMeta(good), []);
  assert.ok(scanMeta({ ...good, host: "evil.test" }).includes("meta:host"));
  assert.ok(scanMeta({ ...good, path: "/chat/0f8fad5b-d9cb-469f-a165-70867728950e" }).includes("meta:sensitive:uuid"));
  // 会话 id 必须已换成 id-N：短的字母数字 id、纯数字 id、任意查询串都不是 sanitizeRoute 的产物
  for (const path of ["/chat/d3k9a2m1q8r7t6y5u4i3", "/chat/1234567890", "/x?q=my-question-words", "/a/chat/s/cr9v3k2l8q0ab", "chat/id-1"]) {
    assert.ok(scanMeta({ ...good, path }).includes("meta:path"), path);
  }
  for (const path of ["/", "/chat/", "/chat/naQivTmsDa", "/c/id-2", "/main/alltoolsdetail?cid=id-1"]) assert.deepEqual(scanMeta({ ...good, path }), [], path);
  assert.ok(scanMeta({ ...good, url: "x" }).includes("meta:key:url"));
  assert.ok(scanMeta({ ...good, note: "问题原文" }).includes("meta:note"));
  assert.ok(scanMeta({ ...good, expect: { ...good.expect, userText: "real prompt" } }).includes("meta:expect:userText"));
});
