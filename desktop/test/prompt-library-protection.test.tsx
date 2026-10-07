import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { PromptLibrary } from '../src/renderer/prompt-library';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const templates = [{ id: 'plain', name: 'Plain template', text: 'New template question', updatedAt: 1, deviceId: 'a' },
  { id: 'variable', name: 'Variable template', text: 'Ask {{Topic}}', updatedAt: 1, deviceId: 'a' }];
const history = [{ id: 'h', text: 'Recent question', lastUsedAt: 2 }];

for (const entry of ['template', 'recent', 'variable']) test(`${entry} filling protects an existing draft until replacement is confirmed`, async () => {
  const inserted: string[] = [];
  const h = await mountDom(<PromptLibrary copy={copy} draft="Existing work" templates={templates} history={history}
    onInsert={text => inserted.push(text)} onSave={() => undefined} onDelete={() => undefined} />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))!;
  try {
    const selectEntry = async () => {
      if (entry === 'recent') await h.click(button('Recent question'));
      else if (entry === 'template') await h.click(button('Plain template'));
      else {
        await h.click(button('Variable template'));
        await h.input(h.document.querySelector<HTMLTextAreaElement>('[name="template-variable-0"]')!, 'Detailed topic');
        await h.click(button(copy.templateApply));
      }
    };
    await selectEntry();
    assert.deepEqual(inserted, [], 'choosing content cannot silently replace user work');
    assert.ok(h.document.querySelector('[role="dialog"]'), 'replacement has an explicit confirmation');
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions button:not(.primary)')!);
    assert.deepEqual(inserted, [], 'cancel retains the existing draft');
    if (entry === 'variable') await h.click(button(copy.templateApply)); else await selectEntry();
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.deepEqual(inserted, [entry === 'recent' ? 'Recent question' : entry === 'variable' ? 'Ask Detailed topic' : 'New template question']);
  } finally { await h.close(); }
});

test('filling an empty or identical draft requires no redundant confirmation', async () => {
  for (const draft of ['', 'New template question']) {
    const inserted: string[] = [];
    const h = await mountDom(<PromptLibrary copy={copy} draft={draft} templates={templates} history={[]}
      onInsert={text => inserted.push(text)} onSave={() => undefined} onDelete={() => undefined} />);
    try {
      await h.click(h.document.querySelector<HTMLButtonElement>('.prompt-library-item button')!);
      assert.deepEqual(inserted, ['New template question']);
      assert.equal((h.document.querySelector('[role="dialog"]')) === (null), true);
    } finally { await h.close(); }
  }
});

test('failed template save retains its name and permits a deliberate retry', async () => {
  let attempts = 0;
  let finish!: () => void;
  const h = await mountDom(<PromptLibrary copy={copy} draft="Existing work" templates={[]} history={[]}
    onInsert={() => undefined} onSave={() => { attempts++; return new Promise<void>((_, reject) => { finish = () => reject(new Error('write failed')); }); }} onDelete={() => undefined} />);
  try {
    const name = h.document.querySelector<HTMLInputElement>('[name="prompt-template-name"]')!;
    await h.input(name, 'Keep this template name');
    const save = h.document.querySelector<HTMLButtonElement>('.prompt-template-save button')!;
    await h.click(save);
    assert.equal(name.value, 'Keep this template name', 'a pending save has not persisted the template');
    assert.equal(save.disabled, true, 'duplicate saves cannot run concurrently');
    await act(async () => { finish(); await Promise.resolve(); });
    assert.equal(name.value, 'Keep this template name');
    assert.equal(save.disabled, false);
    assert.ok(h.document.querySelector('[role="status"]')?.textContent?.includes(copy.promptLibrarySaveFailed));
    assert.equal(attempts, 1);
  } finally { await h.close(); }
});
