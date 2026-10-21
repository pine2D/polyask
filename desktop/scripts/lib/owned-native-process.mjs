// Own only descendants of the child we spawned. Linux identities include starttime to reject PID reuse.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function identity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, state: fields[0], parent: Number(fields[1]), session: Number(fields[3]), start: fields[19] };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}
const same = (a, b) => a && b && a.pid === b.pid && a.start === b.start;
const running = value => value && value.state !== 'Z' && value.state !== 'X';

export function ownProcessTree(child) {
  const observed = new Map();
  let root;
  const remember = value => {
    if (value && (!observed.has(value.pid) || same(observed.get(value.pid), value))) observed.set(value.pid, value);
  };
  const discover = (scanSession = false) => {
    if (!root && child.pid) {
      const value = identity(child.pid);
      if (value && value.parent === process.pid) { root = value; remember(root); }
    }
    const visit = value => {
      const current = identity(value.pid);
      if (!same(value, current)) return;
      remember(current);
      try {
        for (const thread of readdirSync(`/proc/${value.pid}/task`)) {
          let children;
          try { children = readFileSync(`/proc/${value.pid}/task/${thread}/children`, 'utf8').trim().split(/\s+/).filter(Boolean); }
          catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) continue; throw error; }
          for (const pid of children) {
            const next = identity(Number(pid));
            if (next && !observed.has(next.pid)) { remember(next); visit(next); }
          }
        }
      } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    };
    for (const value of [...observed.values()]) visit(value);
    // detached:true creates a session owned by this child; this finds newly orphaned grandchildren.
    if (scanSession && root?.session === root.pid && [...observed.values()].some(value => value.session === root.session && same(value, identity(value.pid)))) {
      for (const entry of readdirSync('/proc')) if (/^\d+$/.test(entry)) {
        const value = identity(Number(entry));
        if (value?.session === root.session && BigInt(value.start) >= BigInt(root.start)) remember(value);
      }
    }
    return [...observed.values()];
  };
  const live = () => [...observed.values()].filter(value => same(value, identity(value.pid)) && running(identity(value.pid)));
  const signal = (value, name) => {
    // Recheck the exact starttime immediately before signaling. Never signal a whole session/group.
    if (!same(value, identity(value.pid))) return;
    try { process.kill(value.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = async (onDiscover = () => {}) => {
    const signals = [], errors = [];
    for (const [name, duration] of [['SIGTERM', 1000], ['SIGKILL', 1500]]) {
      const deadline = Date.now() + duration, signaled = new Set();
      do {
        try { onDiscover(discover(true)); } catch (error) { errors.push(String(error)); }
        const remaining = live();
        if (!remaining.length) break;
        // Descendants first, so their still-live parents can reap them before parent termination.
        for (const value of remaining.sort((a, b) => Number(a.pid === root?.pid) - Number(b.pid === root?.pid))) {
          const key = `${value.pid}:${value.start}`;
          if (!signaled.has(key)) {
            try { signal(value, name); signals.push({ pid: value.pid, start: value.start, signal: name }); }
            catch (error) { errors.push(String(error)); }
            signaled.add(key);
          }
        }
        await pause(30);
      } while (Date.now() < deadline);
      if (!live().length) break;
    }
    return { observed: [...observed.values()], live: live().map(value => value.pid), signals, errors };
  };
  return { discover, stop };
}

export function ownedCommandLine(value) {
  if (!same(value, identity(value.pid))) return [];
  try {
    const args = readFileSync(`/proc/${value.pid}/cmdline`, 'utf8').split('\0');
    return same(value, identity(value.pid)) ? args : [];
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return []; throw error; }
}

export async function runOwnedNative({ command, args, cwd, env, output, timeout = 120000,
  beforeSpawn = async () => {}, onSample = () => {}, onStdout = () => {}, cleanupPaths = () => [] }) {
  let child, owner, timer, watchdog, code, terminationSignal, originalError, result, log = '', receivedSignal;
  let interrupt;
  const interrupted = new Promise((_, reject) => { interrupt = reject; });
  const signalHandlers = new Map(['SIGINT','SIGTERM'].map(signal => {
    const handler = () => {
      if (!receivedSignal) { receivedSignal = signal; interrupt(new Error(`owned_native_signal:${signal}`)); }
    };
    process.on(signal, handler); return [signal, handler];
  }));
  const cleanupErrors = [], ownedPaths = new Set();
  const rememberPaths = observed => {
    try { for (const path of cleanupPaths(observed)) ownedPaths.add(path); }
    catch (error) { cleanupErrors.push(String(error)); }
  };
  try {
    await Promise.race([beforeSpawn(), interrupted]);
    child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    owner = ownProcessTree(child);
    child.stdout.on('data', chunk => { log += String(chunk); onStdout(chunk); });
    child.stderr.on('data', chunk => { log += String(chunk); });
    let fail;
    const monitorFailure = new Promise((_, reject) => { fail = reject; });
    const sample = () => { try { onSample(owner.discover()); } catch (error) { fail(error); } };
    sample(); timer = setInterval(sample, 20);
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (status, signal) => { terminationSignal = signal; resolve(status); }); });
    const expired = new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error(`owned_native_timeout:${timeout}`)), timeout); });
    code = await Promise.race([exited, expired, monitorFailure, interrupted]);
    if (code !== 0) throw new Error(`owned_native_exit:${code}`);
  } catch (error) { originalError = error; }
  finally {
    clearInterval(timer); clearTimeout(watchdog);
    try { result = owner ? await owner.stop(rememberPaths) : { observed: [], live: [], signals: [], errors: [] }; }
    catch (error) { cleanupErrors.push(String(error)); result = { observed: [], live: [child?.pid].filter(Boolean), signals: [], errors: [] }; }
    const paths = [];
    try {
      rememberPaths(result.observed);
      for (const path of ownedPaths) {
        try { if (!result.live.length) rmSync(path, { recursive: true, force: true }); }
        catch (error) { cleanupErrors.push(String(error)); }
        paths.push({ path, exists: existsSync(path) });
      }
    } catch (error) { cleanupErrors.push(String(error)); }
    const cleanup = { ...result, paths, cleanupErrors, originalError: originalError ? String(originalError) : null, code, terminationSignal };
    try { writeFileSync(join(output, 'runtime.log'), log); writeFileSync(join(output, 'cleanup.json'), JSON.stringify(cleanup, null, 2)); }
    catch (error) { cleanupErrors.push(String(error)); console.error(`cleanup_evidence_failed:${error}`); }
    if (!originalError && (result.live.length || result.errors.length || cleanupErrors.length || paths.some(path => path.exists))) {
      originalError = new Error('owned_native_cleanup_failed');
    }
  }
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  if (receivedSignal) {
    console.error(String(originalError));
    // Restore the original signal exit after the owned subtree and paths have been handled.
    process.kill(process.pid, receivedSignal); await new Promise(() => {});
  }
  if (originalError) { if (log) console.error(log.slice(-12000)); throw originalError; }
  return { code, ...result };
}
