import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshQuestionPages } from '../src/renderer/question-history-refresh';
import type { QuestionFilters, QuestionPage, QuestionSummary } from '../src/shared/question-history';
import { questionFixture } from './question-fixtures';
const row = (id: string, createdAt: number): QuestionSummary => ({ ...questionFixture(id), createdAt, savedSites: 0, answers: [] });
function source(rows: QuestionSummary[]) {
  return async ({ cursor, limit = 50 }: QuestionFilters): Promise<QuestionPage> => {
    const start = cursor ? rows.findIndex(q => q.id === cursor) + 1 : 0;
    const items = rows.slice(start, start + limit);
    return { items, cursor: start + limit < rows.length ? items.at(-1)!.id : null };
  };
}
test('refresh retains the loaded tail when new questions shift it onto a third page', async () => {
  const old = Array.from({ length: 150 }, (_, i) => row(`q${i}`, 1000 - i));
  const current = [row('new', 2000), ...old.filter(q => q.id !== 'q60').map(q => q.id === 'q75' ? { ...q, savedSites: 1 } : q)];
  const result = await refreshQuestionPages(source(current), '', { items: old.slice(0, 100), cursor: 'q99' }, () => true);
  assert.equal(result!.items[0].id, 'new');
  assert.equal(result!.items.some(q => q.id === 'q60'), false);
  assert.equal(result!.items.find(q => q.id === 'q75')!.savedSites, 1);
  assert.ok(result!.items.some(q => q.id === 'q99'));
  const shifted = await refreshQuestionPages(source([row('newer', 3000), ...current]), '', { items: old.slice(0, 100), cursor: 'q99' }, () => true);
  assert.ok(shifted!.items.some(q => q.id === 'q99'));
});
test('refresh terminates after the loaded tail is deleted and keeps the next-page cursor valid', async () => {
  const old = Array.from({ length: 180 }, (_, i) => row(`q${i}`, 1000 - i));
  const result = await refreshQuestionPages(source(old.filter(q => q.id !== 'q99')), '', { items: old.slice(0, 100), cursor: 'q99' }, () => true);
  assert.equal(result!.items.length, 100);
  assert.equal(result!.items.at(-1)!.id, 'q100');
  assert.equal(result!.cursor, 'q100');
});
test('query changes or closing discard an in-flight multipage refresh', async () => {
  let active = true;
  let resolve!: (page: QuestionPage) => void;
  const result = refreshQuestionPages(() => new Promise(done => { resolve = done; }), 'old query', { items: [], cursor: null }, () => active);
  active = false; resolve({ items: [row('stale', 100)], cursor: 'stale' });
  assert.equal(await result, null);
});
test('same-timestamp insertions cannot displace the loaded tail', async () => {
  const old = Array.from({ length: 150 }, (_, i) => row(`q${String(i).padStart(3, '0')}`, 1000));
  const result = await refreshQuestionPages(source([row('new', 1000), ...old]), '', { items: old.slice(0, 100), cursor: 'q099' }, () => true);
  assert.ok(result!.items.some(q => q.id === 'q099'));
});
