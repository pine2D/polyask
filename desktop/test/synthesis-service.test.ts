import assert from "node:assert/strict";
import test from "node:test";

import { ArchiveService } from "../src/main/archive-service";
import { DesktopDatabase } from "../src/main/database";
import { SITES } from "../src/main/sites";
import { SynthesisService } from "../src/main/synthesis-service";
import type { BroadcastPayload, SiteRunResult } from "../src/shared/protocol";
import { getCopy } from "../src/shared/copy";

function fixture() {
  const database = DesktopDatabase.open(":memory:");
  let now = 1_000;
  const archives = new ArchiveService(database.archives, {
    deviceId: () => "device-a",
    now: () => now,
    createId: () => "archive-a"
  });
  const record = archives.add({
    text: "Question",
    task: "Question",
    results: [
      { host: "claude.ai", label: "Claude", text: "One" },
      { host: "chatgpt.com", label: "ChatGPT", text: "Two" }
    ]
  });
  return { database, archives, record, setNow: (value: number) => { now = value; } };
}

test("citation report uses the existing collect/save path and exports with original source IDs", async () => {
  const { database, archives, record } = fixture();
  const report = 'AI analysis: [S1] "One"; [S2] "Two". Verify manually.';
  const instruction = getCopy("en").citationReportInstruction;
  let sends = 0;
  try {
    const service = new SynthesisService({
      sites: SITES, archives, navigate: async () => undefined,
      send: async request => {
        sends++;
        assert.match(request.text, /Source \[S1\]/);
        assert.match(request.text, /Source \[S2\]/);
        assert.ok(request.text.endsWith(instruction));
        return [{site:"claude",ok:true}];
      },
      collect: async () => [{site:"claude",host:"claude.ai",label:"Claude",text:report,state:"think"}],
      showTarget: () => undefined, recordHistory: () => undefined, now: () => 2_000
    });
    await service.send({archiveId:record.id,targetSite:"claude",tier:"think",selectedHosts:["claude.ai","chatgpt.com"],instruction});
    await service.collect();
    const saved = await service.save(false);
    assert.equal(sends, 1);
    assert.equal(saved.synthesis?.text, report);
    assert.equal(saved.synthesis?.instruction, instruction);
    assert.deepEqual(saved.results, record.results);
    const markdown = archives.exportMarkdown(record.id,"en");
    assert.match(markdown,/## Claude\n\n\[S1\]\n\nOne/);
    assert.match(markdown,/## ChatGPT\n\n\[S2\]\n\nTwo/);
    assert.ok(markdown.includes(report));
    assert.ok(markdown.includes(getCopy("en").citationReportNotice));
  } finally { database.close(); }
});

test("synthesis reveals the focused native site before opening a new session and sending once", async () => {
  const { database, archives, record } = fixture();
  const events: string[] = [];
  const requests: BroadcastPayload[] = [];
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      navigate: async (site) => { events.push(`navigate:${site}`); },
      send: async (request) => {
        events.push("send");
        requests.push(request);
        return [{ site: "gemini", ok: true }];
      },
      collect: async () => [],
      showTarget: (site) => { events.push(`focus:${site}`); },
      recordHistory: (text) => { events.push(`history:${text.startsWith("# Task")}`); },
      now: () => 2_000
    });

    const response = await service.send({
      archiveId: record.id,
      targetSite: "gemini",
      tier: "think",
      selectedHosts: ["claude.ai", "chatgpt.com"],
      instruction: "Resolve disagreements"
    });

    assert.equal(response.result.ok, true);
    assert.equal(response.pending?.archiveId, record.id);
    assert.deepEqual(events, ["focus:gemini", "navigate:gemini", "send", "history:true"]);
    assert.deepEqual(requests[0].sites, ["gemini"]);
    assert.deepEqual(requests[0].images, []);
    assert.match(requests[0].text, /Resolve disagreements/);
    assert.deepEqual(service.getPending(), response.pending);
  } finally {
    database.close();
  }
});

test("synthesis invalidates a completed run after validation and before navigation", async () => {
  const { database, archives, record } = fixture();
  const events: string[] = [];
  try {
    const options = {
      sites: SITES,
      archives,
      beforeSend: () => { events.push("clear"); },
      navigate: async () => { events.push("navigate"); },
      send: async (): Promise<SiteRunResult[]> => { events.push("send"); return [{ site: "claude", ok: true }]; },
      collect: async () => [],
      showTarget: () => undefined,
      recordHistory: () => undefined
    };
    const service = new SynthesisService(options);
    await service.send({
      archiveId: record.id,
      targetSite: "claude",
      tier: null,
      selectedHosts: ["claude.ai", "chatgpt.com"],
      instruction: ""
    });
    assert.deepEqual(events, ["clear", "navigate", "send"]);
    await assert.rejects(
      () => service.send({ archiveId: record.id, targetSite: "claude", tier: null, selectedHosts: [], instruction: "" }),
      /not_enough_answers/
    );
    assert.deepEqual(events, ["clear", "navigate", "send"]);
  } finally {
    database.close();
  }
});

test("synthesis rejects a target outside the current selected-site scope", async () => {
  const { database, archives, record } = fixture();
  let navigated = false;
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      targetAvailable: (site) => site === "claude",
      navigate: async () => { navigated = true; },
      send: async () => [{ site: "gemini", ok: true }],
      collect: async () => [],
      showTarget: () => undefined,
      recordHistory: () => undefined
    });
    await assert.rejects(
      () => service.send({ archiveId: record.id, targetSite: "gemini", tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "" }),
      /target_not_selected/
    );
    assert.equal(navigated, false);
  } finally { database.close(); }
});

test("uncertain synthesis submit is exposed once and never creates pending state", async () => {
  const { database, archives, record } = fixture();
  let sends = 0;
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      navigate: async () => undefined,
      send: async (): Promise<SiteRunResult[]> => {
        sends += 1;
        return [{ site: "claude", ok: false, code: "submit_unconfirmed" }];
      },
      collect: async () => [],
      showTarget: () => undefined,
      recordHistory: () => undefined,
      now: () => 2_000
    });
    const response = await service.send({
      archiveId: record.id,
      targetSite: "claude",
      tier: null,
      selectedHosts: ["claude.ai", "chatgpt.com"],
      instruction: ""
    });
    assert.equal(sends, 1);
    assert.equal(response.result.code, "submit_unconfirmed");
    assert.equal(response.pending, null);
    assert.equal(service.getPending(), null);
  } finally {
    database.close();
  }
});

test("synthesis rejects missing archives and cancelled sends without pending state", async () => {
  const { database, archives, record } = fixture();
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      navigate: async () => undefined,
      send: async () => [{ site: "claude", ok: false, code: "cancelled" }],
      collect: async () => [],
      showTarget: () => undefined,
      recordHistory: () => undefined
    });
    await assert.rejects(() => service.send({ archiveId: "missing", targetSite: "claude", tier: null, selectedHosts: [], instruction: "" }), /archive_not_found/);
    const response = await service.send({ archiveId: record.id, targetSite: "claude", tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "" });
    assert.equal(response.result.code, "cancelled");
    assert.equal(service.getPending(), null);
  } finally {
    database.close();
  }
});

test("synthesis cancellation interrupts a pending new-session navigation", async () => {
  const { database, archives, record } = fixture();
  let navigationStarted!: () => void;
  const started = new Promise<void>((resolve) => { navigationStarted = resolve; });
  let sends = 0;
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      navigate: () => new Promise(() => { navigationStarted(); }),
      send: async () => { sends += 1; return [{ site: "claude", ok: true }]; },
      collect: async () => [],
      showTarget: () => undefined,
      recordHistory: () => undefined
    });
    const pending = service.send({ archiveId: record.id, targetSite: "claude", tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "" });
    await started;
    service.cancel();
    const response = await pending;
    assert.equal(response.result.code, "cancelled");
    assert.equal(response.pending, null);
    assert.equal(sends, 0);
  } finally {
    database.close();
  }
});

test("a local history failure cannot hide a confirmed synthesis send", async () => {
  const { database, archives, record } = fixture();
  let focused = false;
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      navigate: async () => undefined,
      send: async () => [{ site: "claude", ok: true }],
      collect: async () => [],
      showTarget: () => { focused = true; },
      recordHistory: () => { throw new Error("disk full"); },
      now: () => 2_000
    });
    const response = await service.send({ archiveId: record.id, targetSite: "claude", tier: null, selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "" });
    assert.equal(response.result.ok, true);
    assert.equal(response.pending?.archiveId, record.id);
    assert.equal(focused, true);
  } finally {
    database.close();
  }
});

test("synthesis collection requires a current answer and replacement confirmation", async () => {
  const { database, archives, record, setNow } = fixture();
  let answer: string | null = null;
  try {
    const service = new SynthesisService({
      sites: SITES,
      archives,
      navigate: async () => undefined,
      send: async () => [{ site: "claude", ok: true }],
      collect: async () => [{ site: "claude", host: "claude.ai", label: "Claude", text: answer, code: answer ? undefined : "no_answer" }],
      showTarget: () => undefined,
      recordHistory: () => undefined,
      now: () => 2_000
    });
    await service.send({ archiveId: record.id, targetSite: "claude", tier: "fast", selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "Compare" });
    await assert.rejects(() => service.collect(), /synthesis_collect_failed/);
    answer = "Combined answer";
    const candidate = await service.collect();
    assert.equal(candidate.text, "Combined answer");
    assert.equal(candidate.state, null);

    setNow(2_500);
    archives.update(record.id, { synthesis: { host: "chatgpt.com", text: "Old", state: null, instruction: "", createdAt: 2_500 } });
    await assert.rejects(() => service.save(false), /replace_confirmation_required/);
    setNow(3_000);
    const saved = await service.save(true);
    assert.equal(saved.synthesis?.text, "Combined answer");
    assert.equal(saved.synthesis?.host, "claude.ai");
    assert.equal(saved.synthesis?.state, "fast");
    assert.equal(service.getPending(), null);
  } finally {
    database.close();
  }
});

test("follow-up validates before navigation and sends once to one selected site, retaining originals", async () => {
  const {database,archives,record}=fixture();
  const sends: BroadcastPayload[]=[];
  let navigations=0;
  let accepted=false;
  try {
    const service=new SynthesisService({sites:SITES,archives,
      navigate:async()=>{navigations++;},showTarget:()=>undefined,recordHistory:()=>undefined,
      targetAvailable:site=>site==="claude",
      send:async request=>{sends.push(request);return [{site:"claude",ok:accepted,code:accepted?undefined:"submit_unconfirmed"}];},
      collect:async()=>[{site:"claude",host:"claude.ai",label:"Claude",text:"Follow-up answer"}]
    });
    const request={archiveId:record.id,targetSite:"claude",tier:null,selectedHosts:["chatgpt.com"],excerpt:"Two",instruction:"Explain this"};
    await assert.rejects(service.send({...request,excerpt:"forged"}),/invalid_request/);
    await assert.rejects(service.send({...request,targetSite:"gemini"}),/target_not_selected/);
    assert.equal(navigations,0);
    const uncertain=await service.send(request);
    assert.equal(uncertain.result.code,"submit_unconfirmed");
    assert.equal(uncertain.pending,null);
    assert.equal(sends.length,1);
    accepted=true;
    await service.send(request);
    assert.equal(sends.length,2); // 第二次是显式调用，未自动重发。
    assert.deepEqual(sends[1].sites,["claude"]);
    assert.match(sends[1].text,/Source \[S2\]/);
    assert.match(sends[1].text,/# Follow-up request\nExplain this/);
    await service.collect();
    const saved=await service.save(false);
    assert.equal(saved.synthesis?.text,"Follow-up answer");
    assert.deepEqual(saved.results,record.results);
    await service.send(request);
    await service.collect();
    await assert.rejects(service.save(false),/replace_confirmation_required/);
    assert.deepEqual((await service.save(true)).results,record.results);
  } finally {database.close();}
});
