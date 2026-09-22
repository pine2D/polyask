import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import { QuestionHistoryList } from '../src/renderer/question-history-list';
import { getCopy } from '../src/shared/copy';
import { questionFixture, questionAnswerFixture } from './question-fixtures';

type Node = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Node;
  return [element, ...elements(element.props.children)];
}

for (const busy of [false, true]) {
  for (const hasUrl of [false, true]) {
    test(`history card reads a copy without navigation: busy=${busy}, address=${hasUrl}`, () => {
      const question = questionFixture();
      const actions: string[] = [];
      const tree = QuestionHistoryList({ copy: getCopy('zh-CN'), sites: [], busy,
        items: [{ ...question, savedSites: 1, answers: [{ ...questionAnswerFixture(question.id), conversationUrl: hasUrl ? 'https://claude.ai/chat/test' : null }] }],
        onRead: () => actions.push('read'), onRestore: () => actions.push('restore'), onReask: () => actions.push('reask'), onDelete: () => actions.push('delete') });
      const nodes = elements(tree);
      const main = nodes.find(node => node.props.className === 'question-main')!;
      assert.ok(!main.props.disabled, 'reading a saved copy is available during sending');
      main.props.onClick();
      assert.deepEqual(actions, ['read'], 'reading never restores or sends to a site');
      const restore = nodes.find(node => node.props.className === 'question-restore')!;
      assert.ok(restore, 'restoring is an explicit separate action');
      if (busy || !hasUrl) {
        assert.ok(restore.props.disabled || restore.props['aria-disabled']);
        restore.props.onClick?.();
        assert.deepEqual(actions, ['read']);
      } else {
        restore.props.onClick();
        assert.deepEqual(actions, ['read', 'restore']);
      }
    });
  }
}
