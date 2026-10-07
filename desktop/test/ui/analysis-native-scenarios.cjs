const { clipboard: systemClipboard } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async tools => {
  const { js, check, until, click, type, label, choose, view, open, state, finish, snapshot, cases, clipboard, output } = tools;
  const scope = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const editor = async () => { await click(await label('synthesisAction', scope('.library-record-actions')));
    await until('!!document.querySelector(".synthesis-workspace")', 'supplementary analysis editor'); };
  const configure = async requirement => { await choose('[name=synthesis-target]', 'claude'); await type('[name=synthesis-instruction]', requirement); };
  for (const entry of cases) {
    const name = `${entry.locale}-${entry.theme}-${entry.width}-${Math.round(entry.zoom * 100)}-${entry.forced ? 'forced' : 'normal'}`;
    state.scenario = 'analysis-layout-and-payload-matrix'; await open('analysis', entry.locale, entry.width, entry.zoom, entry.forced, entry.theme);
    state.step = 'progressive-payload'; await editor();
    check(await js('!document.querySelector("details.synthesis-preview").open&&document.querySelectorAll("[name=synthesis-answer]:checked").length===9'), 'complete nine-source payload begins as a closed disclosure');
    await click('details.synthesis-preview > summary');
    await js('window.readingPayload=document.querySelector("[name=synthesis-preview]").value');
    await choose('[name=synthesis-target]', 'claude');
    check(await js('document.querySelector("[name=synthesis-preview]").value===window.readingPayload'), 'changing the target keeps the same full payload and fence');
    await systemClipboard.writeText('PolyAsk native payload pending');
    await click('details.synthesis-preview > button');
    await until('document.querySelector("details.synthesis-preview [role=status]").textContent===window.readingFixture.labels.synthesisPayloadCopied', 'system clipboard write');
    const actual = await systemClipboard.readText(), displayed = await js('window.readingPayload');
    const exact = actual.replace(/\r\n?/g, '\n') === displayed;
    const sources = await js('window.readingFixture.sources.map(source=>source.text)');
    const sourceBodiesExact = sources.every(text => actual.includes(text));
    clipboard.push({ name, exact, sourceBodiesExact, selection: 'system', length: actual.length });
    writeFileSync(join(output, 'clipboard.json'), JSON.stringify(clipboard, null, 2));
    check(exact && sourceBodiesExact, 'copied payload contains all original CRLF bodies and matches the displayed LF projection');
    await snapshot(name);
  }
  finish('analysis-layout-and-payload-matrix');

  state.scenario = 'analysis-progress-and-recovered-context'; await open('analysis'); state.step = 'explicit-send';
  await editor(); await configure('Current manual requirement.'); await click('.synthesis-workspace footer button');
  await until('!!document.querySelector("[data-fixture-reopen]")', 'confirmed send returns to sites');
  await click('[data-fixture-reopen]');
  await until('!!document.querySelector("[data-analysis-stage=submitted]")', 'submitted waiting stage');
  check(await js('window.readingFixture.state().sendCount===1&&window.readingFixture.state().writeCount===0'), 'confirmed submit has not saved an answer');
  await click('.analysis-requirement > summary');
  check(await js(`document.querySelector('.analysis-requirement pre').textContent==='Current manual requirement.'`), 'the exact request remains visible while waiting');
  await js('window.readingFixture.recover()');
  await until('document.querySelector(".synthesis-card.pending h2").textContent===window.readingFixture.labels.analysisTitle', 'recovered pending context is neutral');
  await click(await label('synthesisCollect', scope('.synthesis-card.pending')));
  await until('!!document.querySelector("[data-analysis-stage=collected]")', 'collected review stage');
  check(await js('window.readingFixture.state().writeCount===0&&!document.querySelector("[data-analysis-stage=saved]")'), 'collected candidate awaits explicit persistence');
  await click(await label('synthesisSave', scope('.synthesis-card.pending')));
  await until('!!document.querySelector("[data-analysis-stage=saved]")', 'saved supplementary analysis');
  check(await js('window.readingFixture.state().writeCount===1&&window.readingFixture.state().requirementExact&&document.querySelector(".synthesis-card.saved h2").textContent===window.readingFixture.labels.analysisSaved'), 'explicit save retains its requirement and neutral name');
  finish('analysis-progress-and-recovered-context');

  state.scenario = 'uncertain-submit-and-explicit-source-review'; await open('analysis'); state.step = 'uncertain-submit';
  await editor(); await configure('Keep my requirement after an uncertain submission.'); await js('window.readingFixture.uncertain(true)');
  await click('.synthesis-workspace footer button');
  await until('!!document.querySelector(".feedback-bar button")&&!document.querySelector(".synthesis-workspace")', 'manual return-to-edit feedback');
  await click(await label('synthesisReturnToEdit', scope('.feedback-bar')));
  await until('!!document.querySelector(".synthesis-workspace")', 'restored complete request');
  check(await js(`document.querySelector('[name=synthesis-instruction]').value==='Keep my requirement after an uncertain submission.'&&document.querySelector('[name=synthesis-target]').textContent===window.readingFixture.siteLabel('claude')&&window.readingFixture.state().sendCount===1&&!window.readingFixture.state().pending`), 'uncertain submit keeps the editor without an automatic resend or false pending stage');
  await open('analysis'); state.step = 'changed-source-review'; await editor(); await configure('Review changed saved sources explicitly.');
  await click('.synthesis-workspace .panel-close'); await js('window.readingFixture.revise()');
  await click('.archive-detail-actions button');
  await until('document.querySelector(".archive-status").textContent.includes(window.readingFixture.labels.librarySaved)', 'refresh current source revision');
  await editor();
  check(await js('!!document.querySelector(".synthesis-source-changed")&&document.querySelector(".synthesis-workspace footer button").disabled'), 'matching old excerpt text alone cannot acknowledge a changed source');
  await click('.source-review-open');
  await until('document.querySelectorAll(".source-review-dialog pre").length===9', 'complete current source review');
  check(await js('document.querySelector(".source-review-dialog pre").textContent.includes("Source revision.")'), 'review displays the revised complete saved body');
  await click(await label('synthesisUseReviewed', scope('.source-review-dialog')));
  await until('!document.querySelector(".synthesis-source-changed")&&!document.querySelector(".synthesis-workspace footer button").disabled', 'explicit review acknowledgment');
  check(await js('window.readingFixture.state().sendCount===0'), 'review acknowledgment does not submit a request');
  finish('uncertain-submit-and-explicit-source-review');

  state.scenario = 'saved-analysis-original-requirement'; await open('saved'); state.step = 'reopened-saved-analysis';
  check(await js('!document.querySelector(".archive-synthesis")'), 'saved analysis is not mounted behind original reading');
  await view('synthesis'); await click('.analysis-requirement > summary');
  check(await js('document.querySelector(".synthesis-card.saved h2").textContent===window.readingFixture.labels.analysisSaved&&document.querySelector(".analysis-requirement pre").textContent===window.readingFixture.originalRequirement'), 'reopened analysis shows its neutral label and exact original requirement');
  check(await js('document.querySelector(".citation-notice").textContent===window.readingFixture.labels.citationReportNotice'), 'saved analysis keeps the source-verification notice');
  finish('saved-analysis-original-requirement');
};
