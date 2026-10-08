import { useEffect, useRef, type RefObject } from 'react';

/** Tab 的一次导航意图不能沿用到系统恢复焦点或后续程序性 focus。 */
export function useComposerEntry(promptRef: RefObject<HTMLTextAreaElement | null>): () => boolean {
  const tab = useRef<KeyboardEvent | null>(null);
  useEffect(() => {
    const clear = () => { tab.current = null; };
    const keydown = (event: KeyboardEvent) => {
      tab.current = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey
        && !event.isComposing && event.keyCode !== 229 ? event : null;
    };
    const focus = (event: FocusEvent) => { if (event.target !== promptRef.current) clear(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', clear, true);
    document.addEventListener('pointerdown', clear, true);
    document.addEventListener('focusin', focus, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('keyup', clear, true);
      document.removeEventListener('pointerdown', clear, true);
      document.removeEventListener('focusin', focus, true);
      window.removeEventListener('blur', clear);
    };
  }, [promptRef]);
  return () => {
    const event = tab.current; tab.current = null;
    return event !== null && !event.defaultPrevented;
  };
}

/** 快捷键、模板与历史回填即使已聚焦，也明确开始编辑。 */
export function focusPromptForEditing(promptRef: RefObject<HTMLTextAreaElement | null>, expand: (value: boolean) => void): void {
  expand(true);
  queueMicrotask(() => promptRef.current?.focus());
}

/** 对话框已恢复到存活控件时保留它，否则回到稳定的工作台入口。 */
export function restoreWorkbenchFocus(): void {
  queueMicrotask(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body && !focused.closest('.confirm-scrim')) return;
    document.querySelector<HTMLButtonElement>('.scope-main')?.focus();
  });
}
