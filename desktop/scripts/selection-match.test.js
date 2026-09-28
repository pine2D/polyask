const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const S = {}, file = path.join(__dirname, "../src/site-runtime/selection-match.js");
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, "utf8"), { window: { __AMS: S } });
const models = [{ model: "GPT-5.6 Sol", aliases: ["GPT-5.6 Sol"] },
  { model: "GPT-5.5", aliases: ["GPT-5.5"] }];
const node = (text, extra = {}) => ({ text, visible: true, disabled: false, ...extra });
const match = (candidates, preferences = models) => {
  assert.equal(typeof S.matchSelection, "function", "运行时须提供真实候选匹配器");
  return S.matchSelection(candidates, preferences, candidate => candidate);
};

test("匹配维护的精确别名，允许零宽、空白及常见连字符变化", () => {
  const item = node("  GPT\u200b–5.6\u00a0Sol ");
  const result = match([item]);
  assert.equal(result.candidate, item);
  assert.equal(result.model, "GPT-5.6 Sol");
});

test("优先级由维护表决定，不按版本号猜测或追随最新别名", () => {
  const preferred = node("GPT-5.6 Sol"), older = node("GPT-5.5");
  assert.equal(match([node("GPT-9 Pro"), older, preferred]).candidate, preferred);
  for (const text of ["最新", "GPT-5.6 Sol Max", "GPT-5.7 Sol", "About GPT-5.6 Sol"])
    assert.equal(match([node(text)]), null, text);
});

test("同优先级多个候选或同一别名指向多个模型时拒绝歧义", () => {
  assert.equal(match([node("GPT-5.6 Sol"), node("GPT-5.6 Sol"), node("GPT-5.5")]), null);
  assert.equal(match([node("GPT-5.6 Sol")], [...models, { model: "Other", aliases: ["GPT-5.6 Sol"] }]), null);
});

test("不可见、禁用及缺少可用性证据的候选不能命中", () => {
  for (const extra of [{ disabled: true }, { visible: false }, { visible: undefined }, { disabled: undefined }])
    assert.equal(match([node("GPT-5.6 Sol", extra)]), null);
  assert.equal(match([node("GPT-5.6 Sol", { disabled: true }), node("GPT-5.5")]).model, "GPT-5.5");
});
