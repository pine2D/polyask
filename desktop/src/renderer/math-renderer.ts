import { mathSourceIssue, MATH_MARKUP_LIMIT, type MathResult, type MathFailure } from './math-source';

interface Timer { readonly owner: Window; readonly id: number }
interface Job { readonly id: number; readonly resolve: (result: MathResult) => void;
  readonly signal: AbortSignal; readonly abort: () => void; readonly timer: Timer }
let worker: Worker | null = null, job: Job | null = null, idle: Timer | null = null, serial = 0;
const schedule = (callback: () => void, ms: number): Timer => ({ owner: window, id: window.setTimeout(callback, ms) });
const clear = (timer: Timer | null) => { if (timer) timer.owner.clearTimeout(timer.id); };
function release() { clear(idle); idle = null; worker?.terminate(); worker = null; }
function finish(id: number, result: MathResult, discard = false) {
  if (job?.id !== id) return;
  const current = job; job = null;
  clear(current.timer); current.signal.removeEventListener('abort', current.abort);
  if (discard) release(); else { clear(idle); idle = schedule(release, 30_000); }
  current.resolve(result);
}
const failures = new Set<MathFailure>(['limit', 'busy', 'timeout', 'unsupported', 'failed']);

/** One bounded local Worker, no automatic replay or unbounded render queue. */
export function renderMath(source: string, display: boolean, signal: AbortSignal): Promise<MathResult> {
  const issue = mathSourceIssue(source);
  if (issue) return Promise.resolve({ ok: false, reason: issue });
  if (signal.aborted) return Promise.resolve({ ok: false, reason: 'failed' });
  if (job) return Promise.resolve({ ok: false, reason: 'busy' });
  clear(idle); idle = null;
  const id = ++serial;
  return new Promise(resolve => {
    const abort = () => finish(id, { ok: false, reason: 'failed' }, true);
    job = { id, resolve, signal, abort, timer: schedule(() => finish(id, { ok: false, reason: 'timeout' }, true), 750) };
    signal.addEventListener('abort', abort, { once: true });
    void import('./math-worker-factory').then(({ createMathWorker }) => {
      if (job?.id !== id || signal.aborted) return;
      worker ??= createMathWorker();
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (job?.id !== id || !data || typeof data !== 'object') return;
        const reply = data as { id?: unknown; ok?: unknown; mathml?: unknown; reason?: unknown };
        if (reply.id !== id) return;
        if (reply.ok === true && typeof reply.mathml === 'string') {
          finish(id, reply.mathml.length > MATH_MARKUP_LIMIT ? { ok: false, reason: 'limit' } : { ok: true, mathml: reply.mathml });
        } else if (reply.ok === false && failures.has(reply.reason as MathFailure)) finish(id, { ok: false, reason: reply.reason as MathFailure });
        else finish(id, { ok: false, reason: 'failed' }, true);
      };
      const owner = worker;
      worker.onerror = () => {
        if (worker !== owner) return;
        if (job) finish(job.id, { ok: false, reason: 'failed' }, true); else release();
      };
      worker.postMessage({ id, source, display });
    }).catch(() => finish(id, { ok: false, reason: 'failed' }, true));
  });
}
