const assert = require('node:assert/strict');

module.exports = async ({ tools, locale, phase, copy, drafts, remoteDrafts, engine, remoteEngine, preferences, notifyDrafts }) => {
  const { run, wait, pause, click, clickText, clickElement, type } = tools;
  const pollDraft = async (kind, field, expected) => {
    const deadline = Date.now() + 8000;
    for (;;) {
      const own = drafts.list(kind).find(value => value.deviceId === 'native-local' && value.content?.[field] === expected);
      if (own) return own;
      if (Date.now() >= deadline) throw Error(`Native ${kind} did not persist expected ${field}`);
      await pause(25);
    }
  };
  const openArchive = async () => {
    await click('.archive-trigger');
    await wait('!!document.querySelector("[data-action=library-open-item]")');
    await clickElement(`[...document.querySelectorAll('[data-action=library-open-item]')].find(e=>e.querySelector('.library-item-title').textContent===${JSON.stringify(`Native saved answers ${locale}`)})`);
    await wait('!!document.querySelector(".archive-detail")');
  };
  const openRecovery = async scope => {
    if (!(await run(`document.querySelector(${JSON.stringify(`${scope} .draft-recovery-entry`)}).open`)))
      await click(`${scope} .draft-recovery-entry > summary`);
    await wait(`document.querySelectorAll(${JSON.stringify(`${scope} .draft-copy-list li`)}).length>=2`);
  };
  const selectCopy = async (scope, label) => {
    await openRecovery(scope);
    await clickElement(`[...document.querySelectorAll(${JSON.stringify(`${scope} .draft-copy-list li`)})].find(e=>e.querySelector('small').textContent===${JSON.stringify(label)}).querySelector('button')`);
    await wait(`!!document.querySelector(${JSON.stringify(`${scope} .draft-preview-fields`)})`);
  };
  const restore = async (scope, selector, expected, cancelFirst) => {
    await clickText(`${scope} .draft-actions button`, copy.draftRestore);
    if (cancelFirst) {
      await wait(`!!document.querySelector(${JSON.stringify(`${scope} .draft-confirm`)})`);
      const active = await run(`document.querySelector(${JSON.stringify(selector)}).value`);
      await click(`${scope} .draft-confirm .confirm-actions button:not(.primary)`);
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).value`), active, 'cancel retains edited form');
      await clickText(`${scope} .draft-actions button`, copy.draftRestore);
    }
    if (await run(`!!document.querySelector(${JSON.stringify(`${scope} .draft-confirm`)})`))
      await click(`${scope} .draft-confirm .primary`);
    await wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(expected)}`);
  };
  const exercise = async (kind, scope, selector, field) => {
    const active = `Native active ${kind} ${locale}`, restored = `Remote saved ${kind} ${locale}`;
    if (phase === 'write') {
      await type(selector, active);
      const own = await pollDraft(kind, field, active);
      assert.equal((await engine.syncNow()).state, 'idle');
      assert.equal((await remoteEngine.syncNow()).state, 'idle');
      remoteDrafts.save({ kind, context: own.context, title: `Remote ${kind} ${locale}`,
        content: { ...own.content, [field]: restored }, sourceUpdatedAt: own.sourceUpdatedAt });
      assert.equal((await remoteEngine.syncNow()).state, 'idle');
      assert.equal((await engine.syncNow()).state, 'idle');
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).value`), active, 'cloud push preserves editor labor');
      await selectCopy(scope, copy.draftRemote);
      assert.equal(await run(`document.querySelector(${JSON.stringify(`${scope} .draft-preview-fields`)}).textContent.includes(${JSON.stringify(restored)})`), true);
      await restore(scope, selector, restored, true);
      await pollDraft(kind, field, restored);
    } else {
      assert.equal(drafts.list(kind).length >= 2, true, `restart preserves ${kind} branches`);
      const own = drafts.list(kind).find(value => value.deviceId === 'native-local');
      assert.equal(own.content[field], restored);
      await selectCopy(scope, copy.draftLocal);
      await restore(scope, selector, restored, false);
      await type(selector, active);
      preferences.refresh(); notifyDrafts(); await pause(100);
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).value`), active, 'refresh preserves new work after restart');
    }
    assert.equal(await run(`nativeInputs.some(e=>e.trusted && e.type==='input' && e.name===${JSON.stringify(selector.match(/name="([^"]+)"/)[1])})`), true);
  };
  await openArchive();
  await clickText('.library-view-switch button', copy.libraryCompare);
  await wait('!!document.querySelector(".manual-comparison")');
  if (!(await run('document.querySelector(".manual-comparison").open'))) await click('.manual-comparison > summary');
  await exercise('comparison', '.manual-comparison', 'textarea[name="comparison-judgment"]', 'judgment');
  await clickText('.library-record-actions button', copy.synthesisAction);
  await wait('!!document.querySelector(".synthesis-workspace")');
  await exercise('synthesis', '.synthesis-workspace', 'textarea[name="synthesis-instruction"]', 'instruction');
  await click('.synthesis-workspace .panel-close');
  await wait('!!document.querySelector(".archive-detail")');
  await clickText('.library-record-actions button', copy.decisionCreate);
  await wait('!!document.querySelector("textarea[name=decision-rationale]")');
  await exercise('decision', '.decision-workspace', 'textarea[name="decision-rationale"]', 'rationale');
  await click('.library-close');
  await wait('!!document.querySelector(".decision-workspace .confirm-dialog")');
  await click('.decision-workspace .confirm-dialog .primary');
  await wait('!document.querySelector(".folder-workspace")');
};
