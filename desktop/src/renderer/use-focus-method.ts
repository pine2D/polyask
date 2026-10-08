import { useEffect, useState } from "react";

/** A text field is always :focus-visible in Chromium; track focus navigation separately. */
export function useFocusMethod(): "pointer" | "keyboard" {
  const [method, setMethod] = useState<"pointer" | "keyboard">("keyboard");
  useEffect(() => {
    const pointer = () => setMethod("pointer");
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key === "F6" || event.altKey || event.ctrlKey || event.metaKey) setMethod("keyboard");
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  return method;
}
