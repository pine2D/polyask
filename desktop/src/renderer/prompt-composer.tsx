import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import type { DesktopCopy } from "../shared/copy";
import { ChevronDownIcon } from "./icons";
import { commandHint } from "./command-hint";
import { commandKeyAction } from "./keyboard";
import { useComposerEntry } from "./composer-activation";

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
  readonly revealedExpanded?: boolean;
  readonly busy: boolean;
  readonly isMac: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onExpandedChange: (value: boolean) => void;
  readonly onSubmit: () => void;
  readonly onPasteImages: (files: readonly File[]) => void;
}

/** 鼠标点击输入框以外区域时自动收起（保留光标与滚动记忆）；键盘焦点迁移与系统切窗不误收。 */
export function PromptComposer(props: PromptComposerProps): React.JSX.Element {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const takeKeyboardEntry = useComposerEntry(props.promptRef);
  const saved = useRef<ComposerSnapshot | null>(null);
  const pending = useRef<ComposerSnapshot | null>(null);
  const onExpandedChangeRef = useRef(props.onExpandedChange);
  onExpandedChangeRef.current = props.onExpandedChange;
  const revision = props.revision ?? props.text;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
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
  useEffect(() => {
    if (!props.expanded) return;
    const doc = rootRef.current?.ownerDocument;
    if (!doc) return;
    let outsidePress = false;
    let collapseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearCollapseTimer = (): void => {
      if (collapseTimer !== null) { clearTimeout(collapseTimer); collapseTimer = null; }
    };
    const isInside = (target: EventTarget | null): boolean =>
      target instanceof Node && !!rootRef.current?.contains(target);
    const onPointerStart = (event: Event): void => {
      outsidePress = !isInside(event.target);
    };
    const collapseFromOutside = (): void => {
      const area = props.promptRef.current;
      if (area) {
        saved.current = {
          revision: revisionRef.current,
          start: area.selectionStart,
          end: area.selectionEnd,
          direction: area.selectionDirection,
          scroll: area.scrollTop
        };
      }
      onExpandedChangeRef.current(false);
    };
    const onPointerEnd = (): void => {
      if (!outsidePress) return;
      clearCollapseTimer();
      collapseTimer = setTimeout(() => {
        collapseTimer = null;
        if (outsidePress) {
          outsidePress = false;
          collapseFromOutside();
        }
      }, 0);
    };
    const onClick = (event: MouseEvent): void => {
      if (!outsidePress || isInside(event.target)) return;
      outsidePress = false;
      clearCollapseTimer();
      collapseFromOutside();
    };
    doc.addEventListener("mousedown", onPointerStart, true);
    doc.addEventListener("touchstart", onPointerStart, true);
    doc.addEventListener("mouseup", onPointerEnd, true);
    doc.addEventListener("touchend", onPointerEnd, true);
    doc.addEventListener("click", onClick);
    return () => {
      clearCollapseTimer();
      doc.removeEventListener("mousedown", onPointerStart, true);
      doc.removeEventListener("touchstart", onPointerStart, true);
      doc.removeEventListener("mouseup", onPointerEnd, true);
      doc.removeEventListener("touchend", onPointerEnd, true);
      doc.removeEventListener("click", onClick);
    };
  }, [props.expanded]);
  return <div ref={rootRef} className="prompt-composer priority-p0" data-expanded={props.revealedExpanded ?? props.expanded}>
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
          restore(snapshot, event.currentTarget);
          pending.current = snapshot;
        }
        if (takeKeyboardEntry() && !props.expanded) props.onExpandedChange(true);
      }}
      onPointerDown={event => { if (event.button === 0 && !props.expanded) props.onExpandedChange(true); }}
      onClick={() => { if (!props.expanded) props.onExpandedChange(true); }}
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
        else if (action === "collapse" && props.expanded) { event.preventDefault(); props.onExpandedChange(false); }
      }} placeholder={props.copy.promptPlaceholder}
      data-hint={commandHint(props.copy.promptLabel, "focus-prompt", props.isMac)} aria-label={props.copy.promptLabel} />
    <button type="button" data-composer-toggle aria-controls={id} aria-expanded={props.expanded}
      data-hint={props.expanded ? props.copy.composerCollapse : props.copy.composerExpand}
      aria-label={props.expanded ? props.copy.composerCollapse : props.copy.composerExpand}
      onClick={() => props.onExpandedChange(!props.expanded)}><ChevronDownIcon /></button>
  </div>;
}
