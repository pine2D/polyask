import assert from "node:assert/strict";
import test from "node:test";
import { promptVariables, fillPromptVariables } from "../src/shared/prompt-variables";
import { COPY } from "../src/shared/copy";

test("variables are unique, trimmed, bounded names; ordinary braces stay literal", () => {
  assert.deepEqual(promptVariables("{{ 受众 }} {{受众}} {{__proto__}} {x} {{\nno}}"), ["受众", "__proto__"]);
  assert.deepEqual(promptVariables(`{{${"x".repeat(41)}}}`), []);
});
test("replacement is literal and nonrecursive; missing inherited values cannot fill", () => {
  const text = "{{内容}} / {{ 内容 }} / {{__proto__}}";
  const values = Object.fromEntries([["内容", "$& {{受众}}\n原文"], ["__proto__", "ok"]]);
  assert.equal(fillPromptVariables(text, values), "$& {{受众}}\n原文 / $& {{受众}}\n原文 / ok");
  assert.equal(fillPromptVariables("{{toString}}", {}), null);
  assert.equal(fillPromptVariables("{{内容}}", {内容: "  \n"}), null);
  assert.equal(fillPromptVariables("普通正文", {}), "普通正文");
});
test("expanded prompt length is bounded by Unicode characters", () => {
  assert.equal(fillPromptVariables("{{内容}}", {内容: "x".repeat(100001)}), null);
  assert.equal(fillPromptVariables("{{内容}}", {内容: "😀".repeat(100000)})?.length, 200000);
});
test("three localized starter templates have usable variables and no residual slots", () => {
  for (const copy of Object.values(COPY)) {
    for (const text of [copy.taskCompareText, copy.taskReviewText, copy.taskTechnicalText]) {
      const names = promptVariables(text);
      assert.equal(names.length, 4);
      const filled = fillPromptVariables(text, Object.fromEntries(names.map(name => [name, "test"])));
      assert.ok(filled);
      assert.ok(!filled.includes("{{"));
    }
  }
});
