import { useRef, useState } from "react";

import { formatCopy, type DesktopCopy } from "../shared/copy";
import { validateImageFiles, type DesktopImage, type ImageInputError } from "../shared/images";
import { readDesktopImages } from "./image-picker";
import { usePresence } from "./presence";
import { PANEL_EXIT_MS } from "./motion";

function errorCopy(copy: DesktopCopy, code: ImageInputError): string {
  return {
    image_count: copy.imageCountError,
    image_type: copy.imageTypeError,
    image_size: copy.imageSizeError,
    image_invalid: copy.imageInvalid
  }[code];
}

// 群发进行中粘贴/拖入图片时的拒收提示；idle=false 时不应静默丢弃这次输入。
export function imageSelectionBlockedMessage(copy: DesktopCopy, idle: boolean): string | null {
  return idle ? null : copy.imagesBusy;
}

export function useImageSelection(
  copy: DesktopCopy,
  idle: boolean,
  announce: (value: string) => void
): {
  readonly beginPick: () => number;
  readonly intent: () => number;
  readonly replace: (images: readonly DesktopImage[]) => void;
  readonly images: readonly DesktopImage[];
  readonly error: string | null;
  readonly open: boolean;
  readonly present: boolean;
  readonly setOpen: (value: boolean) => void;
  readonly choose: (files: readonly File[], mode?: "append" | "replace") => Promise<void>;
  readonly remove: (index: number) => void;
  readonly clear: () => void;
  readonly invalidateAndClose: () => void;
  readonly prepareSend: () => { images: readonly DesktopImage[]; clearSent: () => void };
} {
  const epoch = useRef(0);
  const selectionIntent = useRef(0);
  const revision = useRef(0);
  const currentImages = useRef<readonly DesktopImage[]>([]);
  const pendingRead = useRef<Promise<void>>(Promise.resolve());
  const [images, setImages] = useState<readonly DesktopImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const present = usePresence(open && images.length > 0, PANEL_EXIT_MS);
  const choose = async (files: readonly File[], mode: "append" | "replace" = "replace") => {
    const blocked = imageSelectionBlockedMessage(copy, idle);
    if (blocked) { announce(blocked); return; }
    selectionIntent.current += 1;
    const request = mode === "replace" ? ++epoch.current : epoch.current;
    const read = async () => {
      if (request !== epoch.current) return;
      const previous = mode === "append" ? currentImages.current : [];
      const metadataError = validateImageFiles([...previous, ...files]);
      const result = metadataError ? { ok: false as const, code: metadataError } : await readDesktopImages(files);
      if (request !== epoch.current) return;
      // 读取期间旧批次可能已确认发送；追加时以此刻的图片为准，避免重新带回已发图片。
      const next = result.ok ? [...(mode === "append" ? currentImages.current : []), ...result.images] : [];
      const code = result.ok ? validateImageFiles(next) : result.code;
      if (code) {
        const message = errorCopy(copy, code);
        setError(message);
        announce(message);
        return;
      }
      revision.current += 1;
      selectionIntent.current += 1;
      currentImages.current = next;
      setImages(next);
      setError(null);
      setOpen(false);
      announce(formatCopy(copy.imagesReady, { count: next.length }));
    };
    // 连续粘贴按顺序追加；显式替换、删除或清空仍可取消正在读取的批次。
    pendingRead.current = mode === "append" ? pendingRead.current.then(read) : read();
    await pendingRead.current;
  };
  const remove = (index: number) => {
    selectionIntent.current += 1;
    revision.current += 1;
    epoch.current += 1;
    const next = currentImages.current.filter((_image, current) => current !== index);
    currentImages.current = next;
    setImages(next);
    setError(null);
    if (!next.length) setOpen(false);
    announce(formatCopy(copy.imagesReady, { count: next.length }));
  };
  const invalidateAndClose = () => {
    selectionIntent.current += 1;
    epoch.current += 1;
    setOpen(false);
  };
  const clearImages = () => { revision.current++; currentImages.current = []; setImages([]); setError(null); setOpen(false); };
  const clear = () => { invalidateAndClose(); clearImages(); };
  const beginPick = () => { epoch.current++; return ++selectionIntent.current; };
  const replace = (next: readonly DesktopImage[]) => {
    revision.current++; invalidateAndClose(); currentImages.current = [...next]; setImages(currentImages.current); setError(null);
  };
  const prepareSend = () => {
    invalidateAndClose();
    const sentRevision = revision.current;
    // 只清本轮未改动的批次；保留较新的选图读取/文件框，取消或无效新图也不能留下已发旧图。
    return { images: currentImages.current, clearSent: () => { if (revision.current === sentRevision) clearImages(); } };
  };
  return { beginPick, intent: () => selectionIntent.current, replace, images, error, open, present, setOpen, choose, remove, clear, invalidateAndClose, prepareSend };
}
