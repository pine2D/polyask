exports.distribution = samples => {
  if (!samples.length || samples.some(n => !Number.isFinite(n) || n < 0)) throw Error('invalid_samples');
  const sorted = [...samples].sort((a, b) => a - b);
  return { n: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1],
    min: sorted[0], max: sorted.at(-1) };
};
// Prepare + synchronous SQLite execution, including JS registered function callbacks; no unrelated-run subtraction.
exports.instrumentDatabase = db => {
  const raw = db.database, original = raw.prepare.bind(raw);
  let active = null;
  raw.prepare = sql => {
    const start = performance.now(), statement = original(sql);
    if (active) { active.sqliteMs += performance.now() - start; active.sqlCalls++; }
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const start = performance.now();
        try { return value.apply(target, args); }
        finally { if (active) active.sqliteMs += performance.now() - start; }
      };
    } });
  };
  return { begin() { active = { sqliteMs: 0, sqlCalls: 0 }; }, end() { const value = active; active = null; return value; } };
};
