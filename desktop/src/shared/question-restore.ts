import type { SiteKey } from "./contracts";
export interface QuestionRestorePreview {
  readonly token: string;
  readonly questionId: string;
  readonly sites: readonly SiteKey[];
  readonly affected: readonly SiteKey[];
  readonly needsConfirmation: boolean;
}
export interface QuestionRestoreResult {
  readonly site: SiteKey;
  readonly state: "opened" | "already_open" | "missing_url" | "failed" | "timeout" | "cancelled";
}
