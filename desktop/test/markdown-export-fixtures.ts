import type { MarkdownDocument, MarkdownEntry } from '../src/shared/markdown-export';
export const entry = (id: string, site: string, extra: Partial<MarkdownEntry> = {}): MarkdownEntry => ({
  id, site, label: site === 'claude' ? 'Claude' : 'ChatGPT', kind: 'answer', available: true,
  capturedAt: 1000, state: 'complete', truncated: false, ...extra
});
export const documentFixture = (id: string, entries: MarkdownEntry[], extra: Partial<MarkdownDocument> = {}): MarkdownDocument => ({
  target: { kind: 'history', id }, revision: '', title: `Question ${id}`, createdAt: 1000, updatedAt: 1000, deviceId: 'device-a', entries, ...extra
});
export const exportDocuments = () => [
  documentFixture('q1', [entry('old', 'claude', { attempt: 1, latestAttempt: 3 }), entry('new', 'claude', { attempt: 2, latestAttempt: 3 }),
    entry('empty', 'claude', { attempt: 3, latestAttempt: 3, available: false }), entry('g1', 'chatgpt', { attempt: 1 })]),
  documentFixture('q2', [entry('c2', 'claude', { attempt: 1 }), entry('g2', 'chatgpt', { attempt: 1 })], { createdAt: 2000 })
];
