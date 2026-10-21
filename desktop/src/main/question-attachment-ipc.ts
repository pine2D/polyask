import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { isStoredQuestion, questionIdValid } from '../shared/question-history';
import type { QuestionReask } from '../shared/question-attachments';
import type { QuestionHistoryService } from './question-history-service';

const channels = ['polyask:question-attachments', 'polyask:question-attachment', 'polyask:question-reask'] as const;
/** Reads accept only opaque question IDs and indices, never a path or renderer supplied bytes. */
export function registerQuestionAttachmentIpc(options: {
  questions: QuestionHistoryService; window: BrowserWindow; trusted: (event: IpcMainInvokeEvent) => boolean;
}): () => void {
  const { questions } = options;
  const parent = (id: unknown) => {
    if (!questionIdValid(id)) throw new Error('invalid_question');
    const value = questions.repository.get(id);
    if (!isStoredQuestion(value) || value.id !== id || 'deletedAt' in value) throw new Error('history_not_found');
    return value;
  };
  const handle = (channel: string, action: (value: any) => unknown) => ipcMain.handle(channel, (event, value) => {
    if (!options.trusted(event)) throw new Error('untrusted_sender');
    try { return action(value); }
    catch (error) {
      if (error instanceof Error && ['invalid_question', 'history_not_found'].includes(error.message)) throw error;
      throw new Error('question_attachments_unavailable');
    }
  });
  handle(channels[0], id => {
    const q = parent(id), manifest = questions.repository.attachments.forQuestion(q.id);
    if (!manifest || 'deletedAt' in manifest) return null;
    if (manifest.questionId !== q.id || manifest.createdAt !== q.createdAt || manifest.images.length !== q.inputImageCount) throw new Error('question_attachments_unavailable');
    return manifest;
  });
  handle(channels[1], value => {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 2 ||
      !Object.keys(value).every(key => ['questionId', 'index'].includes(key)) || !Number.isInteger(value.index)) throw new Error('invalid_question');
    const q = parent(value.questionId);
    if (value.index < 0 || value.index >= q.inputImageCount) throw new Error('invalid_question');
    return questions.repository.attachments.readImage(q.id, value.index);
  });
  handle(channels[2], id => {
    const q = parent(id);
    const images = q.inputImageCount > 0 ? questions.repository.attachments.readAll(q.id) : [];
    if (images.length !== q.inputImageCount) throw new Error('question_attachments_unavailable');
    return { questionId: q.id, text: q.text, images } satisfies QuestionReask;
  });
  questions.setAttachmentSaveFailureHandler(() => {
    if (!options.window.isDestroyed()) options.window.webContents.send('polyask:question-attachment-save-failed');
  });
  return () => { questions.setAttachmentSaveFailureHandler(null); channels.forEach(channel => ipcMain.removeHandler(channel)); };
}
