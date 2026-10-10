import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { FolderSidebar } from '../src/renderer/folder-sidebar';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('zh-CN');
const folder = {id: 'fixture-folder', name: 'Existing', schema: 3, createdAt: 1, updatedAt: 1, deviceId: 'fixture-device'} as const;

async function mount(mode: 'new' | 'rename', fail = false) {
  const calls: string[] = [];
  let changes = 0;
  setShellApi({
    createFolder: async (name: string) => { calls.push(`create:${name}`); if (fail) throw new Error('fixture'); return {...folder, name}; },
    renameFolder: async (id: string, name: string) => { calls.push(`rename:${id}:${name}`); if (fail) throw new Error('fixture'); return {...folder, name}; }
  } as any);
  const h = await mountDom(React.createElement(FolderSidebar, { copy, folders: [folder], selected: mode === 'rename' ? folder.id : '',
    onSelect: () => {}, onChanged: () => { changes++; }}));
  const opener = mode === 'rename' ? h.document.querySelector<HTMLButtonElement>('.folder-manage button')! :
    [...h.document.querySelectorAll<HTMLButtonElement>('.folder-sidebar > button')].find(button => button.textContent?.includes(copy.folderNew))!;
  await h.click(opener);
  const input = h.document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  const key = async (key: string, extra: KeyboardEventInit = {}) => {
    const event = new h.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...extra});
    await act(async () => input.dispatchEvent(event));
    return event;
  };
  return {...h, nameInput: input, calls, changes: () => changes, key, async close() {await h.close(); setShellApi(null);}};
}

for (const mode of ['new', 'rename'] as const) {
  for (const extra of [{isComposing: true}, {keyCode: 229}]) {
    test(`${mode} ignores IME Enter ${JSON.stringify(extra)}`, async () => {
      const h = await mount(mode);
      try {
        await h.input(h.nameInput, '未完成的候选');
        assert.equal(h.nameInput.value, '未完成的候选');
        const event = await h.key('Enter', extra);
        assert.equal(h.calls.length, 0, 'candidate confirmation must not save the folder');
        assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
        assert.equal(h.changes(), 0);
        assert.equal(h.nameInput.value, '未完成的候选');
        assert.equal(event.defaultPrevented, false);
        await h.key('Enter');
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0], mode === 'new' ? 'create:未完成的候选' : 'rename:fixture-folder:未完成的候选');
        assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
        assert.equal(h.changes(), 1);
      } finally {await h.close();}
    });
  }
}

test('controls: IME Escape retains name, ordinary Enter saves, failed save retains name and reports failure', async () => {
  const h = await mount('new', true);
  try {
    await h.input(h.nameInput, '保留的文件夹名称');
    for (const extra of [{isComposing: true}, {keyCode: 229}]) {
      const event = await h.key('Escape', extra);
      assert.equal(h.calls.length, 0);
      assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
      assert.equal(event.defaultPrevented, false);
    }
    await h.key('Enter');
    assert.equal(h.calls.length, 1);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    assert.equal(h.nameInput.value, '保留的文件夹名称');
    assert.equal(h.document.querySelector('[role="dialog"] [role="status"]')?.textContent, copy.folderFailed);
    assert.equal(h.changes(), 0);
    assert.equal(h.nameInput.disabled, false);
    await h.key('Escape');
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
  } finally {await h.close();}
});
