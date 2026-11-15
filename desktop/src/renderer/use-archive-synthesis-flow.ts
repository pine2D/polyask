import { useCallback, useState } from "react";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { DesktopSurface } from "../shared/protocol";
import { archiveCollectionActions } from "./archive-collection-actions";
import type { ExclusiveActionLock } from "./broadcast-flow-state";
import type { CommandActions } from "./command-dispatcher";
import { createComparisonDraftStore } from "./comparison-draft-store";
import { createLibrarySessionStore } from "./library-session";
import { useArchiveCapture } from "./use-archive-capture";
import { useArchiveNavigation } from "./use-archive-navigation";
import { useSynthesisFlow } from "./use-synthesis-flow";
import { useSynthesisRecovery } from "./use-synthesis-recovery";

export interface UseArchiveSynthesisFlowOptions {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly participating: ReadonlySet<SiteKey>;
  readonly prompt: string;
  readonly actionLock: ExclusiveActionLock;
  readonly commandActions: { current: CommandActions };
  readonly onPrepareSynthesisTarget: () => void;
  readonly onChangeSurface: (surface: DesktopSurface) => void;
}

export function useArchiveSynthesisFlow(options: UseArchiveSynthesisFlowOptions) {
  const {
    copy,
    sites,
    participating,
    prompt,
    actionLock,
    commandActions,
    onPrepareSynthesisTarget,
    onChangeSurface
  } = options;
  const [comparisonDrafts] = useState(createComparisonDraftStore);
  const [librarySession] = useState(createLibrarySessionStore);
  const [libraryBlocking, setLibraryBlocking] = useState(false);
  const blockLibrary = useCallback((value: boolean) => {
    if (value) commandActions.current = {};
    setLibraryBlocking(value);
  }, [commandActions]);
  const archiveNavigation = useArchiveNavigation();
  const synthesis = useSynthesisFlow(actionLock);
  const archiveCapture = useArchiveCapture({ sites, selected: participating, prompt });
  const synthesisRecovery = useSynthesisRecovery(
    copy,
    synthesis,
    onPrepareSynthesisTarget,
    () => {
      archiveNavigation.clear();
      onChangeSurface("archive");
    }
  );

  const createCollectionActions = (
    runAuxiliary: (action: () => Promise<void>) => Promise<void>,
    announce: (text: string) => void
  ) => archiveCollectionActions({
    copy,
    capture: archiveCapture,
    synthesis,
    runAuxiliary,
    announce,
    openArchive: (id, mode) => {
      if (id && mode === "read") archiveNavigation.history(id, "read");
      else archiveNavigation.collection(id);
      onChangeSurface("archive");
    }
  });

  const openFromHistory = (recordId: string, mode: "read" | "compare"): void => {
    archiveNavigation.history(recordId, mode);
    onChangeSurface("archive");
  };

  const resetStores = (): void => {
    comparisonDrafts.clear();
    librarySession.clear();
    synthesisRecovery.clear();
    archiveNavigation.clear();
  };

  return {
    comparisonDrafts,
    librarySession,
    libraryBlocking,
    blockLibrary,
    archiveNavigation,
    synthesis,
    archiveCapture,
    synthesisRecovery,
    createCollectionActions,
    openFromHistory,
    resetStores
  };
}
