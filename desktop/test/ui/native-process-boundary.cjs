const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

exports.processBoundary = (app, output) => {
  const samples = [], observed = new Set();
  return () => {
    if (process.platform !== 'linux') return;
    const seen = new Set();
    const visit = pid => {
      if (seen.has(pid)) return []; seen.add(pid);
      try {
        const group = readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().replace(/^0::/, '');
        const children = readdirSync(`/proc/${pid}/task`).flatMap(tid => {
          try { return readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); }
          catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return []; throw error; }
        });
        observed.add(pid); return [{ pid, group }, ...[...new Set(children)].flatMap(visit)];
      } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return []; throw error; }
    };
    const processes = [process.pid, ...app.getAppMetrics().map(item => item.pid)].flatMap(visit);
    let common = processes[0]?.group || '/';
    while (common !== '/' && !processes.every(item => item.group === common || item.group.startsWith(`${common}/`))) common = dirname(common);
    for (let group = common; group !== '/'; group = dirname(group)) {
      const memory = readFileSync(`/sys/fs/cgroup${group}/memory.max`, 'utf8').trim();
      const swap = readFileSync(`/sys/fs/cgroup${group}/memory.swap.max`, 'utf8').trim();
      if (/^\d+$/.test(memory) && Number(memory) <= 4 * 1024 ** 3 && /^\d+$/.test(swap) && Number(swap) <= 512 * 1024 ** 2) {
        samples.push({ group, memory, swap, processes });
        writeFileSync(join(output, 'process-boundary.json'), JSON.stringify({ samples, observed: [...observed] }, null, 2)); return;
      }
    }
    throw new Error('Observed Electron processes have no common 4GiB/512MiB cgroup boundary');
  };
};
