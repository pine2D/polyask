import { renderMathMarkup } from './math-engine';

interface MathScope { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage(value: unknown): void }
const scope = self as unknown as MathScope;
scope.onmessage = ({ data }) => {
  if (!data || typeof data !== 'object') return;
  const value = data as { id?: unknown; source?: unknown; display?: unknown };
  if (!Number.isSafeInteger(value.id) || typeof value.source !== 'string' || typeof value.display !== 'boolean') return;
  scope.postMessage({ id: value.id, ...renderMathMarkup(value.source, value.display) });
};
