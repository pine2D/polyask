import assert from 'node:assert/strict';
import test from 'node:test';
import { getCopy } from '../src/shared/copy';
import { DraftPreview } from '../src/renderer/draft-preview';
import { DraftRecovery } from '../src/renderer/draft-recovery';
import { sortDraftCopies } from '../src/renderer/draft-preview-model';
import type { StoredDraft } from '../src/shared/drafts';
import { mountDom } from './ui/dom-harness';

test('draft previews label decision fields and hide storage identities', async () => {
  const h = await mountDom(<DraftPreview kind="decision" copy={getCopy('en')} content={{ archiveId: 'internal-archive',
    title: 'Choose a route', status: 'verify', conclusion: 'Route A', rationale: 'Less time', uncertainties: 'Weather', nextStep: 'Check forecast',
    evidence: [{ resultIndex: 2, excerpt: 'Exact source words' }] }} />);
  try {
    const text = h.document.body.textContent ?? '';
    assert.match(text, /Conclusion.*Route A.*Rationale.*Less time/s);
    assert.match(text, /Status.*To verify/);
    assert.match(text, /Source answer 3.*Exact source words/);
    assert.equal(text.includes('internal-archive'), false);
    assert.equal(text.includes('resultIndex'), false);
  } finally { await h.close(); }
});

test('comparison and synthesis previews preserve notes and convert enums and sites to labels', async () => {
  const h = await mountDom(<DraftPreview kind="comparison" copy={getCopy('zh-CN')} content={{ judgment: '先核实', nextStep: '查来源',
    quotes: [{ host: 'claude.ai', label: 'Claude', resultIndex: 0, excerpt: '原文摘录' }], categories: { 'claude.ai': ['conditions'] },
    notes: { conclusion: { 'claude.ai': '结论笔记' }, evidence: {}, conditions: { 'claude.ai': '条件笔记' }, cost: {} } }} />);
  try {
    assert.match(h.document.body.textContent ?? '', /结论.*Claude.*结论笔记.*条件.*条件笔记/s);
    assert.equal(h.document.body.textContent!.includes('conditions'), false);
    await h.render(<DraftPreview kind="synthesis" copy={getCopy('zh-TW')} content={{ selectedHosts: ['claude.ai', 'www.kimi.com'],
      targetSite: 'chatgpt', tier: 'think', instruction: '核對差異', excerpt: '逐字原文' }} />);
    const text = h.document.body.textContent ?? '';
    assert.match(text, /Claude.*Kimi.*ChatGPT.*深度思考.*核對差異.*逐字原文/s);
    assert.equal(text.includes('selectedHosts'), false);
    await h.render(<DraftPreview kind="prompt" copy={getCopy('en')} content={{ text: 'My complete prompt' }} />);
    assert.match(h.document.body.textContent ?? '', /Prompt.*My complete prompt/s);
  } finally { await h.close(); }
});

test('draft candidate sorting is newest-first and does not change the caller array', () => {
  const drafts = [{ id: 'old', updatedAt: 5 }, { id: 'latest', updatedAt: 10 }, { id: 'middle', updatedAt: 7 }] as StoredDraft[];
  assert.deepEqual(sortDraftCopies(drafts).map(draft => draft.id), ['latest', 'middle', 'old']);
  assert.deepEqual(drafts.map(draft => draft.id), ['old', 'latest', 'middle']);
});

for (const note of ['', 'Check source limits']) {
  test(`comparison previews retain categories without excerpts (${note ? 'with notes' : 'categories only'})`, async () => {
    const h = await mountDom(<DraftPreview kind="comparison" copy={getCopy('en')} content={{ judgment: '', nextStep: '',
      quotes: [], categories: { 'claude.ai': ['conditions'], 'chatgpt.com': ['cost'] },
      notes: { conclusion: {}, evidence: {}, conditions: { 'claude.ai': note }, cost: {} } }} />);
    try {
      const content = h.document.body.textContent ?? '';
      assert.match(content, /Source categories.*Claude.*Conditions.*ChatGPT.*Costs/s);
      if (note) assert.equal(content.includes(note), true);
      assert.equal(content.includes('claude.ai'), false);
      assert.equal(content.includes('conditions'), false);
    } finally { await h.close(); }
  });
}

test('recovery lists newest copies first and keeps the exact count in the icon trigger name', async () => {
  const copy = getCopy('en');
  const base: StoredDraft = { format: 1, id: 'older', updatedAt: 5, deviceId: 'local', kind: 'prompt',
    context: 'composer', title: 'Older copy', content: { text: 'Older words' } };
  const h = await mountDom(<DraftRecovery copy={copy} compact trigger={<span aria-hidden="true">Icon</span>}
    drafts={[base, { ...base, id: 'newer', title: 'Newer copy', updatedAt: 10 }]} deviceId="local"
    onRestore={() => true} onRemove={async () => true} />);
  try {
    const trigger = h.document.querySelector<HTMLButtonElement>('[data-draft-open]')!;
    assert.equal(trigger.getAttribute('aria-label'), 'Saved drafts (2)');
    assert.equal(trigger.querySelector('.draft-copy-badge')!.textContent, '2');
    assert.equal(trigger.querySelector('.draft-copy-badge')!.getAttribute('aria-hidden'), 'true');
    await h.click(trigger);
    assert.equal(h.document.querySelector('.draft-copy-list > li > span')!.textContent, 'Newer copy');
  } finally { await h.close(); }
});
