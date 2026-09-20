import assert from "node:assert/strict";
import test from "node:test";
import { buildSynthesisPrompt, validateSynthesisRequest } from "../src/shared/synthesis";
import { archiveFixture } from "./fixtures";
const record = {...archiveFixture(), text:"original question", task:"short display title", results:[
  {host:"claude.ai",label:"Claude",text:"First answer"},
  {host:"chatgpt.com",label:"ChatGPT",text:"Before\nExact excerpt\nAfter",code:"answer_truncated"}
]};
const request = {archiveId:record.id,targetSite:"claude",tier:null,selectedHosts:["chatgpt.com"],instruction:"Why?",excerpt:"Exact excerpt"};
test("follow-up accepts one exact excerpt, fences it and retains original source numbering", () => {
  assert.equal(validateSynthesisRequest(request,record),null);
  const prompt=buildSynthesisPrompt({...request,record});
  assert.match(prompt,/# Task\noriginal question/);
  assert.match(prompt,/Source \[S2\]: captured text is truncated/);
  assert.match(prompt,/--- answer start · [\da-f-]+ ---\nExact excerpt\n--- answer end/);
  assert.ok(!prompt.includes("Before"));
  assert.ok(!prompt.includes("First answer"));
  assert.ok(prompt.endsWith("# Follow-up request\nWhy?"));
});
test("follow-up rejects forged, missing, malformed or multiple sources without weakening synthesis", () => {
  for(const patch of [{excerpt:"invented"},{excerpt:" "},{excerpt:null},{excerpt:5},{instruction:" "},{selectedHosts:["missing"]},{selectedHosts:["claude.ai","chatgpt.com"]}])
    assert.equal(validateSynthesisRequest({...request,...patch},record),"invalid_request");
  assert.equal(validateSynthesisRequest({...request,excerpt:undefined},record),"not_enough_answers");
  assert.equal(validateSynthesisRequest({...request,targetSite:"unknown"},record),"target_missing");
  const huge="a".repeat(60000);
  assert.equal(validateSynthesisRequest({...request,excerpt:huge},{...record,results:[{...record.results[1],text:huge}]}),"too_long");
});
