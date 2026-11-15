import type { WebContents, WebContentsView } from "electron";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type {
  SiteCollectionResult,
  SiteResponseEnvelope,
  SiteResult,
  SiteSubmittedResponse,
  SubmitSiteCommand,
  WasSubmittedSiteCommand
} from "../shared/protocol";
import type { SiteHealth } from "../shared/site-health";
import type { TierPreset, TierPresetAction } from "../shared/tier-presets";
import { SiteCommandChannel } from "./site-command-channel";
import { checkSiteHealth } from "./site-health-check";
import { collectSiteAnswer, confirmSiteSubmitted, sendSiteCommand } from "./site-send-command";
import { collectSiteDomSnapshot, type CollectedSiteSnapshot } from "./site-snapshot-service";
import type { SiteStatusRegistry } from "./site-status-registry";
import { switchSiteTier } from "./site-tier";
import { inspectSitePreset } from "./site-tier-presets";

export interface SiteCommandOperationsDeps {
  readonly getView: (site: SiteKey) => WebContentsView | undefined;
  readonly statuses: SiteStatusRegistry;
  readonly isReloading: (site: SiteKey) => boolean;
  readonly isNavigatingOrReloading: (site: SiteKey) => boolean;
  readonly isBusyForPreset: (site: SiteKey) => boolean;
  readonly replaceView: (definition: SiteDefinition, view: WebContentsView, url: string) => void;
}

export class SiteCommandOperations {
  readonly channel = new SiteCommandChannel();

  constructor(private readonly deps: SiteCommandOperationsDeps) {}

  sendCommand(site: SiteKey, command: SubmitSiteCommand, signal: AbortSignal): Promise<SiteResult> {
    return sendSiteCommand(
      site,
      this.deps.getView(site),
      this.deps.statuses.pageFailureCode(site),
      this.deps.isReloading(site),
      this.channel,
      command,
      signal,
      this.deps.replaceView
    );
  }

  confirmSubmitted(site: SiteKey, command: WasSubmittedSiteCommand, signal: AbortSignal): Promise<SiteSubmittedResponse | null> {
    return confirmSiteSubmitted(this.deps.getView(site), this.channel, command, signal);
  }

  collect(site: SiteKey, deadline: number): Promise<SiteCollectionResult> {
    return collectSiteAnswer(
      site,
      this.deps.getView(site),
      this.deps.statuses.pageFailureCode(site),
      this.deps.isReloading(site),
      this.channel,
      deadline
    );
  }

  switchTier(site: SiteKey, tier: "think" | "fast", deadline: number, preset?: TierPreset): Promise<SiteResult> {
    return switchSiteTier(
      site,
      this.deps.getView(site),
      this.deps.statuses.pageFailureCode(site),
      this.deps.isNavigatingOrReloading(site),
      this.channel,
      tier,
      deadline,
      preset
    );
  }

  inspectPreset(site: SiteKey, action: TierPresetAction, deadline: number) {
    return inspectSitePreset(
      site,
      this.deps.getView(site),
      this.deps.statuses.pageFailureCode(site),
      this.deps.isNavigatingOrReloading(site),
      this.deps.isBusyForPreset(site),
      this.channel,
      action,
      deadline
    );
  }

  checkHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]> {
    return Promise.all(
      sites.map((site) =>
        checkSiteHealth(
          site,
          this.deps.getView(site),
          this.deps.statuses.pageStatus.get(site),
          this.deps.statuses.runStatus.get(site),
          this.channel
        )
      )
    );
  }

  sampleSnapshot(site: SiteKey, appVersion: string): Promise<CollectedSiteSnapshot> {
    return collectSiteDomSnapshot(
      site,
      this.deps.getView(site),
      this.deps.statuses.pageStatus.get(site),
      this.channel,
      appVersion
    );
  }

  receiveResponse(sender: WebContents, envelope: SiteResponseEnvelope): void {
    this.channel.receive(sender, envelope);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
