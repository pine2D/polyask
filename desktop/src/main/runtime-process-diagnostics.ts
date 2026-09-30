import type { EventEmitter } from "node:events";
import { normalizeProcessFailure, type RuntimeProcessFailure } from "../shared/runtime-process";

export class RuntimeProcessDiagnostics {
  private readonly latest = new Map<RuntimeProcessFailure["processType"], RuntimeProcessFailure>();
  snapshot(): RuntimeProcessFailure[] { return [...this.latest.values()].map(value => ({ ...value })); }
  listen(source: EventEmitter, onFailure: (failure: RuntimeProcessFailure) => void): () => void {
    this.latest.clear();
    const receive = (_event: unknown, details: unknown) => {
      const failure = normalizeProcessFailure(details);
      if (!failure) return;
      this.latest.set(failure.processType, failure);
      onFailure(failure);
    };
    source.on("child-process-gone", receive);
    return () => { source.removeListener("child-process-gone", receive); this.latest.clear(); };
  }
}

export const runtimeProcessDiagnostics = new RuntimeProcessDiagnostics();
