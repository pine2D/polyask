import assert from 'node:assert/strict';
import { useState } from 'react';
import test from 'node:test';
import { DecisionEditor } from '../src/renderer/decision-editor';
import type { DecisionInput } from '../src/shared/decision';
import { mountDom } from './ui/dom-harness';
import { copy, decision, record } from './ui/library-test-host';

const base: DecisionInput = { archiveId: decision.archiveId, title: 't', conclusion: '', rationale: '', uncertainties: '', nextStep: '',
  status: 'draft', evidence: [{ id:'a', topic:'Cost', resultIndex: 0, excerpt: 'first excerpt' }, { id:'b', topic:'Cost', resultIndex: 0, excerpt: 'second excerpt' }] };

function Host() {
  const [value, setValue] = useState(base);
  return <DecisionEditor copy={copy} value={value} saved={null} source={record} sourceFailed={false} editing busy={false}
    onChange={setValue} onOpenSource={() => {}} />;
}

test('removing a middle evidence item keeps each remaining excerpt textarea bound to its own evidence', async () => {
  const h = await mountDom(<Host />);
  try {
    const second = h.document.querySelector<HTMLTextAreaElement>('[name="decision-evidence-1"]')!;
    assert.equal(second.value, 'second excerpt');
    const remove = h.document.querySelector<HTMLButtonElement>('.decision-excerpt header button')!;
    await h.click(remove);
    const only = h.document.querySelector<HTMLTextAreaElement>('[name="decision-evidence-0"]')!;
    assert.equal(only.value, 'second excerpt');
    assert.equal(only === second, true, 'the DOM node follows the evidence item, not its list position');
  } finally { await h.close(); }
});

test('reading mode renders each evidence passage once while keeping grouped source review', async()=>{
  const h=await mountDom(<DecisionEditor copy={copy} value={base} saved={null} source={record} sourceFailed={false}
    editing={false} busy={false} onChange={()=>{}} onOpenSource={()=>{}} />);
  try {
    assert.equal(h.document.querySelectorAll('blockquote').length,2);
    assert.equal(h.document.querySelectorAll('[data-evidence-topic=Cost] button').length,2);
  } finally {await h.close();}
});

test('a source version change is visible before editing and requires explicit reviewed-source adoption', async()=>{
  const value={...base,sourceUpdatedAt:record.updatedAt-1};
  let changed:DecisionInput|null=null;
  const h=await mountDom(<DecisionEditor copy={copy} value={value} saved={null} source={record} sourceFailed={false}
    editing busy={false} onChange={v=>{changed=v;}} onOpenSource={()=>{}} />);
  try {
    assert.equal(h.document.querySelector('.decision-source')?.textContent?.includes(copy.manualSourceChanged),true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('[data-evidence-use-reviewed]')?.disabled,true,'unmatched old quotes cannot adopt a new source');
  } finally {await h.close();}
});
