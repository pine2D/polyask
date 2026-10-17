import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ArchiveMetadata } from '../src/renderer/archive-metadata';
import { FolderMembershipDialog } from '../src/renderer/folder-membership-dialog';
import { DecisionWorkspace } from '../src/renderer/decision-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
type Kind = 'metadata' | 'create' | 'membership' | 'decision';
async function start(kind: Kind) {
  const record = archiveFixture();
  let fail: () => void = () => { throw new Error('save was not started'); };
  const pending = () => new Promise<never>((_resolve, reject) => { fail = () => reject(new Error('synthetic_failure')); });
  setShellApi({ getArchive: async () => record, folderMemberships: async () => [], createFolder: pending,
    patchFolderMemberships: pending, createDecision: pending } as any);
  const content = kind === 'metadata' ? <ArchiveMetadata record={record} copy={copy} busy={false} onSave={pending} />
    : kind === 'decision' ? <DecisionWorkspace embedded copy={copy} locale="en" initialSource={record} onArchives={() => {}} onClose={() => {}} />
    : <FolderMembershipDialog copy={copy} targetTitle={record.task} target={{ kind: 'archive', id: record.id }}
      folders={[{ id: 'folder', name: 'Existing', schema: 3, deviceId: 'fixture', createdAt: 1, updatedAt: 1 }]} onCancel={() => {}} onSaved={() => {}} />;
  const h = await mountDom(<>{content}<button id="outside">Outside action</button></>);
  let button: HTMLButtonElement;
  if (kind === 'metadata') {
    h.document.querySelector<HTMLDetailsElement>('details')!.open = true;
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep these notes.');
    button = h.document.querySelector<HTMLButtonElement>('button[type=submit]')!;
  } else if (kind === 'create') {
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === copy.folderNew)!);
    await h.input(h.document.querySelector<HTMLInputElement>('[name=folder-membership-name]')!, 'Keep this folder name');
    button = h.document.querySelector<HTMLButtonElement>('[data-action=create-folder]')!;
  } else if (kind === 'membership') {
    await h.click(h.document.querySelector<HTMLInputElement>('input[type=checkbox]')!);
    button = h.document.querySelector<HTMLButtonElement>('[data-action=save-memberships]')!;
  } else {
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=decision-rationale]')!, 'Keep this rationale.');
    button = h.document.querySelector<HTMLButtonElement>('.decision-detail-actions .library-primary')!;
  }
  button.focus(); await h.click(button);
  assert.equal(button.disabled, true, 'pending submission blocks duplicates');
  // jsdom does not reproduce Chromium moving focus to BODY when disabling a control.
  h.document.body.tabIndex = -1; h.document.body.focus();
  assert.equal(h.document.activeElement === h.document.body, true);
  return { ...h, button, fail: async () => { await act(async () => fail()); },
    async close() { await h.close(); setShellApi(null); } };
}

for (const kind of ['metadata', 'create', 'membership', 'decision'] as const) test(`${kind} failure restores the disabled action for keyboard retry`, async () => {
  const h = await start(kind);
  try {
    await h.fail();
    assert.equal(h.document.activeElement === h.button, true);
    assert.equal(h.button.disabled, false);
    const retained = kind === 'metadata' ? h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value
      : kind === 'create' ? h.document.querySelector<HTMLInputElement>('[name=folder-membership-name]')!.value
      : kind === 'decision' ? h.document.querySelector<HTMLTextAreaElement>('[name=decision-rationale]')!.value
      : String(h.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked);
    assert.equal(retained, kind === 'metadata' ? 'Keep these notes.' : kind === 'create' ? 'Keep this folder name' : kind === 'decision' ? 'Keep this rationale.' : 'true');
  } finally { await h.close(); }
});

for (const intent of ['focus', 'Tab', 'pointer', 'blur'] as const) test(`failure does not reclaim focus after the user moves away by ${intent}`, async () => {
  const h = await start('metadata');
  try {
    if (intent === 'focus') { const outside = h.document.getElementById('outside')!; outside.focus(); outside.blur(); }
    else if (intent === 'Tab') h.document.body.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    else if (intent === 'pointer') h.document.body.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true }));
    else h.window.dispatchEvent(new h.window.Event('blur'));
    await h.fail();
    assert.equal(h.document.activeElement === h.document.body, true, 'late failure respects the newer navigation intent');
  } finally { await h.close(); }
});
