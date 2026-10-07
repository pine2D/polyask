import type { DesktopSurface } from '../shared/protocol';

export interface SiteSurfaceEffects {
  detach: () => void;
  cover: (covered: boolean) => void;
  restore: () => void;
}

/** 外壳切换所需视图操作；视图生命周期与布局仍由 ViewManager 管理。 */
export function transitionSiteSurface(previous: DesktopSurface, next: DesktopSurface, effects: SiteSurfaceEffects): void {
  if (previous === next) return;
  const retains = (surface: DesktopSurface) => surface === 'sites' || surface === 'question-history' || surface === 'confirmation';
  if (!retains(next) && retains(previous)) effects.detach();
  effects.cover(next === 'question-history' || next === 'confirmation');
  if (next === 'sites') effects.restore();
}
