const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async tools => {
  const { js, check, until, click, key, type, wheel, selectPlain, selectOriginalLine, label, mark, choose, view, open, state, finish, snapshot, cases, only } = tools;
  const scope = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const selectParagraph = async (side, paragraphIndex, sourceIndex) => {
    const selector = await mark(`document.querySelector('.archive-compare-side:${side}-child').querySelectorAll('.archive-compare-paragraph')[${paragraphIndex}].querySelector('p')`);
    check(await js(`${scope(selector)}.closest('.archive-compare-column').querySelector('h3').textContent===window.readingFixture.sources[${sourceIndex}].label`), 'native selection belongs to the intended saved source');
    await selectPlain(selector);
  };
  const raw = async () => {
    await click('.archive-compare-column .answer-excerpt-open');
    await until('!!document.querySelector("[name=answer-excerpt-original]")', 'complete original source');
    const rawSteps = state.rawSteps ??= [];
    const recordRaw = async (step, selector = '[name=answer-excerpt-original]') => {
      rawSteps.push({ step, lastInput: state.lastInput, state: await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});
        return {active:document.activeElement===node,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection,length:node.value.length,
          preview:!!document.querySelector('.excerpt-confirm-preview'),confirmDisabled:document.querySelector('.folder-modal > button')?.disabled??null};})()`) });
      writeFileSync(join(tools.output, 'raw-selection.json'), JSON.stringify(rawSteps, null, 2));
    };
    if (only === 'raw-follow-up-and-source-boundaries' && !state.rawBaselineMeasured) {
      await js(`(()=>{const original=document.querySelector('[name=answer-excerpt-original]'),style=getComputedStyle(original),node=document.createElement('textarea');
        node.name='native-key-baseline';node.readOnly=true;node.value=original.value;
        node.style.cssText='position:fixed;left:12px;top:12px;width:380px;height:140px;z-index:1000;background:white;color:black';
        node.style.font=style.font;node.style.lineHeight=style.lineHeight;node.style.padding=style.padding;
        document.querySelector('.folder-modal').append(node);})()`);
      try {
        await click('[name=native-key-baseline]'); await recordRaw('baseline-click', '[name=native-key-baseline]');
        await selectOriginalLine('[name=native-key-baseline]'); await recordRaw('baseline-native-pointer', '[name=native-key-baseline]');
      } finally { await js("document.querySelector('[name=native-key-baseline]')?.remove()"); }
      state.rawBaselineMeasured = true;
    }
    await click('[name=answer-excerpt-original]'); await recordRaw('clicked-original');
    await selectOriginalLine('[name=answer-excerpt-original]'); await recordRaw('native-first-line-pointer');
    await until('!!document.querySelector(".excerpt-confirm-preview")', 'native raw selection');
    check(await js(`document.querySelector('.excerpt-confirm-preview').textContent===window.readingFixture.sources[0].text.split('\\r\\n')[0]`), 'raw selection maps exactly to the saved UTF16 source');
    await click(await label('excerptUseSelection', scope('.folder-modal')));
    await until('!!document.querySelector(".answer-excerpt-actions")', 'confirmed literal excerpt');
  };
  for (const entry of only ? [] : cases) {
    const name = `${entry.locale}-${entry.theme}-${entry.width}-${Math.round(entry.zoom * 100)}-${entry.forced ? 'forced' : 'normal'}`;
    state.scenario = 'comparison-layout-matrix'; await open('comparison', entry.locale, entry.width, entry.zoom, entry.forced, entry.theme);
    state.step = 'active-comparison';
    check(await js('document.querySelectorAll(".archive-answer-reading").length===2&&!document.querySelector(".archive-answers,.archive-synthesis")'), 'only two current saved sources mount');
    await click('.comparison-focus');
    await click('.archive-compare-column .answer-excerpt-open');
    await until('!!document.querySelector("[name=answer-excerpt-original]")', 'original disclosure');
    check(await js(`document.querySelector('[name=answer-excerpt-original]').value===window.readingFixture.sources[0].text.replace(/\\r\\n?/g,'\\n')`), 'original source is complete and has only the browser LF projection');
    await key('Escape');
    check(await js('document.activeElement===document.querySelector(".archive-compare-column .answer-excerpt-open")'), 'Escape returns focus to the real opener');
    await view('read');
    check(await js(`document.querySelectorAll('.archive-answer-reading').length===9&&[...document.querySelectorAll('.archive-answer-reading-body')].every((node,index)=>node.textContent.includes(window.readingFixture.sources[index].text.split('\\r\\n\\r\\n').at(-1)))`), 'read restores all nine complete saved answers');
    await view('compare'); await click('details.manual-comparison > summary');
    check(await js('document.querySelectorAll(".manual-comparison [name=manual-category]").length===8'), 'manual worksheet has four user categories for each current source');
    await snapshot(name);
  }
  if (!only) finish('comparison-layout-matrix');

  if (!only || only === 'comparison-focus-and-scroll') {
  state.scenario = 'comparison-focus-and-scroll'; await open(); state.step = 'independent-reading';
  await choose('.archive-compare-picker [role=combobox]', 'kimi');
  await click('.comparison-filter');
  await wheel('.archive-compare-column', 700); await wheel('.archive-compare-side:last-child .archive-compare-column', 420);
  await until('document.querySelector(".archive-compare-column").scrollTop>250&&document.querySelector(".archive-compare-side:last-child .archive-compare-column").scrollTop>100', 'native independent scroll');
  await js('window.readingScroll=[...document.querySelectorAll(".archive-compare-column")].map(node=>node.scrollTop)');
  await click('.comparison-focus'); await click('.comparison-focus');
  check(await js('[...document.querySelectorAll(".archive-compare-column")].every((node,index)=>Math.abs(node.scrollTop-window.readingScroll[index])<2)'), 'expanding and returning preserves both current reading positions');
  await view('read'); await wheel('.archive-detail-pane', 500);
  await until('document.querySelector(".archive-detail-pane").scrollTop>200', 'native original reading scroll');
  await js('window.readingOuter=document.querySelector(".archive-detail-pane").scrollTop');
  const readingPositions = [];
  const recordReadingPosition = async step => {
    readingPositions.push({ step, saved: await js('window.readingOuter'),
      actual: await js('document.querySelector(".archive-detail-pane").scrollTop'), lastInput: state.lastInput });
    writeFileSync(join(tools.output, 'reading-scroll.json'), JSON.stringify(readingPositions, null, 2));
  };
  await recordReadingPosition('native-read-scroll');
  await view('compare');
  await recordReadingPosition('entered-comparison');
  check(await js('document.querySelector(".comparison-filter input").checked&&document.querySelector(".archive-compare-column h3").textContent===window.readingFixture.siteLabel("kimi")'), 'comparison choices and differences survive active view changes');
  check(await js('[...document.querySelectorAll(".archive-compare-column")].every((node,index)=>Math.abs(node.scrollTop-window.readingScroll[index])<2)'), 'returning to comparison restores both actual column positions');
  await view('read');
  await recordReadingPosition('returned-to-read');
  check(await js('Math.abs(document.querySelector(".archive-detail-pane").scrollTop-window.readingOuter)<2'), 'returning to original answers restores outer reading position');
  finish('comparison-focus-and-scroll');
  if (only) return;
  }

  if (!only || only === 'literal-worksheet-and-decision') {
  state.scenario = 'literal-worksheet-and-decision'; await open(); state.step = 'native-literal-selection';
  await selectParagraph('first', 0, 0);
  await until('!!document.querySelector(".answer-excerpt-actions")', 'unique rendered literal selection');
  check(await js(`document.querySelector('.answer-excerpt-actions blockquote').textContent===window.readingFixture.sources[0].text.split('\\r\\n')[0]`), 'native selected quote is the exact saved literal');
  await click(await label('excerptManualCompare', scope('.answer-excerpt-actions')));
  await until('document.querySelector("details.manual-comparison").open', 'explicit manual worksheet');
  await selectParagraph('last', 0, 1);
  await until('!!document.querySelector(".archive-compare-side:last-child .answer-excerpt-actions")', 'second source native literal selection');
  check(await js(`document.querySelector('.archive-compare-side:last-child .answer-excerpt-actions blockquote').textContent===window.readingFixture.sources[1].text.split('\\r\\n')[0]`), 'second native quote retains its own saved source');
  await click(await label('excerptManualCompare', scope('.archive-compare-side:last-child .answer-excerpt-actions')));
  await click('[name=manual-category][data-source-index="0"][value=conditions]');
  await type('[name=comparison-judgment]', 'My manual judgment.');
  await type('[name=comparison-next-step]', 'Verify the condition with the owner.');
  await type('[name=comparison-note-conditions-0]', 'Only under the stated conditions.');
  await type('[name=comparison-note-cost-0]', 'Two hours of manual verification.');
  state.step = 'existing-metadata-guard';
  await click('.archive-metadata summary'); await type('[name=archive-note]', 'Keep this unsaved metadata.');
  await click(await label('manualFormDecision', scope('.manual-comparison')));
  await until('!!document.querySelector(".confirm-dialog:not(.folder-modal)")', 'unsaved metadata guard');
  await click(await label('cancel', scope('.confirm-dialog:not(.folder-modal)')));
  check(await js(`document.querySelector('[name=archive-note]').value==='Keep this unsaved metadata.'&&document.querySelector('[name=comparison-judgment]').value==='My manual judgment.'`), 'cancel preserves both metadata and manual worksheet');
  await click(await label('cancel', scope('.library-metadata-actions')));
  await click(await label('manualFormDecision', scope('.manual-comparison')));
  await until('!!document.querySelector(".decision-editor")', 'formed decision draft');
  check(await js(`document.querySelector('[name=decision-conclusion]').value==='My manual judgment.'&&document.querySelector('[name=decision-evidence-0]').value===window.readingFixture.sources[0].text.split('\\r\\n')[0]&&document.querySelector('[name=decision-uncertainties]').value.includes('[S1]')&&document.querySelector('[name=decision-rationale]').value.includes('Two hours')`), 'decision contains manual judgment and literal indexed evidence');
  check(await js(`document.querySelector('[name=decision-evidence-1]').value===window.readingFixture.sources[1].text.split('\\r\\n')[0]&&document.querySelectorAll('.decision-excerpt').length===2`), 'second literal evidence keeps its original source index');
  check(await js('window.readingFixture.state().decisionWrites===0&&window.readingFixture.state().writeCount===0'), 'forming a draft performs no persistence or winner write');
  await click('.library-decision-actions .library-primary');
  await until('window.readingFixture.state().decisionWrites===1', 'explicit decision save');
  check(await js('window.readingFixture.state().decisionEvidenceExact&&window.readingFixture.state().decisionEvidenceIndex===0&&window.readingFixture.state().decisionEvidenceCount===2&&window.readingFixture.state().decisionManual&&window.readingFixture.state().sendCount===0'), 'only explicit save persists both exact manual sources without an AI request');
  finish('literal-worksheet-and-decision');
  if (only) return;
  }

  state.scenario = 'raw-follow-up-and-source-boundaries'; await open(); state.step = 'ambiguous-formatted-selection';
  await click('.comparison-focus');
  await selectParagraph('first', 1, 0);
  await until('!!document.querySelector("[name=answer-excerpt-original]")', 'cross-format selection requires original review');
  check(await js('!document.querySelector(".answer-excerpt-actions")'), 'ambiguous selection does not silently become evidence');
  await key('Escape'); await raw();
  await click(await label('excerptFollowUp', scope('.answer-excerpt-actions')));
  await until('!!document.querySelector("[name=follow-up-excerpt]")', 'literal follow-up editor');
  check(await js(`document.querySelector('[name=follow-up-excerpt]').value===window.readingFixture.sources[0].text.split('\\r\\n')[0]&&document.querySelector('[name=synthesis-target]').textContent===window.readingFixture.labels.synthesisTargetMissing&&document.querySelector('.synthesis-workspace footer button').disabled`), 'follow-up uses only the confirmed excerpt and requires explicit target and question');
  await click('.synthesis-workspace .panel-close'); await raw();
  state.step = 'late-source-read'; await js('window.readingFixture.readDelay(true)');
  await click(await label('excerptUseEvidence', scope('.answer-excerpt-actions')));
  await until('window.readingFixture.state().waitingReads>0', 'deferred source verification');
  if (await js('document.querySelector(".library").dataset.focused==="true"')) await click('.library-focus');
  await click(await mark(`[...document.querySelectorAll('[data-action=library-open-item]')].find(node=>node.textContent.includes('Other saved result'))`));
  await js('window.readingFixture.readDelay(false);window.readingFixture.resolveReads()');
  check(await js('!document.querySelector(".decision-editor,.synthesis-workspace")&&document.querySelector(".archive-detail h1").textContent==="Other saved result"'), 'late source response cannot open an old editor on a new record');
  await open(); await raw(); state.step = 'revised-source'; await js('window.readingFixture.revise()');
  await click(await label('excerptUseEvidence', scope('.answer-excerpt-actions')));
  await until('document.querySelector(".archive-status").textContent.includes(window.readingFixture.labels.synthesisSourceVersionChanged)', 'source version refusal');
  check(await js('!document.querySelector(".decision-editor")&&window.readingFixture.state().decisionWrites===0'), 'revised source is never replaced with an unrelated quote or automatically saved');
  finish('raw-follow-up-and-source-boundaries');
};
