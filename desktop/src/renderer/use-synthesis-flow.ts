import { useState } from "react";

import type { ArchiveRecord } from "../shared/archive";
import type {
  PendingSynthesis,
  SynthesisCandidate,
  SynthesisSendRequest
} from "../shared/synthesis";
import type { ExclusiveActionLock } from "./broadcast-flow-state";
import type { RunState } from "./command-bar";
import { shell } from "./shell-api";

export function useSynthesisFlow(lock: ExclusiveActionLock): {
  readonly runState: RunState;
  readonly cancel: () => void;
  readonly pending: PendingSynthesis | null;
  readonly candidate: SynthesisCandidate | null;
  readonly acceptPending: (value: PendingSynthesis | null) => void;
  readonly send: (request: SynthesisSendRequest, beforeSend: () => void) => Promise<PendingSynthesis>;
  readonly collect: () => Promise<string>;
  readonly save: (replaceExisting: boolean) => Promise<ArchiveRecord>;
} {
  const [runState, setRunState] = useState<RunState>("idle");
  const [pending, setPending] = useState<PendingSynthesis | null>(null);
  const [candidate, setCandidate] = useState<SynthesisCandidate | null>(null);
  const acceptPending = (value: PendingSynthesis | null) => {
    setPending(value);
    if (!value) setCandidate(null);
  };
  const send = async (request: SynthesisSendRequest, beforeSend: () => void): Promise<PendingSynthesis> => {
    const result = await lock.run(async () => {
      setRunState("sending");
      try {
        beforeSend();
        const response = await shell.sendSynthesis(request);
        if (!response.result.ok || !response.pending) throw new Error(response.result.code || "synthesis_send_failed");
        setPending(response.pending);
        setCandidate(null);
        return response.pending;
      } finally { setRunState("idle"); }
    });
    if (!result) throw new Error("operation_busy");
    return result;
  };
  const cancel = (): void => { setRunState("cancelling"); shell.cancel(); };
  const collect = async (): Promise<string> => {
    if (!pending) throw new Error("synthesis_not_pending");
    setCandidate(await shell.collectSynthesis());
    return pending.archiveId;
  };
  const save = async (replaceExisting: boolean): Promise<ArchiveRecord> => {
    const record = await shell.saveSynthesis(replaceExisting);
    setPending(null);
    setCandidate(null);
    return record;
  };
  return { pending, candidate, acceptPending, send, collect, save, runState, cancel };
}
