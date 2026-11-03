import type { WorkspaceState } from './workspace';
import type { SiteRunResult } from './protocol';

export interface TierChangeResult {
  readonly workspace: WorkspaceState;
  readonly results: readonly SiteRunResult[];
}
