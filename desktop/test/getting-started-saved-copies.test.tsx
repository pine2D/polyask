import assert from 'node:assert/strict';
import test from 'node:test';
import { GettingStarted } from '../src/renderer/getting-started';
import { COMMANDS } from '../src/shared/commands';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

test('the fourth guide step opens saved question copies and never samples current site pages', async () => {
  const actions: string[] = [];
  const h = await mountDom(<GettingStarted copy={getCopy('en')} commands={COMMANDS} onExecute={id => actions.push(id)} />);
  try {
    assert.deepEqual(actions, []);
    const steps = h.document.querySelectorAll('.getting-started-step');
    assert.equal(steps.length, 4);
    const button = steps[3].querySelector<HTMLButtonElement>('button');
    assert.equal(button === null, false);
    await h.click(button!);
    assert.deepEqual(actions, ['open-question-history'], 'saved-answer reading must not call collect-compare');
  } finally { await h.close(); }
});
