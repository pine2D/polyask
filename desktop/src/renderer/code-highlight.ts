export interface CodePart { readonly text: string; readonly kind: 'plain' | 'keyword' | 'string' | 'comment' | 'number' }
type Language = 'js' | 'json' | 'python' | 'bash';
const aliases: Readonly<Record<string, Language>> = { js: 'js', javascript: 'js', ts: 'js', typescript: 'js',
  json: 'json', py: 'python', python: 'python', sh: 'bash', bash: 'bash' };
const keywords: Readonly<Record<Language, ReadonlySet<string>>> = {
  js: new Set('const let var function return if else for while class new import export from default async await try catch throw true false null undefined interface type extends public private readonly'.split(' ')),
  json: new Set(['true', 'false', 'null']),
  python: new Set('def class return if elif else for while in import from as with try except finally raise lambda and or not is None True False async await yield pass break continue'.split(' ')),
  bash: new Set('if then else elif fi for while do done case esac in function select until export local readonly return'.split(' '))
};
export const CODE_HIGHLIGHT_LIMIT = 32_768;
export const supportsCodeHighlight = (language: string): boolean => Object.hasOwn(aliases, language.toLowerCase());
const wordStart = (char: string) => /[a-zA-Z_$]/.test(char);
const wordChar = (char: string) => /[a-zA-Z0-9_$]/.test(char);
const digit = (char: string) => /[0-9]/.test(char);

/** Bounded lexical hints, not a grammar parser; every input character is retained. */
export function highlightCode(source: string, language: string): readonly CodePart[] | null {
  const lang = supportsCodeHighlight(language) ? aliases[language.toLowerCase()] : undefined;
  if (!lang || source.length > CODE_HIGHLIGHT_LIMIT) return null;
  const parts: CodePart[] = [];
  const append = (text: string, kind: CodePart['kind']) => {
    const previous = parts.at(-1);
    if (previous?.kind === kind) parts[parts.length - 1] = { text: previous.text + text, kind };
    else parts.push({ text, kind });
  };
  let i = 0;
  while (i < source.length) {
    let end = i + 1, kind: CodePart['kind'] = 'plain';
    const char = source[i], next = source[i + 1];
    const lineComment = (lang === 'js' && char === '/' && next === '/') || ((lang === 'python' || lang === 'bash') && char === '#');
    if (lineComment) { while (end < source.length && source[end] !== '\n') end++; kind = 'comment'; }
    else if (lang === 'js' && char === '/' && next === '*') {
      end = i + 2; while (end < source.length && !(source[end] === '*' && source[end + 1] === '/')) end++;
      end = Math.min(source.length, end + 2); kind = 'comment';
    } else if (char === '"' || (lang !== 'json' && (char === "'" || (lang === 'js' && char === '`')))) {
      const triple = lang === 'python' && source.slice(i, i + 3) === char.repeat(3), delimiter = triple ? char.repeat(3) : char;
      end = i + delimiter.length;
      while (end < source.length) {
        if (source[end] === '\\') { end = Math.min(source.length, end + 2); continue; }
        if (source.startsWith(delimiter, end)) { end += delimiter.length; break; }
        end++;
      }
      kind = 'string';
    } else if (wordStart(char)) {
      while (end < source.length && wordChar(source[end])) end++;
      kind = keywords[lang].has(source.slice(i, end)) ? 'keyword' : 'plain';
    } else if (digit(char)) {
      if (char === '0' && /[xX]/.test(next ?? '')) { end++; while (end < source.length && /[0-9a-fA-F_]/.test(source[end])) end++; }
      else {
        while (end < source.length && /[0-9_.]/.test(source[end])) end++;
        if (/[eE]/.test(source[end] ?? '')) {
          let exponent = end + 1; if (source[exponent] === '+' || source[exponent] === '-') exponent++;
          if (digit(source[exponent] ?? '')) { end = exponent + 1; while (end < source.length && /[0-9_]/.test(source[end])) end++; }
        }
      }
      kind = 'number';
    }
    append(source.slice(i, end), kind); i = end;
    if (parts.length > 2000) return null;
  }
  return parts;
}
