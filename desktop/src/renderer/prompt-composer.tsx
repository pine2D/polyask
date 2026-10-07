import { useId, useLayoutEffect, useRef, type RefObject } from "react";
import type { DesktopCopy } from "../shared/copy";
import { ChevronDownIcon } from "./icons";
import { commandHint } from "./command-hint";
import { commandKeyAction } from "./keyboard";

interface ComposerSnapshot {
  readonly revision: string | number;
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
  readonly scroll: number;
}
interface PromptComposerProps {
  readonly copy: DesktopCopy;
  readonly promptRef: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly revision?: number;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly isMac: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onExpandedChange: (value: boolean) => void;
  readonly onSubmit: () => void;
  readonly onPasteImages: (files: readonly File[]) => void;
}

/** 原生文件框、档位与附件只移焦点；展开由明确动作和表面会话控制。 */
export function PromptComposer(props: PromptComposerProps): React.JSX.Element {
  const id = useId();
  const saved = useRef<ComposerSnapshot | null>(null);
  const pending = useRef<ComposerSnapshot | null>(null);
  const revision = props.revision ?? props.text;
  const restore = (snapshot: ComposerSnapshot, area: HTMLTextAreaElement): void => {
    area.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
    area.scrollTop = snapshot.scroll;
  };
  useLayoutEffect(() => {
    const snapshot = pending.current;
    pending.current = null;
    const area = props.promptRef.current;
    if (snapshot?.revision === revision && area && document.activeElement === area) restore(snapshot, area);
  });
  return <div className="prompt-composer priority-p0">
    <textarea id={id} name="prompt" autoComplete="off" ref={props.promptRef} rows={1}
      value={props.text} onChange={event => props.onTextChange(event.target.value)}
      onPaste={event => {
        const files = [...event.clipboardData.files].filter(file => file.type.startsWith("image/"));
        if (files.length) props.onPasteImages(files);
      }}
      onDragOver={event => {
        if ([...event.dataTransfer.items].some(item => item.kind === "file" && item.type.startsWith("image/"))) event.preventDefault();
      }}
      onDrop={event => {
        const files = [...event.dataTransfer.files].filter(file => file.type.startsWith("image/"));
        if (files.length) { event.preventDefault(); props.onPasteImages(files); }
      }}
      onFocus={event => {
        const snapshot = saved.current;
        if (snapshot?.revision === revision) {
          if (props.expanded) restore(snapshot, event.currentTarget);
          else pending.current = snapshot;
        }
        if (!props.expanded) props.onExpandedChange(true);
      }}
      onBlur={event => {
        const area = event.currentTarget;
        saved.current = { revision, start: area.selectionStart, end: area.selectionEnd,
          direction: area.selectionDirection, scroll: area.scrollTop };
      }}
      onKeyDown={event => {
        const action = commandKeyAction({ key: event.key, ctrlKey: event.ctrlKey,
          metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing,
          keyCode: event.nativeEvent.keyCode }, props.busy);
        if (action === "submit") { event.preventDefault(); props.onSubmit(); }
        else if (action === "collapse") { event.preventDefault(); props.onExpandedChange(false); }
      }} placeholder={props.copy.promptPlaceholder}
      data-hint={commandHint(props.copy.promptLabel, "focus-prompt", props.isMac)} aria-label={props.copy.promptLabel} />
    <button type="button" data-composer-toggle aria-controls={id} aria-expanded={props.expanded}
      data-hint={props.expanded ? props.copy.composerCollapse : props.copy.composerExpand}
      aria-label={props.expanded ? props.copy.composerCollapse : props.copy.composerExpand}
      onClick={() => props.onExpandedChange(!props.expanded)}><ChevronDownIcon /></button>
  </div>;
}
