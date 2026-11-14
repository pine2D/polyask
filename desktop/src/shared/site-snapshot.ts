import { SITE_KEYS, type SiteKey } from "./contracts";
import type { SiteCheckKind, SiteDiagnosticCheck } from "./site-health";
import {
  attrValueOk,
  DROP_TAGS,
  EMPTY_TAGS,
  EXPECT_ATTR,
  findSensitive,
  isFillerText,
  isPromptText,
  isSafeDataAttr,
  isSanitizedRoute,
  KEEP_ATTRS,
  PROSE_NO_ID_TAGS,
  PROMPT_TOKEN,
  VOID_TAGS,
  type DomFixtureStats
} from "../../scripts/lib/dom-fixture-sanitize";

export const SITE_SNAPSHOT_SCHEMA = 1;
export const SITE_SNAPSHOT_KIND = "polyask-site-dom-snapshot";
export const MAX_SNAPSHOT_NODES = 20_000;
export const MAX_SNAPSHOT_HTML_CHARS = 2_000_000;

export const SITE_SNAPSHOT_ERROR_CODES = [
  "snapshot_privacy_blocked",
  "snapshot_too_large",
  "snapshot_failed"
] as const;
export type SiteSnapshotErrorCode = (typeof SITE_SNAPSHOT_ERROR_CODES)[number];

export type SiteSnapshotSamplingMode = "full-main" | "targeted" | "body-controls";

export interface SiteDomFixtureExpect {
  readonly userCount: number;
  readonly userText: string | null;
  readonly answer: boolean;
  readonly answerRoot?: boolean;
  readonly locate?: "selector" | "semantic" | "anchor";
}

export interface SiteDomFixtureMeta {
  readonly schema: 1;
  readonly host: string;
  readonly path: string;
  readonly promptToken: string;
  readonly source: "captured" | "synthetic";
  readonly capturedAt?: string;
  readonly note?: string;
  readonly expect: SiteDomFixtureExpect;
  readonly stats: DomFixtureStats;
}

export interface SiteSnapshotViewport {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

/** 站点隔离上下文产出的预校验载荷（主进程补齐受管站点、版本与缩放比例后再次复核）。 */
export interface SiteDomSnapshotSample {
  readonly ok: boolean;
  readonly code?: SiteSnapshotErrorCode | "not_ready" | "adapter_unavailable";
  readonly path?: string;
  readonly capturedAt?: string;
  readonly viewport?: SiteSnapshotViewport;
  readonly diagnostics?: readonly SiteDiagnosticCheck[];
  readonly sampling?: SiteSnapshotSamplingMode;
  readonly fixture?: Omit<SiteDomFixtureMeta, "host">;
  readonly html?: string;
}

export interface SiteDomSnapshotFile {
  readonly schema: typeof SITE_SNAPSHOT_SCHEMA;
  readonly kind: typeof SITE_SNAPSHOT_KIND;
  readonly site: SiteKey;
  readonly host: string;
  readonly path: string;
  readonly capturedAt: string;
  readonly appVersion: string;
  readonly viewport: SiteSnapshotViewport;
  readonly zoomFactor: number;
  readonly diagnostics: readonly SiteDiagnosticCheck[];
  readonly sampling: SiteSnapshotSamplingMode;
  readonly fixture: SiteDomFixtureMeta;
  readonly html: string;
}

export type SiteSnapshotExportResult =
  | { readonly status: "exported"; readonly filePath: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly code: SiteSnapshotErrorCode | "no_view" | "not_ready" | "timeout" };

const CHECK_KINDS = new Set<SiteCheckKind>(["reach", "control", "tier", "probe", "capture"]);
const SAMPLING_MODES = new Set<SiteSnapshotSamplingMode>(["full-main", "targeted", "body-controls"]);
const SNAPSHOT_KEYS = new Set([
  "schema", "kind", "site", "host", "path", "capturedAt", "appVersion",
  "viewport", "zoomFactor", "diagnostics", "sampling", "fixture", "html"
]);
const FIXTURE_KEYS = new Set(["schema", "host", "path", "promptToken", "source", "capturedAt", "note", "expect", "stats"]);
const EXPECT_KEYS = new Set(["userCount", "userText", "answer", "answerRoot", "locate"]);
const STAT_KEYS = new Set(["elements", "texts", "promptHits", "droppedElements", "droppedAttrs", "truncated", "marked"]);

function decodeEntities(raw: string): { readonly ok: boolean; readonly value: string } {
  let invalid = false;
  const value = raw.replace(
    /&(?:#(\d{1,7});|#x([0-9a-fA-F]{1,6});|([A-Za-z][A-Za-z0-9]{1,15});|([#A-Za-z0-9]+;?))/g,
    (_m, dec, hex, named) => {
      if (dec !== undefined || hex !== undefined) {
        const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
        if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          invalid = true;
          return "";
        }
        return String.fromCodePoint(code);
      }
      if (named === "amp") return "&";
      if (named === "lt") return "<";
      if (named === "gt") return ">";
      if (named === "quot") return '"';
      if (named === "apos") return "'";
      invalid = true;
      return "";
    }
  );
  return { ok: !invalid, value };
}

export function verifySanitizedHtml(html: string, promptToken: string): {
  readonly problems: string[];
  readonly elements: number;
} {
  const problems = findSensitive(html).map((name) => `sensitive:${name}`);
  if (typeof html !== "string" || !html.trim()) return { problems: [...problems, "html:empty"], elements: 0 };
  if (html.length > MAX_SNAPSHOT_HTML_CHARS) return { problems: [...problems, "html:too_large"], elements: 0 };
  if (html.includes("<!--") || /<![A-Za-z?\[]|<\?/.test(html)) problems.push("comment");

  const tokenRe = /<\/([a-z][a-z0-9-]*)>|<([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9_.:-]*(?:="[^"]*")?)*)>|([^<>]+)/g;
  const attrRe = /\s+([a-z][a-z0-9_.:-]*)(?:="([^"]*)")?/g;
  const stack: string[] = [];
  let cursor = 0;
  let elements = 0;

  for (const match of html.matchAll(tokenRe)) {
    if (match.index !== cursor) { problems.push("html:malformed"); break; }
    cursor += match[0].length;
    const [, closeTag, openTag, rawAttrs = "", rawText] = match;

    if (rawText !== undefined) {
      const parentTag = stack[stack.length - 1] ?? "";
      if (EMPTY_TAGS.includes(parentTag) && rawText.length > 0) problems.push(`element:${parentTag}:children`);
      if (stack.includes("svg")) { problems.push("element:svg_descendant"); continue; }
      const decoded = decodeEntities(rawText);
      if (!decoded.ok) { problems.push("text:invalid_entity"); continue; }
      if (findSensitive(decoded.value).length) problems.push("text:sensitive");
      const trimmed = decoded.value.trim();
      if (trimmed && !(/^[a-z]+(?: [a-z]+)*$/.test(trimmed) && isFillerText(trimmed)) && !isPromptText(trimmed, promptToken)) {
        problems.push("text:not_placeholder");
      }
      continue;
    }

    if (closeTag !== undefined) {
      if (VOID_TAGS.includes(closeTag) || stack[stack.length - 1] !== closeTag) problems.push(`html:unexpected_close:${closeTag}`);
      else stack.pop();
      continue;
    }

    elements += 1;
    if (elements > MAX_SNAPSHOT_NODES) { problems.push("html:max_nodes"); break; }
    if (DROP_TAGS.includes(openTag)) problems.push(`element:${openTag}`);
    const parentTag = stack[stack.length - 1] ?? "";
    if (EMPTY_TAGS.includes(parentTag)) problems.push(`element:${parentTag}:children`);
    if (stack.includes("svg")) problems.push("element:svg_descendant");

    const seenAttrs = new Set<string>();
    let attrCursor = 0;
    for (const attrMatch of rawAttrs.matchAll(attrRe)) {
      if (attrMatch.index !== attrCursor) { problems.push("attr:malformed"); break; }
      attrCursor += attrMatch[0].length;
      const attrName = attrMatch[1];
      const attrRaw = attrMatch[2] ?? "";
      if (seenAttrs.has(attrName)) problems.push(`attr:duplicate:${attrName}`);
      seenAttrs.add(attrName);
      const known = KEEP_ATTRS.includes(attrName) || attrName === "aria-label" || attrName === EXPECT_ATTR || isSafeDataAttr(attrName);
      if (!known) { problems.push(`attr:${attrName}`); continue; }
      const decoded = decodeEntities(attrRaw);
      if (!decoded.ok) { problems.push(`attr_entity:${attrName}`); continue; }
      if ((attrName === "id" && PROSE_NO_ID_TAGS.includes(openTag)) || !attrValueOk(attrName, decoded.value)) problems.push(`attr_value:${attrName}`);
      if (findSensitive(decoded.value).length) problems.push(`attr_sensitive:${attrName}`);
    }
    if (attrCursor !== rawAttrs.length) problems.push("attr:malformed");
    if (!VOID_TAGS.includes(openTag)) stack.push(openTag);
  }

  if (cursor !== html.length || stack.length > 0) problems.push("html:malformed");
  return { problems: [...new Set(problems)], elements };
}

export function verifyFixtureMeta(meta: unknown, expectedHost?: string): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return ["fixture:not_object"];
  const row = meta as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(row)) if (!FIXTURE_KEYS.has(key)) problems.push(`fixture:key:${key}`);
  if (row.schema !== 1) problems.push("fixture:schema");
  if (typeof row.host !== "string" || !row.host || (expectedHost && row.host !== expectedHost)) problems.push("fixture:host");
  if (!isSanitizedRoute(row.path)) problems.push("fixture:path");
  if (typeof row.promptToken !== "string" || !PROMPT_TOKEN.test(row.promptToken)) problems.push("fixture:promptToken");
  if (row.source !== "captured" && row.source !== "synthetic") problems.push("fixture:source");
  if (row.capturedAt !== undefined && (typeof row.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.capturedAt))) {
    problems.push("fixture:capturedAt");
  }
  if (row.note !== undefined && (typeof row.note !== "string" || row.note.length > 200 || /[^\x20-\x7e]/.test(row.note))) {
    problems.push("fixture:note");
  }
  const expect = row.expect as Record<string, unknown> | undefined;
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) problems.push("fixture:expect");
  else {
    for (const key of Object.keys(expect)) if (!EXPECT_KEYS.has(key)) problems.push(`fixture:expect:${key}`);
    if (!Number.isSafeInteger(expect.userCount) || (expect.userCount as number) < 0) problems.push("fixture:expect:userCount");
    if (expect.userText !== null && (typeof expect.userText !== "string" || !isPromptText(expect.userText, String(row.promptToken || "")))) {
      problems.push("fixture:expect:userText");
    }
    if (typeof expect.answer !== "boolean") problems.push("fixture:expect:answer");
    if (expect.answerRoot !== undefined && typeof expect.answerRoot !== "boolean") problems.push("fixture:expect:answerRoot");
    if (expect.locate !== undefined && !["selector", "semantic", "anchor"].includes(String(expect.locate))) problems.push("fixture:expect:locate");
  }
  const stats = row.stats as Record<string, unknown> | undefined;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) problems.push("fixture:stats");
  else {
    for (const [key, value] of Object.entries(stats)) {
      if (!STAT_KEYS.has(key) || !(typeof value === "boolean" || Number.isSafeInteger(value))) problems.push(`fixture:stats:${key}`);
    }
    if (stats.truncated === true || typeof stats.elements !== "number" || stats.elements > MAX_SNAPSHOT_NODES || stats.elements < 1) {
      problems.push("fixture:stats:bounds");
    }
  }
  for (const name of findSensitive(JSON.stringify({ ...row, host: undefined }))) problems.push(`fixture:sensitive:${name}`);
  return problems;
}

function positiveScalar(value: unknown, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
}

export function verifySanitizedSnapshot(
  candidate: unknown,
  expected?: { readonly site: SiteKey; readonly host: string }
): { readonly ok: true } | { readonly ok: false; readonly code: SiteSnapshotErrorCode; readonly problems: string[] } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, code: "snapshot_privacy_blocked", problems: ["snapshot:not_object"] };
  }
  const row = candidate as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(row)) if (!SNAPSHOT_KEYS.has(key)) problems.push(`snapshot:key:${key}`);
  if (row.schema !== SITE_SNAPSHOT_SCHEMA) problems.push("snapshot:schema");
  if (row.kind !== SITE_SNAPSHOT_KIND) problems.push("snapshot:kind");
  if (typeof row.site !== "string" || !SITE_KEYS.includes(row.site as SiteKey) || (expected && row.site !== expected.site)) {
    problems.push("snapshot:site");
  }
  if (typeof row.host !== "string" || !row.host || (expected && row.host !== expected.host)) problems.push("snapshot:host");
  if (!isSanitizedRoute(row.path)) problems.push("snapshot:path");
  if (typeof row.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.capturedAt)) problems.push("snapshot:capturedAt");
  if (typeof row.appVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]{1,32})?$/.test(row.appVersion)) {
    problems.push("snapshot:appVersion");
  }
  const viewport = row.viewport as Record<string, unknown> | undefined;
  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)
    || Object.keys(viewport).some((k) => !["width", "height", "devicePixelRatio"].includes(k))
    || !positiveScalar(viewport.width, 32_768)
    || !positiveScalar(viewport.height, 32_768)
    || !positiveScalar(viewport.devicePixelRatio, 16)) {
    problems.push("snapshot:viewport");
  }
  if (!positiveScalar(row.zoomFactor, 10)) problems.push("snapshot:zoomFactor");
  if (!SAMPLING_MODES.has(row.sampling as SiteSnapshotSamplingMode)) problems.push("snapshot:sampling");

  if (!Array.isArray(row.diagnostics) || row.diagnostics.length > 24) problems.push("snapshot:diagnostics");
  else {
    for (const item of row.diagnostics) {
      if (!item || typeof item !== "object" || Array.isArray(item)) { problems.push("snapshot:diagnostic_item"); continue; }
      const d = item as Record<string, unknown>;
      if (Object.keys(d).some((k) => !["name", "kind", "ok"].includes(k))
        || typeof d.name !== "string" || !/^[\x20-\x7e]{1,80}$/.test(d.name) || findSensitive(d.name).length > 0
        || typeof d.ok !== "boolean"
        || !CHECK_KINDS.has(d.kind as SiteCheckKind)) {
        problems.push("snapshot:diagnostic_item");
      }
    }
  }

  const fixture = row.fixture as Record<string, unknown> | undefined;
  const truncated = fixture?.stats && typeof fixture.stats === "object"
    && (fixture.stats as Record<string, unknown>).truncated === true;
  problems.push(...verifyFixtureMeta(row.fixture, typeof row.host === "string" ? row.host : undefined));
  if (fixture && (row.path !== fixture.path || row.capturedAt !== fixture.capturedAt)) problems.push("snapshot:fixture_mismatch");

  const token = typeof fixture?.promptToken === "string" ? fixture.promptToken : "POLYASK_PROMPT";
  const htmlCheck = verifySanitizedHtml(typeof row.html === "string" ? row.html : "", token);
  problems.push(...htmlCheck.problems);
  if (fixture?.stats && typeof (fixture.stats as Record<string, unknown>).elements === "number"
    && htmlCheck.elements !== (fixture.stats as Record<string, unknown>).elements) {
    problems.push("snapshot:element_count_mismatch");
  }

  for (const name of findSensitive(JSON.stringify({ ...row, host: undefined, fixture: undefined, html: undefined }))) {
    problems.push(`snapshot:sensitive:${name}`);
  }

  if (!problems.length) return { ok: true };
  const uniqueProblems = [...new Set(problems)];
  const tooLarge = truncated || uniqueProblems.some((p) => p === "html:max_nodes" || p === "html:too_large");
  if (tooLarge) return { ok: false, code: "snapshot_too_large", problems: uniqueProblems };
  return { ok: false, code: "snapshot_privacy_blocked", problems: uniqueProblems };
}
