// Read-only measurements against an already running development Electron.
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { measureSiteProbe } from './lib/measure-site-probe.mjs';
const require = createRequire(import.meta.url);
const { desktopSites } = require('./lib/desktop-anchors.js');
const port = Number(process.argv[2] ?? 9223);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_local_debug_port');
const output = await mkdtemp(join(tmpdir(), 'polyask-probe-performance-'));
const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
const rows = [];
for (const target of targets) {
  let site;
  try {
    const url = new URL(target.url);
    if (url.protocol === 'https:') site = desktopSites().find(item => item.host === url.hostname);
  } catch { continue; }
  if (!site || target.type !== 'page') continue;
  // The debug endpoint may supply arbitrary URLs: connect only to this port.
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port) {
    throw new Error('nonlocal_debug_endpoint');
  }
  const socket = new WebSocket(endpoint);
  let seq = 0;
  const pending = new Map();
  const contexts = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error('debug_command_failed'));
      else request.resolve(message.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('debug_timeout')); }, 8000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('debug_connect_timeout')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('debug_connect_failed')); }, { once: true });
    });
    await call('Runtime.enable');
    const context = contexts.find(item => item.name === 'Electron Isolated Context' && item.auxData?.isDefault === false);
    if (!context) { rows.push({ site: site.key, available: false }); continue; }
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const result = await call('Runtime.evaluate', { expression: `(${measureSiteProbe.toString()})()`,
        contextId: context.id, returnByValue: true });
      if (result.exceptionDetails) throw new Error('probe_evaluation_failed');
      samples.push(result.result.value);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    rows.push({ site: site.key, samples });
  } catch { rows.push({ site: site.key, available: false, failed: true }); }
  finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket.close();
  }
}
const report = { schema: 1, kind: 'read-only-probe-performance', timestamp: Date.now(),
  note: 'Current pages only; missing answers do not measure long-conversation serialization. No prompts sent.', rows };
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
console.log(`Probe performance evidence: ${output}`);
if (!rows.length || rows.some(row => row.failed || row.available === false || row.samples?.some(sample =>
  !sample?.available || sample.generation?.failed || sample.answer?.failed || sample.markdown?.failed))) process.exitCode = 1;
