import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const memoryMax = 4 * 1024 ** 3, swapMax = 512 * 1024 ** 2, dataMax = 2 * 1024 ** 3;
const heap = '--max-old-space-size=1024';

export function buildTestPlan(args = [], directory = root) {
  const [mode = 'all', ...targets] = args;
  const guard = pathToFileURL(resolve(directory, 'scripts/lib/assertion-safety.mjs')).href;
  const node = (...parameters) => ({ command: process.execPath, args: [heap, '--import', guard, ...parameters] });
  const checker = node(resolve(directory, 'scripts/check-dom-assertions.mjs'));
  const tests = (...parameters) => node('--test', '--test-concurrency=1', '--test-timeout=60000', ...parameters);
  if (!['all', 'unit', 'runtime', 'command'].includes(mode)) throw new Error('Unknown test mode: all, unit, runtime, command');
  if (mode !== 'command' && targets.some(target => target.startsWith('-') || !/\.(test|check)\.(ts|tsx|js|mjs)$/.test(target))) {
    throw new Error('Select a test file; Node flags cannot override test protection');
  }
  if (mode === 'all' && targets.length) throw new Error('Use unit/runtime mode to select a test file');
  if (mode === 'command') {
    if (!targets.length) throw new Error('command mode requires an executable');
    const [command, ...parameters] = targets;
    return [checker, command === 'node' ? node(...parameters) : { command, args: parameters }];
  }
  const unit = node('--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=60000',
    ...(targets.length ? targets : ['test/**/*.test.ts', 'test/**/*.test.tsx']));
  const runtime = tests(...(targets.length ? targets : ['scripts/*.test.{js,mjs}']));
  if (mode === 'unit') return [checker, unit];
  if (mode === 'runtime') return [checker, runtime];
  return [checker, node(resolve(directory, 'node_modules/typescript/bin/tsc'), '--noEmit'), unit, runtime];
}

export function linuxBoundary(memory, swap, limits) {
  if (/^\d+$/.test(memory) && Number(memory) <= memoryMax && /^\d+$/.test(swap) && Number(swap) <= swapMax) {
    return { kind: 'cgroup' };
  }
  const data = limits.match(/^Max data size\s+(\d+)\s+(\d+)\s+bytes/m);
  return data && Number(data[1]) <= dataMax && Number(data[2]) <= dataMax ? { kind: 'rlimit-data' } : null;
}

function currentBoundary() {
  const read = path => { try { return readFileSync(path, 'utf8').trim(); } catch { return ''; } };
  const group = read('/proc/self/cgroup').split('\n').find(line => line.startsWith('0::'))?.slice(3);
  return linuxBoundary(read(`/sys/fs/cgroup${group}/memory.max`),
    read(`/sys/fs/cgroup${group}/memory.swap.max`), read('/proc/self/limits'));
}

function run(command, args, timeout = 15 * 60_000) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout, killSignal: 'SIGKILL' });
  if (result.error) console.error(`Test command failed: ${result.error.code ?? result.error.message}`);
  return result.status ?? 1;
}

function main(args) {
  const plan = buildTestPlan(args);
  if (process.platform === 'linux') {
    const boundary = currentBoundary();
    const native = args[0] === 'command' || args.slice(1).some(target => /\.check\.(ts|tsx|js|mjs)$/.test(target));
    if (!boundary || (native && boundary.kind !== 'cgroup')) {
      const manager = spawnSync('systemctl', ['--user', 'show', '--property=ControlGroup', '--value'],
        { encoding: 'utf8', timeout: 5000 });
      if (manager.status === 0) {
        // 失败后直接返回，绝不因测试 RED 自动再跑一遍；scope 不留下持久系统配置。
        return run('systemd-run', ['--user', '--scope', '--quiet', '-p', 'MemoryMax=4G', '-p', 'MemorySwapMax=512M',
          process.execPath, heap, script, ...args]);
      }
      if (native) throw new Error('Linux native UI tests require a working user systemd cgroup; no unbounded fallback');
      console.log('[test protection] cgroup unavailable; using inherited 2 GiB RLIMIT_DATA per process, one test worker');
      return run('prlimit', [`--data=${dataMax}:${dataMax}`, '--', process.execPath, heap, script, ...args]);
    }
    console.log(boundary.kind === 'cgroup' ? '[test protection] cgroup: memory <= 4 GiB, swap <= 512 MiB' :
      '[test protection] RLIMIT_DATA <= 2 GiB per process; this is not an aggregate cgroup limit');
  } else console.log('[test protection] DOM guard, 1 GiB V8 old space, one test worker; native memory is not OS-limited on this platform');
  for (const step of plan) {
    const status = run(step.command, step.args);
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
