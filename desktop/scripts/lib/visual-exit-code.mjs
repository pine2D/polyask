import { once } from 'node:events';
import { existsSync } from 'node:fs';

// Electron can handle SIGTERM by quitting normally, even with assertions still pending.
export async function visualExitCode(child, finalReport, timeoutMs, graceMs = 3000) {
  let timedOut = false;
  let deadline, forceTimer;
  const hardStop = new Promise(resolve => {
    deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => {
        child.kill('SIGKILL');
        child.unref();
        resolve([null]);
      }, graceMs);
    }, timeoutMs);
  });
  try {
    const [code] = await Promise.race([once(child, 'exit'), hardStop]);
    if (timedOut) console.error(`Native UI checks timed out: ${finalReport}`);
    else if (code !== 0) return code ?? 1;
    else if (existsSync(finalReport)) return 0;
    else console.error(`Native UI checks exited before completion: ${finalReport}`);
    return 1;
  } finally {
    clearTimeout(deadline);
    clearTimeout(forceTimer);
  }
}
