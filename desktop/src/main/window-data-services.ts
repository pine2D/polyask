import type { DisplayPreferences } from '../shared/display';
import type { DesktopDatabase } from './database';
import type { ViewManager } from './view-manager';
import type { WorkspaceService } from './workspace-service';
import type { BroadcastCoordinator } from './broadcast';
import { createLocalDataServices } from './local-data-services';
import { CollectionService } from './collection-service';
import { DataAdminService } from './data-admin-service';
import { PreferencesRepository } from './preferences-repository';
import { DraftRepository } from './draft-repository';
import { PreferenceRuntime } from './preference-runtime';
import { createSyncRuntime } from './sync-runtime';
import { SynthesisService } from './synthesis-service';
import { sendTrackedSynthesis } from './synthesis-generation';
import { SITES } from './sites';

export async function createWindowDataServices(options: {
  readonly database: DesktopDatabase; readonly manager: ViewManager; readonly workspace: WorkspaceService;
  readonly coordinator: BroadcastCoordinator; readonly synthesisCoordinator: BroadcastCoordinator;
  readonly publish: (channel: string, payload?: unknown) => void;
  readonly applyDisplay: (value: DisplayPreferences) => void;
  readonly setNotifications: (enabled: boolean) => void;
}) {
  const { database, manager, workspace, coordinator, synthesisCoordinator, publish } = options;
  const local = createLocalDataServices(database);
  const collection = new CollectionService(SITES, (site, deadline) => manager.collect(site, deadline));
  const preferences = new PreferenceRuntime(new PreferencesRepository(database.state, database.meta),
    new DraftRepository(database.state, database.meta), manager,
    state => publish('polyask:preferences-changed', state), options.applyDisplay, options.setNotifications);
  const synthesis = new SynthesisService({
    sites: SITES, archives: local.archives,
    navigate: (site, url) => manager.navigate(site, url),
    send: request => sendTrackedSynthesis(request, manager, synthesisCoordinator, 44_000),
    onPendingChange: () => manager.releaseUnselectedViews(),
    collect: (sites, runId) => collection.collect(sites, runId),
    targetAvailable: site => workspace.getState().selectedSites.includes(site),
    beforeSend: () => collection.clearRun(),
    showTarget: site => { manager.setSurface('sites'); manager.setLayout('focus', site); },
    recordHistory: text => local.history.record(text)
  });
  const sync = await createSyncRuntime({ database, workspace: () => workspace.getState(),
    onStatus: state => publish('polyask:sync-status', state),
    onWorkspace: state => {
      manager.setSelection(state.selectedSites);
      publish('polyask:workspace-state', state); publish('polyask:prompt-library', local.promptLibrary.getState());
      preferences.refresh(); publish('polyask:drafts-changed');
    }
  });
  const dataAdmin = new DataAdminService({ database, deviceId: local.deviceId, sync,
    beforeDisconnect: () => { coordinator.cancel(); synthesisCoordinator.cancel(); },
    beforeWipe: () => { preferences.drafts.invalidate(); collection.clearRun(); synthesis.reset(); manager.resetRunStatus(); }
  });
  return { ...local, collection, preferences, synthesis, sync, dataAdmin };
}
