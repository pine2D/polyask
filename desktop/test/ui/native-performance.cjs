// Local, bounded observations; these samples are not cross-platform budgets.
function nativePerformance(app, scenario) {
  app.getAppMetrics();
  const started = performance.now();
  return () => ({ scenario, elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    processes: app.getAppMetrics().map(metric => ({ type: metric.type,
      cpuPercent: Math.round(metric.cpu.percentCPUUsage * 100) / 100,
      residentKiB: metric.memory.workingSetSize })) });
}
module.exports = { nativePerformance };
