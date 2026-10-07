import assert from 'node:assert/strict';
import test from 'node:test';
import { SynthesisWorkspace } from '../src/renderer/synthesis-workspace';
import { SITES } from '../src/main/sites';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const record = { ...archiveFixture(), updatedAt: 100, results: [
  { host: 'claude.ai', label: 'Claude', text: 'Exact claim. Saved surrounding context.' }
] };
const draft = { selectedHosts: ['claude.ai'], targetSite: 'kimi', tier: 'think' as const,
  instruction: 'Keep my question unchanged.', excerpt: 'Exact claim.', sourceChanged: true };
const props = { copy, record, sites: SITES, defaultTier: null, followUpHost: 'claude.ai', busy: false,
  initialDraft: draft, onCancel: () => {}, onSend: () => {} };

test('a changed source blocks sending even when the previous literal quote still appears', async () => {
  const h = await mountDom(<SynthesisWorkspace {...props} />);
  try {
    assert.equal(!!h.document.querySelector('.synthesis-source-changed'), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, true, 'includes alone does not acknowledge changed surrounding material');
  } finally { await h.close(); }
});

test('a source review is explicit and preserves the target, model tier, question and literal quote', async () => {
  const h = await mountDom(<SynthesisWorkspace {...props} />);
  try {
    const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text);
    const review = button('Reload and review source'); assert.equal(!!review, true); await h.click(review!);
    assert.equal(!!h.document.querySelector('.source-review-dialog'), true);
    assert.equal(h.document.querySelector('.source-review-dialog pre')!.textContent === record.results[0].text, true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, true);
    await h.click(button('Use reviewed sources')!);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, false);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=follow-up-excerpt]')!.value, draft.excerpt);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=synthesis-instruction]')!.value, draft.instruction);
    assert.equal(h.document.querySelector('[name=synthesis-target]')!.textContent?.includes('Kimi'), true);
    assert.equal(h.document.querySelector('[name=synthesis-tier]')!.textContent?.includes(copy.think), true);
  } finally { await h.close(); }
});
