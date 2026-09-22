import { useEffect, useState } from "react";

// The reserved feedback strip stays visible above native site views.
export function useControlHint(id: string, noticeSequence = 0): string {
  const [hint, setHint] = useState("");
  useEffect(() => {
    setHint("");
    let pointer: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    let active: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const target = (value: EventTarget | null): HTMLElement | null => value instanceof Element
      ? value.closest<HTMLElement>("[data-hint]") : null;
    const removeDescription = () => {
      if (!active) return;
      const ids = (active.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(value => value && value !== id);
      if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
      else active.removeAttribute("aria-describedby");
    };
    const addDescription = (element: HTMLElement) => {
      const ids = new Set((element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
      if (ids.has(id)) return;
      ids.add(id);
      element.setAttribute("aria-describedby", [...ids].join(" "));
    };
    const clear = () => {
      clearTimeout(timer);
      removeDescription();
      active = null;
      setHint("");
    };
    const show = (element: HTMLElement | null, immediate: boolean) => {
      clear();
      if (!element) return;
      const display = () => {
        if (!element.isConnected) return;
        const text = element.dataset.hint;
        if (!text) return;
        active = element;
        addDescription(element);
        setHint(text);
      };
      if (immediate) display();
      else timer = setTimeout(display, 350);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const next = target(event.target);
      if (next === pointer) return;
      pointer = next;
      show(pointer ?? focused, !pointer);
    };
    const out = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && pointer?.contains(event.relatedTarget)) return;
      pointer = null;
      show(focused, true);
    };
    const focus = (event: FocusEvent) => { focused = target(event.target); show(focused, true); };
    const blur = () => { focused = null; show(pointer, false); };
    const dismiss = () => { pointer = focused = null; clear(); };
    const key = (event: KeyboardEvent) => { if (!["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) dismiss(); };
    const observer = new MutationObserver(() => {
      if (active && (!active.isConnected || !active.dataset.hint)) dismiss();
      else if (active) { addDescription(active); setHint(active.dataset.hint ?? ""); }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-hint", "aria-describedby"] });
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("click", dismiss, true);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", dismiss);
    return () => {
      clearTimeout(timer); removeDescription(); observer.disconnect();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", dismiss);
    };
  }, [id, noticeSequence]);
  return hint;
}
