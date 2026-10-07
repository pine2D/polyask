import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopDatabase } from '../src/main/database';
import { ArchiveService } from '../src/main/archive-service';
import { QuestionArchiveService } from '../src/main/question-archive-service';
import { questionAnswerId } from '../src/main/question-repository';
import { SITES } from '../src/main/sites';
import { questionFixture, questionAnswerFixture } from './question-fixtures';

function fixture() {
  const db = DesktopDatabase.open(':memory:');
  const question = { ...questionFixture(), sites: ['claude', 'kimi'] as const, text: 'Full prompt\n\n😀 preserved' };
  const first = { ...questionAnswerFixture(), answerMarkdown: '  Old answer\n\n[Source](https://example.com)  ' };
  const latest = { ...questionAnswerFixture(question.id, 2), answerMarkdown: 'Newest answer' };
  const other = { ...first, site: 'kimi' as const, id: questionAnswerId(question.id, 'kimi', 1),
    capture: 'partial' as const, sealedAt: null, submission: 'unconfirmed' as const, truncated: true };
  db.questions.put(question); for (const a of [first, latest, other]) db.questions.putAnswer(a);
  const archives = new ArchiveService(db.archives, { deviceId: () => 'local', now: () => 300, createId: () => 'snapshot' });
  const service = new QuestionArchiveService({ questions: db.questions, archives, sites: SITES });
  const request = { questionId: question.id, answers: [other, first].map(a => ({ answerId: a.id, updatedAt: a.updatedAt })), locale: 'en' };
  return { db, question, first, latest, other, archives, service, request };
}

test('creates an independent exact snapshot of explicitly selected old copies in original site order', () => {
  const f = fixture();
  try {
    const record = f.service.create(f.request);
    assert.equal(record.text, f.question.text); assert.equal(record.task, f.question.text);
    assert.equal(record.source, null);
    assert.deepEqual(record.results.map(r => [r.host, r.text]), [['claude.ai', f.first.answerMarkdown], ['www.kimi.com', f.other.answerMarkdown]]);
    assert.match(record.results[0].label, /Claude.*Attempt 1/);
    assert.match(record.results[1].label, /Send unconfirmed.*Partial answer/);
    assert.equal(record.results[1].code, 'answer_truncated'); assert.equal(record.results[0].state, undefined);
    assert.equal(record.createdAt, 300);
    f.db.questions.delete(f.question.id, 400, 'local');
    assert.deepEqual(f.archives.get(record.id), record, 'history tombstones do not alter the independent result');
  } finally { f.db.close(); }
});

const malformed = [null, { extra: 1 }, { answers: [] }, { locale: 'fr' }, { locale: 'zh' },
  { questionId: '\u0000' }, { answers: [{ answerId: 'x', updatedAt: -1 }] },
  { answers: [{ answerId: 'x', updatedAt: 1, text: 'forged' }] }, { text: 'forged' }];
for (const patch of malformed) test(`rejects malformed selection without any write: ${JSON.stringify(patch)}`, () => {
  const f = fixture();
  try {
    const before = f.db.outbox.count();
    assert.throws(() => f.service.create(patch === null ? null : { ...f.request, ...patch }), /invalid_question/);
    assert.equal(f.archives.search().items.length, 0); assert.equal(f.db.outbox.count(), before);
  } finally { f.db.close(); }
});

for (const kind of ['missing', 'version', 'foreign', 'duplicate', 'same-site', 'empty', 'deleted-parent', 'deleted-child'] as const) {
  test(`rejects entire stale/invalid snapshot (${kind}) without partial archives or outbox`, () => {
    const f = fixture();
    try {
      let request = f.request;
      let code = 'history_not_found';
      if (kind === 'missing') request = { ...request, answers: [...request.answers, { answerId: 'missing', updatedAt: 10 }] };
      if (kind === 'version') request = { ...request, answers: [{ answerId: f.first.id, updatedAt: 11 }] };
      if (kind === 'foreign') { const q = questionFixture('foreign'); f.db.questions.put(q); const a = questionAnswerFixture(q.id); f.db.questions.putAnswer(a); request = { ...request, answers: [{ answerId: a.id, updatedAt: a.updatedAt }] }; }
      if (kind === 'duplicate') { request = { ...request, answers: [request.answers[0], request.answers[0]] }; code = 'invalid_question'; }
      if (kind === 'same-site') { request = { ...request, answers: [f.first, f.latest].map(a => ({ answerId: a.id, updatedAt: a.updatedAt })) }; code = 'invalid_question'; }
      if (kind === 'empty') { const a = { ...f.first, answerMarkdown: null, capturedAt: null, capture: 'unavailable' as const, updatedAt: 20 }; f.db.questions.putAnswer(a, true, 0, true); request = { ...request, answers: [{ answerId: a.id, updatedAt: a.updatedAt }] }; code = 'no_answer'; }
      if (kind === 'deleted-parent') f.db.questions.delete(f.question.id, 100, 'local');
      if (kind === 'deleted-child') { const a = f.first; f.db.questions.putAnswer({ schema: 4, id: a.id, questionId: a.questionId, site: a.site, attempt: a.attempt, createdAt: a.createdAt, updatedAt: 100, deletedAt: 100, deviceId: 'local' }); }
      const before = f.db.outbox.count();
      assert.throws(() => f.service.create(request), new RegExp(code));
      assert.equal(f.archives.search().items.length, 0); assert.equal(f.db.outbox.count(), before);
    } finally { f.db.close(); }
  });
}
