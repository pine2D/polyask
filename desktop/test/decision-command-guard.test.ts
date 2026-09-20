import assert from "node:assert/strict";
import test from "node:test";
import { executeCommand } from "../src/renderer/command-dispatcher";
import { registerDecisionNavigationGuard, requestDecisionNavigation } from "../src/renderer/decision-navigation";

test("global commands defer all side effects until decision discard is explicitly approved",()=>{
  let proposed:(()=>void)|undefined;
  let effects=0;
  let asks=0;
  const off=registerDecisionNavigationGuard(action=>{asks++;proposed=action;});
  try{
    assert.equal(executeCommand("set-think",{"set-think":()=>{effects++;requestDecisionNavigation(()=>{effects++;});}}),true);
    assert.equal(effects,0);
    proposed!();
    assert.equal(effects,2);
    assert.equal(asks,1);
  }finally{off();}
  executeCommand("set-think",{"set-think":()=>{effects++;}});
  assert.equal(effects,3);
});
