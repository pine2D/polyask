import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import * as historyTypes from '../src/shared/question-history';
import { questionFixture } from './question-fixtures';
import { originals } from './lib/history-image-fixtures';
import type { QuestionAttachmentsManifest, QuestionReask } from '../src/shared/question-attachments';

function setup() {
  const handlers = new Map<string, (event: unknown, value?: unknown) => any>();
  const exported = { exports: {} as { registerQuestionAttachmentIpc(options: unknown): () => void } };
  runInNewContext(transformSync(readSource('src/main/question-attachment-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    Error, module: exported, exports: exported.exports, require: (name: string) => {
      if (name === '../shared/question-history') return historyTypes;
      assert.equal(name, 'electron');
      return { ipcMain: { handle: (key: string, fn: any) => handlers.set(key, fn), removeHandler: (key: string) => handlers.delete(key) } };
    }
  });
  const db = DesktopDatabase.open(':memory:'), services = createLocalDataServices(db), events: string[] = [];
  const dispose = exported.exports.registerQuestionAttachmentIpc({ ...services, trusted: (event: unknown) => event === 'shell',
    window: { isDestroyed: () => false, webContents: { send: (channel: string) => events.push(channel) } } });
  const invoke = (channel: string, value: unknown, sender: unknown = 'shell') => handlers.get(`polyask:${channel}`)!(sender, value);
  return { db, services, invoke, events, close() { dispose(); assert.equal(handlers.size, 0); db.close(); } };
}

test('trusted attachment reads return only metadata or indexed bytes owned by a live question', () => {
  const h = setup();
  try {
    const q = { ...questionFixture(), inputImageCount: 4 }; h.db.questions.put(q); h.db.questionAttachments.save(q, originals);
    h.db.questions.put({ ...q, id: 'another-question' });
    const before = h.db.outbox.count();
    for (const channel of ['question-attachments', 'question-reask', 'question-attachment']) {
      assert.throws(() => h.invoke(channel, q.id, 'site'), /untrusted_sender/);
      for (const id of ['missing', '../../file.png', 'https://example.com/image', {}, null])
        assert.throws(() => h.invoke(channel, channel === 'question-attachment' ? { questionId: id, index: 0 } : id));
    }
    const metadata = h.invoke('question-attachments', q.id) as QuestionAttachmentsManifest;
    assert.equal(metadata.images.length, 4); assert.equal(JSON.stringify(metadata).includes('dataUrl'), false);
    assert.equal(JSON.stringify(metadata).includes('base64'), false);
    const forQuestion = h.db.questionAttachments.forQuestion.bind(h.db.questionAttachments);
    h.db.questionAttachments.forQuestion = () => ({ ...metadata, questionId: 'foreign-question' });
    assert.throws(() => h.invoke('question-attachments', q.id), /question_attachments_unavailable/);
    h.db.questionAttachments.forQuestion = forQuestion;
    assert.throws(() => h.invoke('question-attachment', { questionId: 'another-question', index: 0 }), /question_attachments_unavailable/);
    for (const index of [-1, 4, 0.5, '0', null]) assert.throws(() => h.invoke('question-attachment', { questionId: q.id, index }));
    assert.throws(() => h.invoke('question-attachment', { questionId: q.id, index: 0, path: '/tmp/test' }));
    assert.equal(h.invoke('question-attachment', { questionId: q.id, index: 2 }).dataUrl, originals[2].dataUrl);
    const restored = h.invoke('question-reask', q.id) as QuestionReask;
    assert.equal(restored.text, q.text); assert.deepEqual(Array.from(restored.images, i => i.name), originals.map(i => i.name));
    assert.equal(h.db.outbox.count(), before, 'reads and reask perform no send or write');
    h.services.questions.delete(q.id);
    for (const channel of ['question-attachments', 'question-reask', 'question-attachment'])
      assert.throws(() => h.invoke(channel, channel === 'question-attachment' ? { questionId: q.id, index: 0 } : q.id), /history_not_found/);
  } finally { h.close(); }
});

test('strict reask refuses missing and corrupt originals while zero-image history needs no set', () => {
  const h = setup();
  try {
    h.db.questions.put(questionFixture('text'));
    assert.equal(h.invoke('question-reask', 'text').images.length, 0);
    const q = { ...questionFixture(), inputImageCount: 4 }; h.db.questions.put(q);
    assert.equal(h.invoke('question-attachments', q.id), null);
    assert.throws(() => h.invoke('question-reask', q.id), /question_attachments_unavailable/);
    const read = h.db.questionAttachments.readAll;
    h.db.questionAttachments.readAll = () => { throw new Error('/private/path/secret'); };
    assert.throws(() => h.invoke('question-reask', q.id), /^Error: question_attachments_unavailable$/);
    h.db.questionAttachments.readAll = () => originals.slice(0, 2);
    assert.throws(() => h.invoke('question-reask', q.id), /question_attachments_unavailable/, 'partial sets never become successful drafts');
    h.db.questionAttachments.readAll = read;
    h.db.resetLocalData();
    assert.throws(() => h.invoke('question-reask', q.id), /history_not_found/);
  } finally { h.close(); }
});

test('attachment save failure has a separate event and preserves the saved question', () => {
  const h = setup();
  try {
    // The registration installs the existing dedicated handler; exercise it via an actual failing save.
    h.db.questionAttachments.save = () => { throw new Error('disk full'); };
    h.services.questions.begin({ runId: 'run-image', text: 'question', sites: ['claude'], tier: null, images: originals });
    assert.deepEqual(h.events, ['polyask:question-attachment-save-failed']);
    assert.equal(h.db.questions.search().items.length, 1);
  } finally { h.close(); }
});
