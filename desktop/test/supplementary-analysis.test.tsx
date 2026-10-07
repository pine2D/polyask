import assert from 'node:assert/strict';
import test from 'node:test';
import { ArchiveSynthesis } from '../src/renderer/archive-synthesis';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en'), record = { ...archiveFixture(), synthesis: null };
const pending = { archiveId: record.id, targetSite: 'claude' as const, targetHost: 'claude.ai', tier: 'think' as const,
  instruction: 'The request at that time.\r\nKeep exact details 😀', sentAt: 100 };
const candidate = { host: 'claude.ai', text: 'Unverified supplementary answer', state: 'think' as const,
  instruction: pending.instruction, createdAt: 200 };
const noop = () => {};

test('submitted analysis reports waiting and not saved with the exact request available on demand', async () => {
  let collections = 0;
  const h = await mountDom(<ArchiveSynthesis copy={copy} record={record} pending={pending} candidate={null} busy={false}
    onCollect={() => { collections++; }} onSave={noop} />);
  try {
    const stage = h.document.querySelector('[data-analysis-stage=submitted]');
    assert.equal(!!stage, true, 'submitted stage distinguishes waiting from a saved result');
    assert.equal(stage!.textContent?.includes('not saved'), true);
    const request = h.document.querySelector<HTMLDetailsElement>('details.analysis-requirement');
    assert.equal(!!request, true); assert.equal(request!.open, false);
    await h.click(request!.querySelector<HTMLElement>('summary')!);
    assert.equal(request!.querySelector('pre')!.textContent === pending.instruction, true);
    assert.equal(collections, 0, 'reading a request never starts collection');
    assert.equal(h.document.querySelectorAll('[role=progressbar]').length, 0);
  } finally { await h.close(); }
});

test('collected analysis requires verification and allows an explicit collection again without saving', async () => {
  let collections = 0, saves = 0;
  const h = await mountDom(<ArchiveSynthesis copy={copy} record={record} pending={pending} candidate={candidate} busy={false}
    onCollect={() => { collections++; }} onSave={() => { saves++; }} />);
  try {
    assert.equal(!!h.document.querySelector('[data-analysis-stage=collected]'), true);
    assert.equal(h.document.querySelector('.synthesis-card.pending')!.textContent?.includes('Review before saving'), true);
    const again = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Collect again');
    assert.equal(!!again, true); await h.click(again!);
    assert.equal(collections, 1); assert.equal(saves, 0);
    assert.equal(h.document.querySelector('.synthesis-card.pending')!.textContent?.includes(copy.citationReportNotice), true);
  } finally { await h.close(); }
});

test('reopened saved analysis uses a neutral name and retains its original request, site, tier and time', async () => {
  const h = await mountDom(<ArchiveSynthesis copy={copy} record={{ ...record, synthesis: candidate }} pending={null} candidate={null}
    busy={false} onCollect={noop} onSave={noop} />);
  try {
    assert.equal(!!h.document.querySelector('[data-analysis-stage=saved]'), true);
    assert.equal(h.document.querySelector('.synthesis-card.saved h2')!.textContent, 'Saved supplementary analysis');
    assert.equal(h.document.querySelector('.synthesis-card.saved header')!.textContent?.includes('claude.ai'), true);
    assert.equal(h.document.querySelector('.synthesis-card.saved header')!.textContent?.includes(copy.think), true);
    assert.equal(h.document.querySelector('.synthesis-card.saved time')?.getAttribute('datetime'), new Date(candidate.createdAt).toISOString());
    assert.equal(h.document.querySelector('details.analysis-requirement pre')?.textContent === pending.instruction, true);
  } finally { await h.close(); }
});

test('legacy analysis with an empty saved request does not invent default synthesis instructions', async () => {
  const h = await mountDom(<ArchiveSynthesis copy={copy} record={{ ...record, synthesis: { ...candidate, instruction: '' } }}
    pending={null} candidate={null} busy={false} onCollect={noop} onSave={noop} />);
  try {
    assert.equal(!!h.document.querySelector('[data-analysis-stage=saved]'), true);
    assert.equal(h.document.querySelector('details.analysis-requirement')?.textContent?.includes('The request was not recorded.'), true);
    assert.equal(h.document.querySelector('details.analysis-requirement')?.textContent?.includes(copy.synthesisDefaultInstruction), false);
  } finally { await h.close(); }
});
