import { shellHeightForComposer, toolbarLayoutForWidth, type Density, type ToolbarLayout } from '../shared/display';

export interface ToolbarLayoutTarget {
  readonly dataset: { density?: string; toolbarLayout?: ToolbarLayout };
  readonly style?: { setProperty(name: string, value: string): void };
}

const applied = new WeakMap<ToolbarLayoutTarget, string>();

/** 与主进程按同一逻辑宽度计算；高度只在档位或密度变化时写入。 */
export function applyToolbarLayout(target: ToolbarLayoutTarget, density: Density, width: number): ToolbarLayout {
  const layout = toolbarLayoutForWidth(width), signature = `${density}:${layout}`;
  if (applied.get(target) === signature) return layout;
  target.dataset.toolbarLayout = layout;
  target.style?.setProperty('--shell-height', `${shellHeightForComposer(density, false, layout)}px`);
  target.style?.setProperty('--composer-expanded-height', `${shellHeightForComposer(density, true, layout)}px`);
  target.style?.setProperty('--composer-field-expanded-height', `${shellHeightForComposer(density, true)}px`);
  applied.set(target, signature);
  return layout;
}
