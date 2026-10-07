import type { ArchiveRecord } from '../shared/archive';
import type { SiteDefinition } from '../shared/contracts';
import type { ArchiveService } from './archive-service';
import type { QuestionRepository } from './question-repository';
import { projectQuestionArchiveInput, type QuestionArchiveRequest } from '../shared/question-archive';
import { isStoredQuestion, isStoredQuestionAnswer, questionIdValid } from '../shared/question-history';
import { validSyncTime } from '../shared/sync';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every(key => keys.includes(key));
function request(value: unknown): QuestionArchiveRequest {
  if (!object(value) || !only(value, ['questionId', 'answers', 'locale']) || !questionIdValid(value.questionId) ||
    !['en', 'zh-CN', 'zh-TW'].includes(String(value.locale)) || !Array.isArray(value.answers) ||
    value.answers.length < 1 || value.answers.length > 9) throw new Error('invalid_question');
  const ids = new Set<string>();
  for (const item of value.answers) {
    if (!object(item) || !only(item, ['answerId', 'updatedAt']) || !questionIdValid(item.answerId) ||
      !validSyncTime(item.updatedAt) || ids.has(item.answerId)) throw new Error('invalid_question');
    ids.add(item.answerId);
  }
  return value as unknown as QuestionArchiveRequest;
}

export class QuestionArchiveService {
  constructor(private readonly options: {
    questions: QuestionRepository; archives: Pick<ArchiveService, 'add'>; sites: readonly SiteDefinition[];
  }) {}
  create(value: unknown): ArchiveRecord {
    const selection = request(value);
    // Synchronous reads and add share the main event turn; no live-site capture or navigation occurs.
    const question = this.options.questions.get(selection.questionId);
    if (!question || !isStoredQuestion(question) || 'deletedAt' in question) throw new Error('history_not_found');
    const seenSites = new Set<string>();
    const answers = selection.answers.map(item => {
      const answer = this.options.questions.getAnswer(item.answerId);
      if (!answer || !isStoredQuestionAnswer(answer) || 'deletedAt' in answer || answer.questionId !== question.id ||
        !question.sites.includes(answer.site) || answer.updatedAt !== item.updatedAt) throw new Error('history_not_found');
      if (seenSites.has(answer.site)) throw new Error('invalid_question');
      seenSites.add(answer.site);
      if (!answer.answerMarkdown?.trim()) throw new Error('no_answer');
      return answer;
    });
    return this.options.archives.add(projectQuestionArchiveInput(question, answers, this.options.sites, selection.locale));
  }
}
