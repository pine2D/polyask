import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService } from '../src/main/question-history-service';
import { normalizeHistorySnapshot } from '../src/shared/question-capture';

function fixture() {
  const db = DesktopDatabase.open(':memory:');
  let now = 1000;
  const history = new QuestionHistoryService(db.questions, { deviceId: () => 'test', now: () => now });
  const q = history.begin({ runId: 'run', sites: ['gemini'], text: 'Question', tier: null, images: [] })!;
  history.result('run', { site: 'gemini', ok: true });
  const token = history.token('gemini')!;
  const accept = (value: object) => history.accept('gemini', normalizeHistorySnapshot({ token, ...value }, token));
  return { db, history, q, token, accept, at: (value: number) => { now = value; } };
}

test('delayed user rendering saves only the later owned answer within the fixed observation budget', () => {
  const s = fixture();
  try {
    s.at(6000);
    s.accept({ owned: false, generation: 'generating', text: 'Unattributed', url: 'https://gemini.google.com/app/old' });
    assert.equal(s.db.questions.answers(s.q.id)[0].answerMarkdown, null);
    assert.equal(s.db.questions.answers(s.q.id)[0].conversationUrl, null);
    s.at(61_000); s.accept({ owned: false });
    assert.equal(s.history.token('gemini'), s.token);
    s.at(120_000); s.accept({ owned: true, text: 'Delayed owned answer' });
    assert.equal(s.db.questions.answers(s.q.id)[0].answerMarkdown, 'Delayed owned answer');
    s.at(901_002); s.accept({ owned: true, text: 'Final answer' });
    assert.equal(s.history.token('gemini'), undefined, 'owned progress must not extend the budget again');
    assert.equal(s.db.questions.answers(s.q.id)[0].capture, 'unknown');
  } finally { s.db.close(); }
});

for (const state of ['idle', 'complete', null]) {
  test(`unowned ${state} cannot attribute text or restart observation`, () => {
    const s = fixture();
    try {
      s.at(6000); s.accept({ owned: false, generation: state, text: 'Wrong' });
      s.at(61_000); s.accept({ owned: false });
      assert.equal(s.history.token('gemini'), s.token);
      s.at(901_002); s.accept({ owned: false, generation: state });
      assert.equal(s.history.token('gemini'), undefined);
      assert.equal(s.db.questions.answers(s.q.id)[0].capture, 'unavailable');
      assert.equal(s.db.questions.answers(s.q.id)[0].answerMarkdown, null);
    } finally { s.db.close(); }
  });
}

test('ended or mismatched-token generation cannot prolong capture beyond its fixed budget', () => {
  for (const override of [{ ended: true }, { token: 'old' }]) {
    const s = fixture();
    try {
      s.at(6000); s.accept({ owned: false, generation: 'generating', ...override });
      s.at(901_002); s.accept({ owned: false });
      assert.equal(s.history.token('gemini'), undefined);
      assert.equal(s.db.questions.answers(s.q.id)[0].answerMarkdown, null);
    } finally { s.db.close(); }
  }
});
