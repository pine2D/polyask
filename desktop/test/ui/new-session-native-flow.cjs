const assert = require('node:assert/strict');
module.exports = async ({ win, run, wait, click, paint, draft }) => {
  const images = await run('document.querySelector("#session-images").textContent');
  assert.equal(JSON.parse(images).length, 1);
  const opened = await run('document.querySelector("main").dataset.opened');
  const focused = await run('document.querySelector("main").dataset.focused');
  assert.equal(opened.split(',').length, 5); assert.equal(focused, 'gemini');
  await click('.new-session-trigger');
  await wait('!!document.querySelector(".confirm-dialog")');
  assert.equal(await run('document.querySelector("#session-confirm-count").textContent'), '2');
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Escape' });
  await wait('!document.querySelector(".confirm-dialog")');
  assert.equal(await run('document.querySelector("#session-calls").textContent'), '[]');
  await click('.new-session-trigger');
  await wait('!!document.querySelector(".confirm-dialog")');
  await click('.confirm-actions .primary');
  await wait('document.querySelector("#session-calls").textContent!=="[]"');
  assert.equal(await run('document.querySelector(".new-session-trigger").disabled'), true);
  await click('.new-session-trigger'); // A trusted click during the pending operation must not run again.
  await wait('!document.querySelector(".new-session-trigger").disabled');
  await paint();
  assert.equal(await run('document.querySelector("#session-calls").textContent'), '[["claude","kimi"]]');
  assert.equal(await run('document.querySelector("textarea").value'), draft);
  assert.equal(await run('document.querySelector("#session-images").textContent'), images);
  const expected = await run('document.querySelector("#session-announcement").dataset.partial');
  assert.equal(await run('document.querySelector("#session-announcement").textContent'), expected);
};
