export interface PopupAnchor {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly align?: "start" | "end";
  readonly keyboard?: boolean;
}

const MAX_COORD = 100_000;

function validCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -10_000 && value <= MAX_COORD;
}

function validExtent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COORD;
}

export function normalizePopupAnchor(value: unknown): PopupAnchor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (!validCoord(candidate.x) || !validCoord(candidate.y)) return undefined;
  return {
    x: candidate.x,
    y: candidate.y,
    width: validExtent(candidate.width) ? candidate.width : undefined,
    height: validExtent(candidate.height) ? candidate.height : undefined,
    align: candidate.align === "end" ? "end" : candidate.align === "start" ? "start" : undefined,
    keyboard: typeof candidate.keyboard === "boolean" ? candidate.keyboard : undefined
  };
}

export function elementPopupAnchor(
  element: Element | null | undefined,
  align: "start" | "end" = "start",
  keyboard = false
): PopupAnchor | undefined {
  if (!element || typeof element.getBoundingClientRect !== "function") return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return undefined;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, align, keyboard };
}
