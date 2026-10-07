// Keep import.meta in this Webpack-owned module: the TypeScript project remains CommonJS.
export function createMathWorker() {
  return new Worker(new URL('./math-worker.ts', import.meta.url));
}
