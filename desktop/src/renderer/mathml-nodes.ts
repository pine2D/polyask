import { MATH_MARKUP_LIMIT } from './math-source';

export interface MathNode { readonly name: string; readonly attributes: Readonly<Record<string, string>>; readonly children: readonly (MathNode | string)[] }
const namespace = 'http://www.w3.org/1998/Math/MathML';
const tags = new Set('math semantics mrow mi mn mo mfrac msup msub msubsup msqrt mroot mtext mtable mtr mtd mlabeledtr mover munder munderover mmultiscripts mprescripts none menclose mspace mstyle mpadded mphantom'.split(' '));
const booleanAttrs = new Set('displaystyle stretchy symmetric fence separator largeop movablelimits accent accentunder'.split(' '));
const lengthAttrs = new Set('width height depth lspace rspace voffset minsize maxsize linethickness columnspacing rowspacing'.split(' '));
const enumAttrs: Readonly<Record<string, ReadonlySet<string>>> = {
  display: new Set(['block', 'inline']), mathvariant: new Set('normal bold italic bold-italic double-struck fraktur bold-fraktur script bold-script sans-serif bold-sans-serif sans-serif-italic sans-serif-bold-italic monospace'.split(' ')),
  columnalign: new Set(['left', 'center', 'right']), rowalign: new Set(['top', 'bottom', 'center', 'baseline', 'axis']),
  notation: new Set('longdiv actuarial radical box roundedbox circle left right top bottom updiagonalstrike downdiagonalstrike verticalstrike horizontalstrike phasorangle madruwb'.split(' '))
};
function safeAttribute(name: string, value: string): boolean {
  if (booleanAttrs.has(name)) return value === 'true' || value === 'false';
  if (lengthAttrs.has(name)) return value.length <= 128 && value.split(' ').every(part => {
    const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(em|ex|px|pt|%)?$/.exec(part);
    if (!match) return false;
    const amount = Number(match[1]), limit = match[2] === '%' ? 100 : match[2] === 'px' || match[2] === 'pt' ? 1000 : 32;
    return Number.isFinite(amount) && Math.abs(amount) <= limit;
  });
  if (name === 'scriptlevel') return /^[+-]?[0-9]$/.test(value);
  if (name === 'columnspan' || name === 'rowspan') return /^[1-9][0-9]?$/.test(value);
  return value.length <= 128 && Object.hasOwn(enumAttrs, name) && value.split(' ').every(part => enumAttrs[name].has(part));
}

/** The detached MathML document never enters the shell; React receives only allowed data. */
export function mathmlNodes(value: string): readonly MathNode[] | null {
  if (value.length > MATH_MARKUP_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(value)) return null;
  const doc = new DOMParser().parseFromString(value, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'math' || doc.documentElement.namespaceURI !== namespace) return null;
  let count = 0, invalid = false;
  const read = (node: Element, depth: number): MathNode | null => {
    if (++count > 2000 || depth > 64 || node.namespaceURI !== namespace) { invalid = true; return null; }
    if (node.localName === 'annotation') return null;
    if (!tags.has(node.localName)) { invalid = true; return null; }
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'xmlns' && node === doc.documentElement && attr.value === namespace) continue;
      if (!safeAttribute(attr.name, attr.value)) { invalid = true; return null; }
      attributes[attr.name] = attr.value;
    }
    const children: (MathNode | string)[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { if (++count > 2000) invalid = true; children.push(child.textContent ?? ''); }
      else if (child.nodeType === 1) { const result = read(child as Element, depth + 1); if (result) children.push(result); }
      else { invalid = true; }
    }
    return { name: node.localName, attributes, children };
  };
  const result = read(doc.documentElement, 0);
  return invalid || !result ? null : [result];
}
