const { nativeImage } = require('electron');
const fs = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');

module.exports = async ({ tools, win, profile }) => {
  const { run, wait } = tools;
  // Chromium selects generated PNGs from the isolated temporary profile only.
  const pixel = nativeImage.createFromBitmap(Buffer.from([40, 80, 180, 255]), { width: 1, height: 1 });
  const debug = win.webContents.debugger; debug.attach('1.3');
  let serial = 0;
  const select = async () => {
    const path = join(profile, `generated-attachment-${++serial}.png`);
    fs.writeFileSync(path, pixel.toPNG());
    const { root } = await debug.sendCommand('DOM.getDocument');
    const { nodeId } = await debug.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[name=images]' });
    await debug.sendCommand('DOM.setFileInputFiles', { nodeId, files: [path] });
  };
  await select();
  await wait('document.querySelector(".image-trigger").dataset.imageCount==="1"');
  assert.equal(await run('nativeInputs.some(e=>e.type==="change" && e.name==="images" && e.trusted)'), true);
  // Hold a second native selection in the actual FileReader path until recovery.
  await run(`window.nativeImageReadsHeld=[]; window.nativeImageReadsFinished=0;
    window.nativeOriginalRead=FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL=function(file) {
      this.addEventListener('loadend',()=>window.nativeImageReadsFinished++,{once:true});
      window.nativeImageReadsHeld.push(()=>window.nativeOriginalRead.call(this,file));
    }; void 0`);
  await select();
  await wait('window.nativeImageReadsHeld.length===1');
  debug.detach();
  return {
    afterCancel: async () => assert.equal(await run('document.querySelector(".image-trigger").dataset.imageCount'), '1',
      'cancel recovery retains the selected attachment'),
    afterRestore: async () => {
      await wait('document.querySelector(".image-trigger").dataset.imageCount==="0"');
      await run(`FileReader.prototype.readAsDataURL=window.nativeOriginalRead;
        window.nativeImageReadsHeld.splice(0).forEach(release=>release())`);
      await wait('window.nativeImageReadsFinished===1');
      assert.equal(await run('document.querySelector(".image-trigger").dataset.imageCount'), '0',
        'a delayed attachment read cannot return after accepted recovery');
    }
  };
};
