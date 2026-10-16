import { useLayoutEffect, useRef, type RefObject } from "react";

import type { CommandId } from "../shared/commands";
import { MORE_MENU_GROUPS } from "../shared/more-menu";
import { applyToolbarLayout } from './toolbar-layout';

/** 输入框在命令栏里的保底宽度；低于它时逐级收起次要控件，而不是继续挤压输入框。 */
export const MIN_PROMPT_WIDTH = 320;
/** 0 = 完整文字；1 = 图标化；2 = 主操作只留图标；3 = 历史进菜单、档位下拉；4 = 比较/结果库/站点状态让位。 */
export const TOOLBAR_FIT_LEVELS = 5;
/** 第 4 级隐藏的入口改由「更多」菜单承接，键盘仍可经菜单与命令面板到达。 */
export const COMPACT_MORE_COMMANDS: readonly CommandId[] = ["open-archive", "collect-compare"];

/**
 * 依实际内容选择最低的够用级别：逐级套用后量输入框宽度，取第一个不低于保底值的级别。
 * 纯函数式重算（宽度+内容 → 级别），不存在滞回振荡；无布局环境（jsdom）宽度为 0 时保持完整布局。
 */
export function fitToolbar(bar: HTMLElement, minimum = MIN_PROMPT_WIDTH): number {
  const composer = bar.querySelector<HTMLElement>(".prompt-composer");
  if (!composer || bar.getBoundingClientRect().width <= 0) { applyFit(bar, 0); return 0; }
  const root = bar.ownerDocument.documentElement;
  const layout = applyToolbarLayout(root, root.dataset.density === 'comfortable' ? 'comfortable' : 'compact', Math.floor(bar.getBoundingClientRect().width));
  if (layout === 'stacked') { applyFit(bar, TOOLBAR_FIT_LEVELS - 1); return TOOLBAR_FIT_LEVELS - 1; }
  for (let level = 0; level < TOOLBAR_FIT_LEVELS; level++) {
    applyFit(bar, level);
    if (composer.getBoundingClientRect().width >= minimum) return level;
  }
  return TOOLBAR_FIT_LEVELS - 1;
}

/** 级别是累加的：CSS 用 [data-fit~="N"] 表示「至少第 N 级」。 */
function applyFit(bar: HTMLElement, level: number): void {
  bar.dataset.fit = Array.from({ length: level }, (_, index) => index + 1).join(" ");
}

export function toolbarFitLevel(bar: HTMLElement | null | undefined): number {
  return bar?.dataset.fit?.split(" ").filter(Boolean).length ?? 0;
}

/**
 * 挂载、每次渲染（计数/标签/分页变化）与命令栏宽度变化（窗口缩放、外壳缩放）时同步重算。
 * 渲染后先比对宽度与密度签名；只观察命令栏本身，共享高度仅在档位或密度变化时写入。
 * 直接写 data-fit，不经 React 状态，避免二次渲染。
 */
export function useToolbarFit(ref: RefObject<HTMLElement | null>): void {
  const signature = useRef("");
  const refit = (bar: HTMLElement): void => { fitToolbar(bar); signature.current = layoutSignature(bar); };
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => refit(bar));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [ref]);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (bar && layoutSignature(bar) !== signature.current) refit(bar);
  });
}

function layoutSignature(bar: HTMLElement): string {
  return [bar.ownerDocument.documentElement.dataset.density, bar.getBoundingClientRect().width, ...Array.from(bar.children, child =>
    child.classList.contains("prompt-composer") ? child.className : `${child.className}:${child.getBoundingClientRect().width}`)].join("|");
}

/** 命令栏收起归档/比较入口时，「更多」菜单在结果组前补上它们。 */
export function moreMenuGroups(compact: boolean): readonly (readonly CommandId[])[] {
  return compact ? [COMPACT_MORE_COMMANDS, ...MORE_MENU_GROUPS] : MORE_MENU_GROUPS;
}

export function moreMenuCommandIds(root: ParentNode = document): readonly CommandId[] {
  const bar = root.querySelector<HTMLElement>(".command-bar");
  return moreMenuGroups(toolbarFitLevel(bar) >= TOOLBAR_FIT_LEVELS - 1).flat();
}
