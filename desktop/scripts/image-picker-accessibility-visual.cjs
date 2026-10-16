const assert = require('node:assert/strict');
const { join } = require('node:path');
const { nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, output, run, wait, paint }) => {
  const debug = win.webContents.debugger, reports = [];
  const path = join(output, 'synthetic-upload.png');
  writeFileSync(path, nativeImage.createFromBitmap(Buffer.from([40, 80, 180, 255]), { width: 1, height: 1 }).toPNG());
  debug.attach('1.3');
  try {
    for (const locale of ['en', 'zh-CN', 'zh-TW']) {
      win.webContents.setZoomFactor(1); win.setContentSize(1600, 900);
      await win.loadFile(join(output, 'index.html'), { query: { locale } });
      await wait('!!document.querySelector(".image-trigger")'); await paint();
      const { root } = await debug.sendCommand('DOM.getDocument');
      const node = async selector => (await debug.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector })).nodeId;
      const input = await node('input[name=images]');
      const { nodes } = await debug.sendCommand('Accessibility.getPartialAXTree', { nodeId: input, fetchRelatives: false });
      assert.equal(nodes[0].ignored, true, 'native input must not expose an extra unnamed file control');
      const button = await debug.sendCommand('Accessibility.getPartialAXTree', { nodeId: await node('.image-trigger'), fetchRelatives: false });
      assert.equal(button.nodes[0].role.value, 'button');
      assert.equal(button.nodes[0].name.value.length > 0, true);
      await debug.sendCommand('Page.enable');
      await debug.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      let opened = 0;
      const onMessage = (_event, method) => { if (method === 'Page.fileChooserOpened') opened++; };
      debug.on('message', onMessage);
      for (let index = 0; index < 2; index++) {
        await run('document.querySelector(".image-trigger").focus()');
        for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Space' });
        const end = Date.now() + 3000;
        while (opened < index + 1) { if (Date.now() > end) throw Error('File chooser did not open'); await new Promise(r => setTimeout(r, 20)); }
        await debug.sendCommand('DOM.setFileInputFiles', { nodeId: input, files: [path] });
        await wait(`document.body.dataset.fileChanges==="${index + 1}"`);
      }
      debug.off('message', onMessage);
      await debug.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false });
      reports.push({ locale, nativeInputIgnored: true, buttonName: button.nodes[0].name.value, trustedChooserOpened: opened, repeatFileChanges: 2, systemDialog: 'intercepted' });
    }
  } finally { debug.detach(); }
  writeFileSync(join(output, 'image-picker-accessibility.json'), JSON.stringify(reports, null, 2));
  console.log(`Image picker accessibility passed: ${reports.length} locale scenarios.`);
};
