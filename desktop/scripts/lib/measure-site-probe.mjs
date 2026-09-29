// Executed in the production preload's isolated context. Return only timings
// and booleans; never transport nodes, answer strings, URLs or exception text.
export function measureSiteProbe() {
  const runtime = window.__AMS;
  const adapter = runtime?.pickAdapter?.();
  if (!adapter) return { available: false };
  const measure = action => {
    const started = performance.now();
    try { return { value: action(), ms: performance.now() - started, failed: false }; }
    catch { return { value: null, ms: performance.now() - started, failed: true }; }
  };
  const generation = typeof adapter.generation === 'function' ? measure(() => adapter.generation()) : null;
  const answer = typeof adapter.answer === 'function' ? measure(() => adapter.answer()) : null;
  const markdown = answer?.value && typeof answer.value !== 'string' && typeof runtime.toMarkdown === 'function'
    ? measure(() => runtime.toMarkdown(answer.value)) : null;
  return { available: true,
    viewport: { width: innerWidth, height: innerHeight },
    generation: generation && { ms: generation.ms, failed: generation.failed,
      state: ['idle', 'generating', 'complete'].includes(generation.value) ? generation.value : null },
    answer: answer && { ms: answer.ms, failed: answer.failed, present: !!answer.value },
    markdown: markdown && { ms: markdown.ms, failed: markdown.failed, present: !!markdown.value } };
}

// Electron creates identically named isolated worlds for embedded frames too.
export function mainFrameProbeContext(contexts, frameId) {
  if (!frameId) return undefined;
  return contexts.find(item => item.name === 'Electron Isolated Context' && item.auxData?.isDefault === false && item.auxData?.frameId === frameId);
}
