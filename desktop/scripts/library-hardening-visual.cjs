const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, nativeTheme, output, run, wait, click, fill, key, shot }) => {
  const reports = [];
  const value = '😀'.repeat(3991) + '备注 مرحبا🌍';
  assert.equal([...value].length, 4000);
  const note = '[name=archive-note]';
  const submit = '.library-metadata-actions button[type=submit]';
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [640, 1280]) {
    nativeTheme.themeSource = width === 640 ? 'dark' : 'light';
    win.setContentSize(width, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale, invalidTime: '1' } });
    await wait('!!document.querySelector(".archive-detail h1") && !!document.querySelector(".archive-list[aria-busy=false] [aria-current=true]")');
    assert.equal(await run('document.querySelector(".archive-detail-heading time").hasAttribute("datetime")'), false);
    assert.ok((await run('document.querySelector(".archive-detail-heading time").textContent')).includes('—'));
    await click('.archive-metadata summary');
    await fill(note, '');
    await win.webContents.insertText(value);
    await wait('[...document.querySelector("[name=archive-note]").value].length === 4000');
    assert.equal(await run('document.querySelector("[name=archive-note]").value'), value, 'native text insertion preserves all Unicode codepoints');
    await win.webContents.insertText('x');
    await wait('[...document.querySelector("[name=archive-note]").value].length === 4001');
    await click(submit);
    await wait('document.querySelector("[name=archive-note]").getAttribute("aria-invalid") === "true"');
    assert.equal(await run('window.libraryTest.writes'), 0, 'validation prevents an invalid save request');
    assert.equal(await run('document.activeElement.name'), 'archive-note');
    const error = await run('document.querySelector(".archive-note-field [role=alert]").textContent');
    assert.ok(error.includes('4000'));
    for (const box of await run(`['.archive-detail', '.archive-fields', '.archive-note-field', '[name=archive-note]'].map(selector => {
      const e=document.querySelector(selector); return {selector,width:e.clientWidth,scroll:e.scrollWidth}; })`)) {
      assert.ok(box.scroll <= box.width + 2, `${locale}/${width}: overflow in ${box.selector}`);
    }
    await shot(`harden-note-error-${locale}-${width}`);
    await key('Backspace');
    await wait('[...document.querySelector("[name=archive-note]").value].length === 4000');
    await run('window.libraryTest.failSave=true');
    await click(submit);
    await wait('document.querySelector(".archive-metadata [role=status]").textContent.length > 0');
    assert.equal(await run('document.querySelector("[name=archive-note]").value'), value);
    assert.equal(await run('document.querySelector("[name=archive-note]").hasAttribute("aria-invalid")'), false);
    await run('window.libraryTest.failSave=false');
    await click(submit);
    await wait('document.querySelector(".library-metadata-actions button[type=submit]").disabled && window.libraryTest.writes === 1');
    assert.equal(await run('document.querySelector("[name=archive-note]").value'), value);
    if (locale === 'en' && width === 1280) {
      win.webContents.setZoomFactor(2);
      await wait('window.innerWidth === 640');
      assert.equal(await run('document.querySelector(".archive-note-field").scrollWidth <= document.querySelector(".archive-note-field").clientWidth + 2'), true);
      await shot('harden-notes-zoom-200');
      win.webContents.setZoomFactor(1);
      await wait('window.innerWidth === 1280');
    }
    reports.push({ locale, width, theme: nativeTheme.themeSource, invalidTime: 'fallback',
      insertedCodepoints: 4000, overLimit: 'retained', failedSave: 'retained', retry: 'saved' });
  }
  writeFileSync(join(output, 'hardening-report.json'), JSON.stringify(reports, null, 2));
  console.log(`Library hardening passed: ${reports.length} Unicode, validation, retry and invalid-date cases; 200% zoom.`);
  return reports;
};
