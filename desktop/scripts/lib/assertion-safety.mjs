import assert from 'node:assert';
import strict from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { types } from 'node:util';

const guarded = Symbol('polyask.assertion-safety');
const comparisons = ['equal', 'notEqual', 'strictEqual', 'notStrictEqual',
  'deepEqual', 'notDeepEqual', 'deepStrictEqual', 'notDeepStrictEqual'];

// 不调用 inspect，不沿 DOM 的 React Fiber 或 getter 展开；超过检查预算时拒绝比较。
function containsUnsafeValue(root) {
  const seen = new WeakSet(), pending = [[root, 0]];
  let visited = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (++visited > 10_000 || depth > 32 || types.isProxy(value)) return true;
    try {
      if (typeof value.nodeType === 'number' && typeof value.nodeName === 'string') return true;
      if (value.window === value && value.document) return true;
      if (['NodeList', 'HTMLCollection'].includes(value.constructor?.name)) return true;
      if (types.isMap(value)) {
        if (value.size > 10_000) return true;
        for (const [key, item] of value) pending.push([key, depth + 1], [item, depth + 1]);
      } else if (types.isSet(value)) {
        if (value.size > 10_000) return true;
        for (const item of value) pending.push([item, depth + 1]);
      } else if (!ArrayBuffer.isView(value) && !types.isAnyArrayBuffer(value)) {
        const keys = Reflect.ownKeys(value);
        if (keys.length > 10_000) return true;
        for (const key of keys) {
          if (typeof key === 'string' && /^__react(Fiber|Props)\$/.test(key)) return true;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          // Node 24 的原生 Error.stack 是惰性 getter；保留错误处理测试，仍检查其它附带字段。
          if (key === 'stack' && types.isNativeError(value) && descriptor.get &&
            Function.prototype.toString.call(descriptor.get).includes('[native code]')) continue;
          if (descriptor.get || descriptor.set) return true;
          pending.push([descriptor.value, depth + 1]);
        }
      }
      if (pending.length > 20_000) return true;
    } catch { return true; }
  }
  return false;
}

export function installAssertionSafety() {
  for (const target of new Set([assert, strict, assert.strict, assert.Assert?.prototype])) {
    if (!target) continue;
    for (const name of comparisons) {
      const original = target[name];
      if (typeof original !== 'function' || original[guarded]) continue;
      const compare = function (actual, expected, ...rest) {
        if (containsUnsafeValue(actual) || containsUnsafeValue(expected)) {
          const error = new TypeError(`Unsafe ${name}: compare DOM identity/existence as a boolean, or compare scalar properties. No DOM value was formatted.`);
          error.code = 'ERR_UNSAFE_DOM_ASSERTION';
          throw error;
        }
        return Reflect.apply(original, this, [actual, expected, ...rest]);
      };
      compare[guarded] = true;
      target[name] = compare;
    }
  }
  syncBuiltinESMExports();
}

installAssertionSafety();
