import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ExclusiveActionLock } from "../../src/renderer/broadcast-flow-state";
import { useSynthesisFlow } from "../../src/renderer/use-synthesis-flow";
import { setShellApi } from "../../src/renderer/shell-api";
import type { PolyAskDesktopApi } from "../../src/preload/shell";
import type { SynthesisCandidate, SynthesisSendResponse } from "../../src/shared/synthesis";

let flow: ReturnType<typeof useSynthesisFlow>;
let finishCollection!: (candidate: SynthesisCandidate) => void;
let finishSend!: (response: SynthesisSendResponse) => void;
setShellApi({ collectSynthesis: () => new Promise<SynthesisCandidate>(resolve => { finishCollection = resolve; }),
  sendSynthesis: () => new Promise<SynthesisSendResponse>(resolve => { finishSend = resolve; }) } as unknown as PolyAskDesktopApi);
const pending = (archiveId: string) => ({ archiveId, targetSite: "claude" as const, targetHost: "claude.ai",
  tier: null, instruction: "Compare", sentAt: 1000 });
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function App() { const [lock] = useState(() => new ExclusiveActionLock()); flow = useSynthesisFlow(lock); return null; }
createRoot(document.getElementById("root")!).render(<App />);
(window as unknown as { resetResult: Promise<unknown> }).resetResult = (async () => {
  while (!flow!) await pause();
  flow.acceptPending(pending("A")); await pause();
  const collection = flow.collect().then(() => "accepted", () => "rejected");
  flow.acceptPending(pending("B")); await pause();
  finishCollection({ host: "claude.ai", text: "ANSWER FOR A", state: null, instruction: "A", createdAt: 1000 });
  const outcome = await collection; await pause();
  if (outcome !== "rejected" || flow.candidate !== null) throw new Error("late A collection must not contaminate B");
  const send = flow.send({ archiveId: "C", targetSite: "claude", tier: null,
    selectedHosts: ["claude.ai", "chatgpt.com"], instruction: "Compare" }, () => {}).then(() => "accepted", () => "rejected");
  flow.acceptPending(null); await pause();
  finishSend({ result: { site: "claude", ok: true }, pending: pending("C") });
  if (await send !== "rejected") throw new Error("reset must invalidate an in-flight send response");
  await pause();
  if (flow.pending !== null || flow.candidate !== null) throw new Error("reset must remain cleared after a late response");
  return { ok: true };
})().catch(error => ({ ok: false, error: String(error) }));
