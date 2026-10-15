import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { ArchiveMetadata } from '../src/renderer/archive-metadata';
import { createArchiveRecord, updateArchiveRecord, type ArchivePatch } from '../src/shared/archive';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const record = createArchiveRecord({ text: 'Saved question', task: 'Saved question', results: [] }, { id: 'note', now: 1, deviceId: 'fixture' });
for (const locale of ['en', 'zh-CN', 'zh-TW']) {
  test(`${locale}: overlong notes remain editable and never reach the save callback`, async () => {
    let writes = 0;
    const h = await mountDom(<ArchiveMetadata record={record} copy={getCopy(locale)} busy={false} onSave={async () => { writes++; return true; }} />);
    try {
      await h.click(h.document.querySelector('summary')!);
      const field = h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!;
      const value = '😀'.repeat(4001);
      await h.input(field, value);
      await h.click(h.document.querySelector<HTMLButtonElement>('button[type=submit]')!);
      assert.equal(writes, 0, 'over-limit content is rejected next to the field');
      assert.equal(field.value, value, 'the full input is preserved');
      assert.equal(field.getAttribute('aria-invalid'), 'true');
      assert.equal(h.document.activeElement === field, true);
      const help = field.getAttribute('aria-describedby')!.split(' ').map(id => h.document.getElementById(id)?.textContent).join(' ');
      assert.match(help, /4[,.]?001|4001/);
      assert.match(help, /4[,.]?000|4000/);
    } finally { await h.close(); }
  });

  test(`${locale}: a 4000-codepoint note survives save failure and can be retried once`, async () => {
    const value = '😀'.repeat(3991) + '备注 مرحبا🌍';
    assert.equal([...value].length, 4000);
    const pending: { patch: ArchivePatch; finish: (result: boolean) => void }[] = [];
    const h = await mountDom(<ArchiveMetadata record={record} copy={getCopy(locale)} busy={false}
      onSave={patch => new Promise(resolve => pending.push({ patch, finish: resolve }))} />);
    try {
      await h.click(h.document.querySelector('summary')!);
      const field = h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!;
      await h.input(field, value);
      const submit = h.document.querySelector<HTMLButtonElement>('button[type=submit]')!;
      await act(async () => { for (let i = 0; i < 10; i++) submit.click(); });
      assert.equal(pending.length, 1);
      assert.equal(updateArchiveRecord(record, pending[0].patch, { now: 2, deviceId: 'fixture' }).note, value);
      await act(async () => pending[0].finish(false));
      assert.equal(field.value, value);
      assert.equal(h.document.querySelector('[role=status]')!.textContent, getCopy(locale).archiveMetadataSaveFailed);
      await h.click(submit);
      assert.equal(pending.length, 2);
      await act(async () => pending[1].finish(true));
      assert.equal(field.value, value);
    } finally { await h.close(); }
  });
}
