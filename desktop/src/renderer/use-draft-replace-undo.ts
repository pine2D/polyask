import { useRef } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { useGlobalFeedback } from './feedback-provider';

/**
 * 模板/最近提问直接替换草稿，底栏随替换通知给一次「撤销」（通知消失或被新通知覆盖即失效）。
 * 替换后草稿又被改过就不回滚：撤销不能吞掉用户的新输入。
 */
export function useDraftReplaceUndo(copy: DesktopCopy, text: string, setText: (value: string) => void, focus: () => void) {
  const { announce, setNoticeAction } = useGlobalFeedback();
  const latest = useRef(text); latest.current = text;
  return (value: string): void => {
    const previous = latest.current;
    setText(value); latest.current = value;
    focus();
    if (!previous.trim() || previous === value) return;
    announce(copy.draftReplaced, true, true);
    setNoticeAction({ label: copy.undoDraftReplace, run: () => {
      setNoticeAction(null);
      if (latest.current !== value) { announce(copy.draftReplaceUndoStale, true, true); return; }
      setText(previous); latest.current = previous;
      focus();
      announce(copy.draftReplaceUndone, true, true);
    } });
  };
}
