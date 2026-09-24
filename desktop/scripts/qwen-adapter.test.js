const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const trigger = { textContent: "Qwen3.7-千问", children: [], getAttribute: () => null };
const label = { textContent: "思考" };
const thinkButton = { className: "text-theme", textContent: "思考", querySelectorAll: () => [label], getAttribute: () => null };
const document = { querySelectorAll(selector) {
  if (selector === '[aria-haspopup="dialog"]') return [trigger];
  if (selector === 'button[aria-haspopup="menu"]') return [];
  if (selector === "button") return [thinkButton];
  return [];
} };
const helpers = { waitFor() {}, findByText() {}, openMenu() {}, clickEl() {}, sleep: () => Promise.resolve(), escMenus() {} };
const context = { document, t: (key) => key, window: { __AMS: { ...helpers, ...require("./lib/deadline-harness"), adapters: {} } }, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime/adapters-cn.js"), "utf8"), context);

const qwen = context.window.__AMS.adapters["qianwen.com"];
assert.equal(qwen.state(), "think", "Qwen3.7-千问 开启思考应识别为 think");
// 档位正则必须只在源码里出现一次（执行端与识别端共用常量），两处各写一遍就是漂开的起点
{
  const src = fs.readFileSync(path.join(__dirname, "../src/site-runtime/adapters-cn.js"), "utf8");
  const literal = "Qwen3\\.7-千问(?!-Max)";
  assert.equal(src.split(literal).length - 1, 1, "两档选择与识别共用一份模型正则");
  assert.equal(qwen._MODEL.source, literal);
}
trigger.textContent = "Qwen3.7-Max";
assert.equal(qwen.state(), null, "Max 不能冒充预设思考档");
thinkButton.className = "text-primary";
trigger.textContent = "Qwen3.7-千问";
assert.equal(qwen.state(), "fast", "正式版关闭思考时应识别为 fast");
trigger.textContent = "Qwen3.7-Max";
assert.equal(qwen.state(), null, "Max 不是预设快速档");
trigger.textContent = "Qwen3.8-Max";
assert.equal(qwen.state(), null, "工作模式模型不得冒充日常快速档");

(async () => {
  let selected;
  qwen._selectModel = async (re) => { selected = re; };
  qwen._setThink = async () => {};
  await qwen.think();
  assert.equal(selected.test("Qwen3.7-千问"), true);
  assert.equal(selected.test("Qwen3.7-Max"), false, "思考档不得选择不支持思考研究的 Max");
  await qwen.fast();
  assert.equal(selected.test("Qwen3.7-千问"), true);
  assert.equal(selected.test("Qwen3.7-Max"), false, "快速档不得选择 Max");

  // F075：上面全部用例都把 _selectModel 整个 stub 掉，覆盖为零。这里真实调用它——
  // 菜单打开、leaf 点击、点完复读 _trigger() 确认模型真的换了；点击被吞时必须抛错而非静默成功。
  function selectModelFixture(clickTakesEffect) {
    let modelText = "Qwen3.7-Max", menuOpen = false, escCount = 0;
    const trigger = {
      get textContent() { return modelText; },
      getAttribute(name) { return name === "aria-haspopup" ? "dialog" : null; },
      children: [], click() { menuOpen = true; },
    };
    const thinkItem = {
      tagName: "LI", children: [], textContent: "Qwen3.7-千问", getAttribute() { return null; },
      click() { menuOpen = false; if (clickTakesEffect) modelText = "Qwen3.7-千问"; },
    };
    const doc = { querySelectorAll(selector) {
      if (selector === '[aria-haspopup="dialog"]') return [trigger];
      if (selector === "div,li,span,button") return menuOpen ? [trigger, thinkItem] : [trigger];
      return [];
    } };
    const findByText = (selector, re) => [...doc.querySelectorAll(selector)]
      .find((node) => re.test((node.textContent || "").trim())) || null;
    const ctx = {
      document: doc, t: (key) => key, console, MouseEvent: class { constructor(type) { this.type = type; } },
      window: { __AMS: {
        waitFor: async (fn) => fn() || null, findByText, openMenu() {}, clickEl(el) { el.click(); },
        sleep: () => Promise.resolve(), escMenus() { escCount++; }, ...require("./lib/deadline-harness"), adapters: {},
      } },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime/adapters-cn.js"), "utf8"), ctx);
    return { qwen: ctx.window.__AMS.adapters["qianwen.com"], trigger, escCount: () => escCount };
  }
  const reThink = /Qwen3\.7-千问(?!-Max)/i;

  const applied = selectModelFixture(true);
  await applied.qwen._selectModel(reThink);
  assert.equal(applied.trigger.textContent, "Qwen3.7-千问", "真实点击应换成目标模型");
  assert.ok(applied.escCount() >= 1, "成功路径必须 escMenus 收尾");

  const swallowed = selectModelFixture(false); // 站点吞掉点击，模型其实没换
  await assert.rejects(() => swallowed.qwen._selectModel(reThink), /模型未生效/,
    "点击被吞、模型未真的切换时必须抛错，不能让 runMode 误报「已切到」");

  console.log("Qwen adapter checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
