import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService } from '../src/main/question-history-service';

for (const code of [undefined, 'submit_unconfirmed'] as const) {
  test(`late generation without an early Stop signal remains observable: ${code ?? 'submitted'}`, () => {
    const db = DesktopDatabase.open(':memory:');
    let now = 1000;
    const history = new QuestionHistoryService(db.questions, { deviceId: () => 'test', now: () => now });
    try {
      const q = history.begin({ runId: 'run', sites: ['doubao'], text: 'Question', tier: 'think', images: [] })!;
      history.result('run', { site: 'doubao', ok: !code, code });
      const token = history.token('doubao')!;
      now = 61_000;
      history.accept('doubao', { token, owned: false, generation: null, text: 'Unowned' });
      assert.equal(history.token('doubao'), token, 'missing Stop must not seal after 45 seconds');
      assert.equal(db.questions.answers(q.id)[0].answerMarkdown, null);
      now = 280_000;
      history.accept('doubao', { token, owned: true, generation: 'generating', text: 'First' });
      now = 895_000;
      history.accept('doubao', { token, owned: true, generation: null, text: 'Final' });
      assert.equal(db.questions.answers(q.id)[0].answerMarkdown, 'Final');
      assert.equal(history.token('doubao'), token);
      now = 901_002;
      history.accept('doubao', { token, owned: true, generation: 'generating', text: 'Last safe copy' });
      assert.equal(history.token('doubao'), undefined, 'late progress must not restart the fifteen-minute budget');
      history.accept('doubao', { token, owned: true, text: 'Too late' });
      assert.equal(db.questions.answers(q.id)[0].answerMarkdown, 'Last safe copy');
    } finally { db.close(); }
  });
}
