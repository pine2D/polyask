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
    private readonly notifications: (enabled: boolean) => void,
    // 只置脏标记、不带值（spec §3.4）：proxy-runtime 自己从 proxy-preference-store 读最新输入。
    private readonly proxy: () => void = () => {}) {
    this.lastUi = manager.getUiState();
    repository.seed({ layoutMode: this.lastUi.layoutMode, siteZoom: this.lastUi.siteZoom ?? {} });
    this.applySnapshot();
  }
  snapshot(): PreferenceSnapshot { return this.repository.snapshot(); }
  seed(values: Partial<PreferenceValues>): PreferenceSnapshot {
    if (this.legacySeedEnabled) this.repository.seed(values);
    return this.applySnapshot();
  }
  set(key: PreferenceKey, value: unknown): PreferenceSnapshot { this.repository.set(key, value); return this.applySnapshot(); }
  follow(group: PreferenceGroup, enabled: boolean): PreferenceSnapshot {
    this.repository.setFollowing(group, enabled); return this.applySnapshot();
  }
  setDisplay(value: DisplayPreferences): DisplayPreferences {
    this.repository.set('density', value.density); this.repository.set('siteScale', value.siteScale);
    return this.applySnapshot().values.display;
  }
  setDraftSync(enabled: boolean): PreferenceSnapshot {
    this.drafts.setSyncEnabled(enabled); return this.applySnapshot();
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
  // 外部刷新入口：同步拉取（onWorkspace）、备份恢复（afterApply）、本机重置（reset）。只有它置代理脏标记（spec §3.4）；
  // 通用偏好写入走 applySnapshot，不碰代理——否则每次改布局/密度都会让后台重算占住 OperationGate，群发被拒成 operation_busy。
  refresh(): PreferenceSnapshot { const state = this.applySnapshot(); this.proxy(); return state; }
  private applySnapshot(): PreferenceSnapshot {
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
