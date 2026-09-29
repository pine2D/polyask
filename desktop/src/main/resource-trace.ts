import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { app, webContents, type BrowserWindow } from "electron";
import type { DiagnosticSource } from "./runtime-gates";

// Local, explicitly enabled measurements. Never inspect page text or URLs.
// Associations identify main-frame renderers only: subframe/worker processes
// remain unassigned, and multiple sites may share one PID. Do not sum per site.
export function startResourceTrace(window: BrowserWindow, source: DiagnosticSource): () => void {
  const path = process.env.POLYASK_RESOURCE_TRACE;
  if (!path) return () => {};
  let stream: ReturnType<typeof createWriteStream>;
  try {
    mkdirSync(dirname(path), { recursive: true });
    stream = createWriteStream(path, { flags: "wx" });
  } catch { return () => {}; }
  const started = Date.now();
  let stopped = false, samples = 0;
  let previousProcesses = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    window.removeListener("closed", dispose);
    stream.end();
  };
  stream.on("error", dispose);
  window.on("closed", dispose);
  const write = (value: unknown) => {
    if (!stream.write(`${JSON.stringify(value)}\n`)) dispose();
  };
  const sample = () => {
    if (stopped) return;
    if (window.isDestroyed()) { dispose(); return; }
    try {
      const layout = source.getLayout();
      const sites = source.getDiagnosticSites().map(({ site, webContentsId, attached }) => {
        const contents = webContents.fromId(webContentsId);
        const alive = contents && !contents.isDestroyed();
        const pid = alive ? contents.getOSProcessId() : 0;
        return { site, webContentsId, pid: pid > 0 ? pid : null, attached,
          inCurrentPage: layout.placements.some(item => item.key === site),
          loading: alive ? contents.isLoading() : null,
          backgroundThrottling: alive ? contents.getBackgroundThrottling() : null };
      });
      const shellPid = window.webContents.isDestroyed() ? 0 : window.webContents.getOSProcessId();
      const metrics = app.getAppMetrics();
      const processes = metrics.map(metric => ({
        pid: metric.pid, creationTime: metric.creationTime, type: metric.type,
        cpuIntervalValid: previousProcesses.has(`${metric.pid}:${metric.creationTime}`),
        shell: metric.pid > 0 && metric.pid === shellPid,
        sites: sites.filter(site => site.pid === metric.pid).map(site => site.site),
        cpuPercent: metric.cpu.percentCPUUsage,
        workingSetKb: metric.memory.workingSetSize,
        peakWorkingSetKb: metric.memory.peakWorkingSetSize
      }));
      previousProcesses = new Set(metrics.map(metric => `${metric.pid}:${metric.creationTime}`));
      write({ schema: 1, kind: "resource-sample", timestamp: Date.now(), elapsedMs: Date.now() - started,
        cpuIntervalValid: samples > 0,
        window: { visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() },
        page: layout.page, sites, processes });
      samples++;
      if (samples >= 361 || Date.now() - started >= 30 * 60_000) dispose();
    } catch { dispose(); }
  };
  try {
    write({ schema: 1, kind: "resource-metadata", timestamp: started,
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, chrome: process.versions.chrome,
      gpu: app.getGPUFeatureStatus(), intervalMs: 5_000, durationLimitMs: 30 * 60_000,
      memoryBasis: "process-working-set-not-exclusive", attribution: "main-frame-pid-only" });
    if (!stopped) {
      sample();
      if (!stopped) timer = setInterval(sample, 5_000);
    }
  } catch { dispose(); }
  return dispose;
}
