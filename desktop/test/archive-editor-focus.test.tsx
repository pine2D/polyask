import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { ArchiveSurface, type ArchiveSurfaceProps } from '../src/renderer/archive-surface';
import { registerDecisionNavigationGuard } from '../src/renderer/decision-navigation';
import { setShellApi } from '../src/renderer/shell-api';
import { createArchiveRecord } from '../src/shared/archive';
import { getCopy } from '../src/shared/copy';
import { mountLibrary, waitForInitial } from './ui/library-test-host';
import { withFolderPages } from './ui/library-page-api';

const record = createArchiveRecord({ text: 'Original question', task: 'Original question', createdAt: 1,
  results: [{ host: 'claude.ai', label: 'Claude', text: 'First answer.' },
    { host: 'chatgpt.com', label: 'ChatGPT', text: 'Second answer.' }] }, { id: 'A', now: 1, deviceId: 'test' });
async function fixture(locale = 'en') {
  const copy = getCopy(locale);
  setShellApi(withFolderPages({ listFolders: async () => [], searchFolderContents: async () => [{ kind: 'archive', record }],
    listArchiveTags: async () => [], getArchive: async () => record }) as any);
  const surface = (extra: Partial<ArchiveSurfaceProps> = {}) => <><button id="outside">Outside</button><ArchiveSurface
    copy={copy} locale={locale} preferredId={record.id} sites={[]} synthesisSites={[]} defaultTier={null}
    pendingSynthesis={null} synthesisCandidate={null} onClose={() => {}} onCapture={async () => record}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} {...extra} /></>;
  const h = await mountLibrary(surface());
  await waitForInitial();
  const button = (text: string, scope = '.archive-detail') => [...h.document.querySelectorAll<HTMLButtonElement>(`${scope} button`)]
    .find(node => node.textContent === text)!;
  return { ...h, copy, surface, button };
}

for (const locale of ['zh-CN', 'zh-TW', 'en']) test(`${locale}: explicit synthesis and follow-up entry and close preserve keyboard context`, async () => {
  const h = await fixture(locale);
  try {
    for (const [label, title] of [[h.copy.synthesisAction, h.copy.synthesisTitle], [h.copy.followUpAction, h.copy.followUpTitle]]) {
      const origin = h.button(label); origin.focus();
      const pane = h.document.querySelector<HTMLElement>('.archive-detail-pane')!;
      pane.scrollTop = 245;
      await h.click(origin);
      assert.equal(h.document.activeElement?.tagName, 'H2');
      assert.equal(h.document.activeElement?.textContent, title);
      assert.equal(pane.scrollTop, 0, 'entry starts at the form heading');
      const field = h.document.querySelector<HTMLTextAreaElement>('[name=synthesis-instruction]')!;
      field.focus(); await h.input(field, 'Edited requirements');
      assert.equal(h.document.activeElement === field, true, 'draft updates retain editing focus');
      await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace .panel-close')!);
      assert.equal(h.document.activeElement === h.button(label), true, 'close returns to the recreated entry button');
      assert.equal(pane.scrollTop, 245, 'return retains the original reading position');
    }
  } finally { await h.close(); }
});

test('navigation approval controls focus entry, and background editor requests never steal focus', async () => {
  const h = await fixture();
  let approve: (() => void) | undefined;
  const release = registerDecisionNavigationGuard(action => { approve = action; });
  try {
    const origin = h.button(h.copy.synthesisAction); origin.focus(); await h.click(origin);
    assert.equal(h.document.querySelector('.synthesis-workspace') === null, true);
    assert.equal(h.document.activeElement === origin, true);
    await act(async () => { approve?.(); });
    assert.equal(h.document.activeElement?.tagName, 'H2');
    assert.equal(h.document.activeElement?.textContent, h.copy.synthesisTitle);
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace .panel-close')!);
    h.document.getElementById('outside')!.focus();
    await h.render(h.surface({ synthesisEditorRequest: { archiveId: record.id, revision: 1 } }));
    assert.equal(h.document.querySelector('.synthesis-workspace') !== null, true);
    assert.equal(h.document.activeElement?.id, 'outside');
    await h.click(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace .panel-close')!);
    assert.equal(h.document.activeElement?.id, 'outside', 'background editor also has no stale return target');
  } finally { release(); await h.close(); }
});
