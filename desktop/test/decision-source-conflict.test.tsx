import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { DesktopDatabase } from '../src/main/database';
import { ArchiveService } from '../src/main/archive-service';
import { DecisionService } from '../src/main/decision-service';
import { DecisionWorkspace } from '../src/renderer/decision-workspace';
import { decisionInput } from '../src/renderer/decision-editor';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { ArchiveRecord } from '../src/shared/archive';
import { mountDom } from './ui/dom-harness';

for (const mode of ['refresh', 'failed-refresh', 'late-initial'] as const) {
  test(`decision save conflict preserves edits and requires explicit source adoption: ${mode}`, async () => {
    const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', 'local');
    const archives = new ArchiveService(db.archives, {deviceId:()=> 'local', now:()=>100, createId:()=> 'source'});
    const source = archives.add({text:'Question',task:'Question', results:[{host:'claude.ai',label:'Claude',text:'First excerpt. Second excerpt.'}]});
    const decisions = new DecisionService(db.decisions, archives, {deviceId:()=> 'local',now:()=>200,createId:()=> 'card'});
    const card = decisions.create({archiveId:source.id,sourceUpdatedAt:100,title:'Card',conclusion:'',rationale:'',uncertainties:'',nextStep:'',status:'draft',
      evidence:[{id:'first',topic:'Cost',resultIndex:0,excerpt:'First excerpt.'},{id:'second',topic:'Cost',resultIndex:0,excerpt:'Second excerpt.'}]});
    let reads=0, resolveLate: ((record: ArchiveRecord) => void) | undefined;
    const copy = getCopy('en');
    setShellApi({getArchive:async()=>{
      reads++;
      if (mode==='late-initial' && reads===1 || mode==='failed-refresh' && reads===3)
        return new Promise<ArchiveRecord>(resolve=>{resolveLate=resolve;});
      if (mode==='failed-refresh' && reads===2) throw new Error('read_failed');
      return archives.get(source.id);
    }, updateDecision:async(id:string,input:unknown)=>{
      try { return decisions.update(id,input); }
      catch(error) { throw new Error(`Error invoking remote method 'polyask:decision-update': Error: ${(error as Error).message}`); }
    }} as any);
    const h = await mountDom(<DecisionWorkspace embedded copy={copy} locale="en" initialSource={source} initialRecord={card}
      initialDraft={decisionInput(card)} onArchives={()=>{}} onClose={()=>{}} />);
    const field=()=>h.document.querySelector<HTMLInputElement>('[name=decision-title]')!;
    const save=()=>h.document.querySelector<HTMLButtonElement>('.library-primary')!;
    try {
      await h.input(field(),'My pending judgment');
      db.archives.put({...source,updatedAt:101});
      const pending=db.outbox.ready(Number.MAX_SAFE_INTEGER);
      await h.click(save());
      assert.equal(reads,2,'save conflict re-reads the source');
      assert.match(h.document.querySelector('.archive-status')!.textContent!,/source.*changed/i);
      assert.equal(field().value,'My pending judgment');
      assert.deepEqual(decisions.get(card.id),card);
      assert.deepEqual(db.outbox.ready(Number.MAX_SAFE_INTEGER),pending);
      if(mode==='failed-refresh') {
        assert.match(h.document.querySelector('.decision-source')!.textContent!,/Could not load/);
        await h.input(field(),'Edits during failure');
        await h.click(h.document.querySelector<HTMLButtonElement>('[data-decision-reload-source]')!);
        await h.input(field(),'Edits during pending refresh');
        await act(async()=>resolveLate!({...source,updatedAt:101}));
        assert.equal(field().value,'Edits during pending refresh');
      }
      const reviewed=()=>h.document.querySelector<HTMLButtonElement>('[data-evidence-use-reviewed]');
      assert.ok(reviewed(),'explicit source review is available');
      if(mode==='late-initial') {
        await h.input(field(),'Edits before late initial response');
        await act(async()=>resolveLate!(source));
        assert.equal(field().value,'Edits before late initial response');
        assert.ok(reviewed(),'late version100 response cannot replace the conflict refresh101');
      }
      await h.click(save());
      assert.equal(decisions.get(card.id)!.sourceUpdatedAt,100,'saving again cannot silently adopt101');
      const expectedTitle=field().value;
      await h.click(reviewed()!);
      await h.click(save());
      const updated=decisions.get(card.id)!;
      assert.equal(updated.sourceUpdatedAt,101); assert.equal(updated.title,expectedTitle);
      assert.deepEqual(updated.evidence.map(e=>e.id),['first','second']);
      assert.match(h.document.querySelector('.archive-status')!.textContent!,/Decision card saved/);
    } finally {await h.close();setShellApi(null);db.close();}
  });
}
