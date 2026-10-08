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
  readonly images: readonly DesktopImage[];
  readonly error: string | null;
  readonly open: boolean;
  readonly present: boolean;
  readonly setOpen: (value: boolean) => void;
  readonly choose: (files: readonly File[], mode?: "append" | "replace") => Promise<void>;
  readonly remove: (index: number) => void;
  readonly clear: () => void;
  readonly invalidateAndClose: () => void;
} {
  const epoch = useRef(0);
  const currentImages = useRef<readonly DesktopImage[]>([]);
  const pendingRead = useRef<Promise<void>>(Promise.resolve());
  const [images, setImages] = useState<readonly DesktopImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const present = usePresence(open && images.length > 0, PANEL_EXIT_MS);
  const choose = async (files: readonly File[], mode: "append" | "replace" = "replace") => {
    const blocked = imageSelectionBlockedMessage(copy, idle);
    if (blocked) { announce(blocked); return; }
    const request = mode === "replace" ? ++epoch.current : epoch.current;
    const read = async () => {
      if (request !== epoch.current) return;
      const previous = mode === "append" ? currentImages.current : [];
      const metadataError = validateImageFiles([...previous, ...files]);
      const result = metadataError ? { ok: false as const, code: metadataError } : await readDesktopImages(files);
      if (request !== epoch.current) return;
      if (!result.ok) {
        const message = errorCopy(copy, result.code);
        setError(message);
        announce(message);
        return;
      }
      const next = [...previous, ...result.images];
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
    epoch.current += 1;
    const next = currentImages.current.filter((_image, current) => current !== index);
    currentImages.current = next;
    setImages(next);
    setError(null);
    if (!next.length) setOpen(false);
    announce(formatCopy(copy.imagesReady, { count: next.length }));
  };
  const invalidateAndClose = () => {
    epoch.current += 1;
    setOpen(false);
  };
  const clear = () => { invalidateAndClose(); currentImages.current = []; setImages([]); setError(null); };
  return { images, error, open, present, setOpen, choose, remove, clear, invalidateAndClose };
}
