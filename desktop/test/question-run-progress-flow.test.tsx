import assert from 'node:assert/strict';
import test from 'node:test';
import { act, StrictMode } from 'react';
import type { QuestionRunProgress } from '../src/shared/question-run-progress';
import { useQuestionRunProgress } from '../src/renderer/use-question-run-progress';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const value = (runId = 'a', revision = 1): QuestionRunProgress => ({ runId, questionId: `q-${runId}`, revision, state: 'available', answers: [] });
async function setup(strict = false, boot: QuestionRunProgress | null = null) {
  const reads: string[] = [], pending = deferred<QuestionRunProgress | null>();
  let listener: (p: QuestionRunProgress) => void = () => undefined;
  let refresh: () => void = () => undefined, off = 0, mounted = 0;
  setShellApi({ getQuestionRunProgress: (id: string) => { reads.push(id); return pending.promise; },
    onQuestionRunProgress: (f: typeof listener) => { listener = f; mounted++; return () => { off++; }; },
    onSyncStatus: (f: typeof refresh) => { refresh = f; return () => undefined; }
  } as any);
  let flow!: ReturnType<typeof useQuestionRunProgress>;
  function Fixture({ id }: { id: string | null }) { flow = useQuestionRunProgress(id, boot); return <output>{flow.value?.runId}:{flow.value?.revision}:{flow.value?.state}</output>; }
  const node = (id: string | null) => strict ? <StrictMode><Fixture id={id}/></StrictMode> : <Fixture id={id}/>;
  const h = await mountDom(node('a'));
  return { h, flow: () => flow, reads, pending, counts: () => ({ off, mounted }),
    update: (id: string | null) => h.render(node(id)), emit: (p: QuestionRunProgress) => act(() => listener(p)),
    sync: () => act(() => refresh()), close: async () => { await h.close(); setShellApi(null); } };
}
test('metadata push supersedes an older read and is scoped to the active run', async () => {
  const f = await setup();
  try {
    assert.deepEqual(f.reads, ['a']);
    await f.emit(value('a', 3)); assert.equal(f.flow().value?.revision, 3);
    await act(async () => f.pending.resolve(value('a', 1))); assert.equal(f.flow().value?.revision, 3);
    await f.emit(value('old', 9)); assert.equal(f.flow().value?.runId, 'a');
    await f.update('b'); assert.equal(f.flow().value, null);
    await f.emit(value('a', 10)); assert.equal(f.flow().value, null);
    await f.emit(value('b', 1)); assert.equal(f.flow().value?.runId, 'b');
  } finally { await f.close(); }
});
test('reset drops bootstrap fallback and ignores invalidated replies, without polling', async () => {
  const f = await setup(false, value('a', 2));
  try {
    assert.equal(f.flow().value?.revision, 2);
    await act(() => f.flow().invalidate());
    await act(async () => f.pending.resolve(value('a', 4)));
    await f.update(null); assert.equal(f.flow().value, null);
    assert.deepEqual(f.reads, ['a']);
  } finally { await f.close(); }
});
test('StrictMode resubscribes and sync changes trigger one bounded metadata reread', async () => {
  const f = await setup(true);
  try {
    await f.emit(value('a', 2)); assert.equal(f.flow().value?.revision, 2);
    const before = f.reads.length; await f.sync(); assert.equal(f.reads.length, before + 1);
    assert.equal(f.counts().mounted, 2); assert.equal(f.counts().off, 1);
  } finally { await f.close(); }
  assert.equal(f.counts().off, 2);
});
