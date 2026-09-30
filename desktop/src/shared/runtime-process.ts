// Machine-readable diagnostics contain enums and numbers only, never native names or paths.
export const PROCESS_TYPES = ["GPU", "Utility", "Zygote", "Sandbox helper", "Pepper Plugin", "Pepper Plugin Broker", "Unknown"] as const;
export const PROCESS_FAILURE_REASONS = ["abnormal-exit", "killed", "crashed", "oom", "launch-failed", "integrity-failure", "memory-eviction"] as const;
export interface RuntimeProcessFailure {
  readonly processType: typeof PROCESS_TYPES[number];
  readonly reason: typeof PROCESS_FAILURE_REASONS[number];
  readonly exitCode?: number;
  readonly systemErrorCode?: number;
}

function errorCode(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 4_294_967_295;
}

export function normalizeProcessFailure(value: unknown): RuntimeProcessFailure | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const processType = data.processType ?? data.type;
  if (!PROCESS_TYPES.includes(processType as RuntimeProcessFailure["processType"]) ||
      !PROCESS_FAILURE_REASONS.includes(data.reason as RuntimeProcessFailure["reason"])) return null;
  return { processType: processType as RuntimeProcessFailure["processType"], reason: data.reason as RuntimeProcessFailure["reason"],
    ...(errorCode(data.exitCode) ? { exitCode: data.exitCode } : {}),
    ...(data.reason === "launch-failed" && errorCode(data.systemErrorCode) ? { systemErrorCode: data.systemErrorCode } : {}) };
}
