import type { QuestionFilters, QuestionPage, QuestionSummary } from '../shared/question-history';

// Re-read through the loaded tail, rather than only the first page. New rows must
// not push an already visible record out of the refreshed window.
export async function refreshQuestionPages(
  list: (filters: QuestionFilters) => Promise<QuestionPage>, query: string,
  previous: QuestionPage, current: () => boolean,
): Promise<QuestionPage | null> {
  const tail = previous.items.at(-1);
  const items: QuestionSummary[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await list({ query, cursor, limit: 50 });
    if (!current()) return null;
    for (const item of result.items) if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
    const last = result.items.at(-1);
    const reachedTail = !tail || seen.has(tail.id) || (last && last.createdAt < tail.createdAt);
    if (!result.cursor || (items.length >= previous.items.length && reachedTail)) return { items, cursor: result.cursor };
    cursor = result.cursor;
  } while (true);
}
