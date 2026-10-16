import type { DesktopSurface } from '../shared/protocol';
import { requestDecisionNavigation } from './decision-navigation';

export interface SurfaceTransitionEffects {
  surfaceChanged(next: DesktopSurface): void;
  closeHistory(): void;
  closeImages(): void;
  resetComposer(): void;
  closeDrawer(): void;
  commit(next: DesktopSurface): void;
}

/** 确认前不关闭面板、不清输入上下文；保持既有转场的顺序。 */
export function requestSurfaceChange(current: DesktopSurface, next: DesktopSurface, effects: SurfaceTransitionEffects): void {
  const change = () => {
    effects.surfaceChanged(next);
    if (next !== 'sites') {
      effects.closeHistory();
      effects.closeImages();
      if (next !== 'confirmation' && next !== 'question-history') effects.resetComposer();
      effects.closeDrawer();
    }
    effects.commit(next);
  };
  if (current === 'settings' && next !== 'settings') requestDecisionNavigation(change, { kind: 'surface', surface: next });
  else change();
}
