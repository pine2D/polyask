import type { SiteKey } from "../shared/contracts";
import { SITES } from "./sites";

// Only accept an actual observed conversation URL, never construct one from text.
// Unknown/new route formats degrade to saved-answer reading until verified.
const paths: Record<SiteKey, RegExp> = {
  claude: /^\/chat\/[a-zA-Z0-9_-]{8,128}\/?$/,
  chatgpt: /^\/c\/[a-zA-Z0-9_-]{8,128}\/?$/,
  gemini: /^\/app\/[a-zA-Z0-9_-]{8,128}\/?$/,
  deepseek: /^\/a\/chat\/s\/[a-zA-Z0-9_-]{8,128}\/?$/,
  doubao: /^\/chat\/[a-zA-Z0-9_-]{8,128}\/?$/,
  qianwen: /^\/chat\/[a-zA-Z0-9_-]{8,128}\/?$/,
  kimi: /^\/chat\/[a-zA-Z0-9_-]{8,128}\/?$/,
  yuanbao: /^\/chat\/[a-zA-Z0-9_-]{8,128}(?:\/[a-zA-Z0-9_-]{8,128})?\/?$/,
  chatglm: /^\/main\/alltoolsdetail\/[a-zA-Z0-9_-]{8,128}\/?$/
};
export function safeQuestionUrl(site: SiteKey, value: string): string | null {
  const definition = SITES.find(item => item.key === site);
  if (!definition || typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.origin !== new URL(definition.url).origin || url.username || url.password) return null;
    if (site === "chatglm" && url.pathname === "/main/alltoolsdetail") {
      const ids = url.searchParams.getAll("cid");
      if (ids.length !== 1 || !/^[a-zA-Z0-9_-]{24}$/.test(ids[0])) return null;
      url.search = "";
      url.searchParams.set("cid", ids[0]);
      url.hash = "";
      return url.href;
    }
    if (!paths[site].test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}
