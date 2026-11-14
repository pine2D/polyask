import { resolveLocale } from "../shared/locale";
import { normalizeDiagnosticChecks, type SiteDiagnosticCheck } from "../shared/site-health";
import {
  MAX_SNAPSHOT_NODES,
  verifyFixtureMeta,
  verifySanitizedHtml,
  type SiteDomFixtureExpect,
  type SiteDomSnapshotSample,
  type SiteSnapshotSamplingMode
} from "../shared/site-snapshot";
import {
  elementPath,
  sanitizeDomFixture,
  sanitizeRoute,
  type DomFixtureMark
} from "../../scripts/lib/dom-fixture-sanitize";

const PROMPT_TOKEN = "POLYASK_PROMPT";
const FULL_MAIN_BUDGET = 8_000;
const PORTAL_SELECTOR = '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper]';
const CONTROL_SELECTOR = '[data-testid*="model" i], [aria-haspopup="menu"], [aria-haspopup="listbox"]';
const COMPOSER_FALLBACK_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';

interface RuntimeTurn {
  readonly user?: Element | null;
  readonly answer?: Element | string | null;
  readonly answerRoot?: Element | null;
  readonly userCount?: number;
  readonly text?: string;
  readonly locate?: string;
}

interface RuntimeEnvironment {
  readonly doc?: Document;
  readonly win?: Window & typeof globalThis;
  readonly runtime?: {
    readonly diagnose?: () => unknown;
    readonly findComposer?: () => Element | null;
    readonly pickAdapter?: () => { readonly historyTurn?: () => RuntimeTurn | null } | null;
  };
  readonly i18n?: { readonly setLang?: (lang: string) => void };
  readonly locale?: string;
  readonly now?: Date;
}

function promptTokenLines(prompt: string, token: string): string {
  const lines = String(prompt || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.length <= 1 ? token : lines.map((_, index) => `${token}-L${index + 1}`).join("\n");
}

function isHiddenPopup(win: Window, el: Element): boolean {
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  try {
    const style = win.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function dedupeRoots(candidates: readonly (Element | null | undefined)[]): Element[] {
  const roots: Element[] = [];
  for (const candidate of candidates) {
    if (!candidate || candidate.nodeType !== 1) continue;
    if (roots.some((kept) => kept === candidate || kept.contains(candidate))) continue;
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      if (candidate.contains(roots[index])) roots.splice(index, 1);
    }
    roots.push(candidate);
  }
  return roots;
}

function climbBounded(start: Element | null, maxDepth: number, maxElements: number): Element | null {
  if (!start || start.nodeType !== 1) return null;
  let current: Element = start;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const parent = current.parentElement;
    if (!parent) break;
    const tag = parent.localName?.toLowerCase() ?? "";
    if (tag === "body" || tag === "html" || tag === "main" || tag === "nav" || tag === "aside") break;
    if (parent.getElementsByTagName("*").length + 1 > maxElements) break;
    current = parent;
  }
  return current;
}

function collectDiagnostics(env: RuntimeEnvironment, restoreLocale: string): SiteDiagnosticCheck[] {
  let raw: unknown = [];
  try {
    env.i18n?.setLang?.("en");
    raw = env.runtime?.diagnose?.() ?? [];
  } catch {
    raw = [];
  } finally {
    try { env.i18n?.setLang?.(restoreLocale); } catch { /* ignore */ }
  }
  return normalizeDiagnosticChecks(raw).map((check, index) => ({
    name: /^[\x20-\x7e]{1,80}$/.test(check.name) ? check.name : `${check.kind ?? "control"}_${index + 1}`,
    kind: check.kind ?? "control",
    ok: check.ok
  }));
}

function collectVisiblePopups(doc: Document, win: Window): Element[] {
  return dedupeRoots([...doc.querySelectorAll(PORTAL_SELECTOR)].filter((el) => !isHiddenPopup(win, el)));
}

function collectTargetedRoots(doc: Document, win: Window, runtime: RuntimeEnvironment["runtime"], turn: RuntimeTurn | null): Element[] {
  const candidates: Element[] = [];
  const turnNodes = [turn?.user, turn?.answerRoot, typeof turn?.answer === "object" ? turn?.answer : null].filter(Boolean) as Element[];
  const containsTurn = (el: Element) => turnNodes.some((node) => el === node || el.contains(node) || node.contains(el));
  for (const header of doc.querySelectorAll("header")) {
    if (!header.closest("nav, aside") && !containsTurn(header) && header.getElementsByTagName("*").length + 1 <= 800) candidates.push(header);
  }
  for (const control of doc.querySelectorAll(CONTROL_SELECTOR)) {
    if (control.closest("nav, aside") || containsTurn(control)) continue;
    let region = climbBounded(control, 3, 800);
    if (region && containsTurn(region)) region = control;
    if (region && !containsTurn(region)) candidates.push(region);
  }
  const composer = runtime?.findComposer?.() ?? doc.querySelector(COMPOSER_FALLBACK_SELECTOR);
  let composerRegion = climbBounded(composer, 4, 2_000);
  if (composerRegion && containsTurn(composerRegion)) composerRegion = composer;
  if (composerRegion && !composerRegion.closest("nav, aside") && !containsTurn(composerRegion)) candidates.push(composerRegion);
  candidates.push(...collectVisiblePopups(doc, win).filter((popup) => !containsTurn(popup)));
  const roots = dedupeRoots(candidates);
  if (roots.length > 0) return roots;
  const bodyChildren = [...doc.body.children].filter((el) => {
    const tag = el.localName?.toLowerCase() ?? "";
    return tag !== "nav" && tag !== "aside" && !containsTurn(el);
  });
  return bodyChildren.length > 0 ? dedupeRoots(bodyChildren) : [doc.body];
}

export function sampleSiteDomSnapshot(input?: RuntimeEnvironment): SiteDomSnapshotSample {
  const win = input?.win ?? (globalThis as unknown as Window & typeof globalThis);
  const doc = input?.doc ?? win.document;
  const runtime = input?.runtime ?? (win as typeof win & { __AMS?: RuntimeEnvironment["runtime"] }).__AMS;
  const i18n = input?.i18n ?? (win as typeof win & { __AMS_I18N__?: RuntimeEnvironment["i18n"] }).__AMS_I18N__;
  if (!doc?.body || !win?.location) return { ok: false, code: "adapter_unavailable" };
  if (win.location.protocol !== "https:") return { ok: false, code: "not_ready" };

  let safePath: string;
  try {
    safePath = sanitizeRoute(win.location.href);
  } catch {
    return { ok: false, code: "not_ready" };
  }

  const locale = resolveLocale(input?.locale ?? win.navigator?.language ?? "en");
  const diagnostics = collectDiagnostics({ runtime, i18n }, locale);
  let turn: RuntimeTurn | null = null;
  try { turn = runtime?.pickAdapter?.()?.historyTurn?.() ?? null; } catch { turn = null; }

  const main = doc.querySelector("main") ?? doc.querySelector('[role="main"]');
  const mainCount = main ? main.getElementsByTagName("*").length + 1 : 0;
  const visiblePopups = collectVisiblePopups(doc, win);

  let sampling: SiteSnapshotSamplingMode;
  let html: string;
  let stats: ReturnType<typeof sanitizeDomFixture>["stats"];
  let expect: SiteDomFixtureExpect = { userCount: 0, userText: null, answer: false };

  if (main && mainCount > 0 && mainCount <= FULL_MAIN_BUDGET) {
    sampling = "full-main";
    const extraRoots = visiblePopups.filter((popup) => !main.contains(popup));
    const userPath = turn?.user ? elementPath(main, turn.user) : null;
    const answerNode = typeof turn?.answer === "object" && turn?.answer ? turn.answer : null;
    const answerPath = answerNode ? elementPath(main, answerNode) : null;
    const answerRootPath = turn?.answerRoot ? elementPath(main, turn.answerRoot) : null;
    const marksValid = !!userPath
      && (!answerNode || !!answerPath)
      && (!turn?.answerRoot || !!answerRootPath);

    if (marksValid && userPath) {
      const marks: DomFixtureMark[] = [{ path: userPath, token: "user" }];
      if (answerPath) marks.push({ path: answerPath, token: "answer" });
      if (answerRootPath) marks.push({ path: answerRootPath, token: "answer-root" });
      const rawPrompt = String(turn?.text ?? "").trim();
      let pass = rawPrompt
        ? sanitizeDomFixture(main, { prompt: rawPrompt, promptToken: PROMPT_TOKEN, marks, extraRoots, maxNodes: MAX_SNAPSHOT_NODES })
        : null;
      let expectedUserText = rawPrompt ? promptTokenLines(rawPrompt, PROMPT_TOKEN) : PROMPT_TOKEN;
      if (!pass || pass.stats.promptHits === 0) {
        pass = sanitizeDomFixture(main, { promptToken: PROMPT_TOKEN, maskMarkedUser: true, marks, extraRoots, maxNodes: MAX_SNAPSHOT_NODES });
        expectedUserText = PROMPT_TOKEN;
      }
      if (pass.stats.promptHits > 0) {
        html = pass.html;
        stats = pass.stats;
        const locate = turn?.locate === "selector" || turn?.locate === "semantic" || turn?.locate === "anchor"
          ? turn.locate
          : undefined;
        expect = {
          userCount: Number.isSafeInteger(turn?.userCount) && (turn?.userCount as number) > 0 ? (turn!.userCount as number) : 1,
          userText: expectedUserText,
          answer: !!answerPath,
          ...(answerRootPath ? { answerRoot: true } : {}),
          ...(locate ? { locate } : {})
        };
      } else {
        const fallback = sanitizeDomFixture(main, { promptToken: PROMPT_TOKEN, extraRoots, maxNodes: MAX_SNAPSHOT_NODES });
        html = fallback.html;
        stats = fallback.stats;
      }
    } else {
      const plain = sanitizeDomFixture(main, { promptToken: PROMPT_TOKEN, extraRoots, maxNodes: MAX_SNAPSHOT_NODES });
      html = plain.html;
      stats = plain.stats;
    }
  } else {
    sampling = main ? "targeted" : "body-controls";
    const roots = collectTargetedRoots(doc, win, runtime, turn);
    const targeted = sanitizeDomFixture(roots[0], {
      promptToken: PROMPT_TOKEN,
      extraRoots: roots.slice(1),
      maxNodes: MAX_SNAPSHOT_NODES
    });
    html = targeted.html;
    stats = targeted.stats;
  }

  if (stats.truncated || stats.elements > MAX_SNAPSHOT_NODES) {
    return { ok: false, code: "snapshot_too_large" };
  }

  const capturedAt = (input?.now ?? new Date()).toISOString().slice(0, 10);
  const fixtureWithoutHost = {
    schema: 1 as const,
    path: safePath,
    promptToken: PROMPT_TOKEN,
    source: "captured" as const,
    capturedAt,
    note: `site-snapshot (${sampling})`,
    expect,
    stats
  };

  const htmlVerdict = verifySanitizedHtml(html, PROMPT_TOKEN);
  const metaProblems = verifyFixtureMeta({ ...fixtureWithoutHost, host: win.location.hostname });
  if (htmlVerdict.problems.length || metaProblems.length || htmlVerdict.elements !== stats.elements) {
    if (htmlVerdict.problems.includes("html:max_nodes") || htmlVerdict.problems.includes("html:too_large")) {
      return { ok: false, code: "snapshot_too_large" };
    }
    return { ok: false, code: "snapshot_privacy_blocked" };
  }

  const width = Math.max(1, Math.round(Number(win.innerWidth) || 1));
  const height = Math.max(1, Math.round(Number(win.innerHeight) || 1));
  const dpr = Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? Number(win.devicePixelRatio.toFixed(3)) : 1;

  return {
    ok: true,
    path: safePath,
    capturedAt,
    viewport: { width, height, devicePixelRatio: dpr },
    diagnostics,
    sampling,
    fixture: fixtureWithoutHost,
    html
  };
}
