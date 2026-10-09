import type { DesktopUiState } from '../shared/desktop-ui-state';
import type { DisplayPreferences } from '../shared/display';
import type { PreferenceGroup, PreferenceKey, PreferenceSnapshot, PreferenceValues } from '../shared/preferences';
import type { PreferencesRepository } from './preferences-repository';
import type { DraftRepository } from './draft-repository';
import type { ViewManager } from './view-manager';

export class PreferenceRuntime {
  private applying = false;
  private lastUi: DesktopUiState;
  private appliedLayout: PreferenceValues['layoutMode'] | null = null;
  private legacySeedEnabled = true;
  constructor(readonly repository: PreferencesRepository, readonly drafts: DraftRepository,
    private readonly manager: ViewManager,
    private readonly publish: (value: PreferenceSnapshot) => void,
    private readonly display: (value: DisplayPreferences) => void,
    private readonly notifications: (enabled: boolean) => void) {
    this.lastUi = manager.getUiState();
    repository.seed({ layoutMode: this.lastUi.layoutMode, siteZoom: this.lastUi.siteZoom ?? {} });
    this.refresh();
  }
  snapshot(): PreferenceSnapshot { return this.repository.snapshot(); }
  seed(values: Partial<PreferenceValues>): PreferenceSnapshot {
    if (this.legacySeedEnabled) this.repository.seed(values);
    return this.refresh();
  }
  set(key: PreferenceKey, value: unknown): PreferenceSnapshot { this.repository.set(key, value); return this.refresh(); }
  follow(group: PreferenceGroup, enabled: boolean): PreferenceSnapshot {
    this.repository.setFollowing(group, enabled); return this.refresh();
  }
  setDisplay(value: DisplayPreferences): DisplayPreferences {
    this.repository.set('density', value.density); this.repository.set('siteScale', value.siteScale);
    return this.refresh().values.display;
  }
  setDraftSync(enabled: boolean): PreferenceSnapshot {
    this.drafts.setSyncEnabled(enabled); return this.refresh();
  }
  captureUi(value: DesktopUiState): void {
    if (this.applying) { this.lastUi = value; return; }
    let changed = false;
    for (const [site, zoom] of Object.entries(value.siteZoom ?? {})) {
      if (zoom === this.lastUi.siteZoom?.[site as keyof typeof value.siteZoom]) continue;
      this.repository.set(`siteZoom.${site}` as PreferenceKey, zoom); changed = true;
    }
    this.lastUi = value;
    if (changed) this.publish(this.snapshot());
  }
  refresh(): PreferenceSnapshot {
    const state = this.snapshot();
    this.applying = true;
    try {
      this.notifications(state.values.completionNotifications);
      this.manager.siteZoom.restore(state.values.siteZoom);
      this.display(state.values.display);
      if (this.appliedLayout !== state.values.layoutMode) {
        this.manager.setLayout(state.values.layoutMode, this.manager.getLayout().focused, false);
        this.appliedLayout = state.values.layoutMode;
      }
      this.lastUi = this.manager.getUiState();
    } finally { this.applying = false; }
    this.publish(state);
    return state;
  }
  reset(): void {
    this.legacySeedEnabled = false; this.drafts.invalidate(); this.appliedLayout = null; this.refresh();
  }
}
