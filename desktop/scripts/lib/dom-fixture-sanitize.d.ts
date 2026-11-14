export type DomFixtureExpectToken = "user" | "answer" | "answer-root";

export interface DomFixtureMark {
  readonly path: readonly number[];
  readonly token: DomFixtureExpectToken;
}

export interface DomFixtureStats {
  readonly elements: number;
  readonly texts: number;
  readonly promptHits: number;
  readonly droppedElements: number;
  readonly droppedAttrs: number;
  readonly truncated: boolean;
  readonly marked: number;
}

export interface SanitizeDomFixtureOptions {
  readonly prompt?: string;
  readonly promptToken?: string;
  readonly singleToken?: boolean;
  readonly maskMarkedUser?: boolean;
  readonly maxNodes?: number;
  readonly computedHidden?: boolean;
  readonly marks?: readonly DomFixtureMark[];
  readonly extraRoots?: readonly Element[];
}

export interface SanitizeDomFixtureOutput {
  readonly html: string;
  readonly stats: DomFixtureStats;
}

export function sanitizeDomFixture(root: Element, options?: SanitizeDomFixtureOptions): SanitizeDomFixtureOutput;
export function elementPath(root: Element, node: Element): number[] | null;
export function findSensitive(text: unknown): string[];
export function attrValueOk(name: string, value: string): boolean;
export function isSafeId(value: string): boolean;
export function isSafeDataAttr(name: string): boolean;
export function safeClass(value: string): string;
export function isPromptText(value: string, token: string): boolean;
export function isFillerText(value: string): boolean;
export function sanitizeRoute(href: string): string;
export function isSanitizedRoute(value: unknown): boolean;
export const FILLER: string;
export const KEEP_ATTRS: readonly string[];
export const SEMANTIC_DATA: readonly string[];
export const PROSE_NO_ID_TAGS: readonly string[];
export const EXPECT_ATTR: string;
export const EXPECT_TOKENS: readonly DomFixtureExpectToken[];
export const DROP_TAGS: readonly string[];
export const EMPTY_TAGS: readonly string[];
export const VOID_TAGS: readonly string[];
export const PROMPT_TOKEN: RegExp;
