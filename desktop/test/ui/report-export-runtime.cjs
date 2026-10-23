require('../../scripts/lib/assertion-safety.mjs');
const { app, BrowserWindow, session, webContents } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const { printReportPdf, renderReportHtml, createArchiveRecord } = require(join(output, 'services.cjs'));
  const sample = processBoundary(app, output), created = [], cases = [];
  let networkRequests = 0, deliveredRequests = 0;
  const server = createServer((_request, response) => { deliveredRequests++; response.end('must not load'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const probe = `http://127.0.0.1:${server.address().port}/probe`;
  const isolated = session.fromPartition('polyask-reports', { cache: false });
  isolated.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    networkRequests++; callback({ requestHeaders: details.requestHeaders });
  });
  app.on('web-contents-created', (_event, contents) => {
    created.push(contents);
    const prefs = contents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.javascript, false);
    assert.equal(contents.session === isolated, true);
  });
  const clean = name => {
    assert.equal(created.every(contents => contents.isDestroyed()), true, `${name}: all report contents destroyed`);
    assert.equal(BrowserWindow.getAllWindows().length, 0, `${name}: no temporary windows`);
    assert.equal(webContents.getAllWebContents().length, 0, `${name}: no live contents`);
    sample(); cases.push(name);
  };
  try {
    for (const [locale, question] of [['en', 'Saved question example'], ['zhCN', '示例问题'], ['zhTW', '範例問題']]) {
      const table = '| SOURCE_KEY | Saved content | Final column |\n| --- | --- | --- |\n' +
        Array.from({ length: 90 }, (_, index) => `| ROW_${String(index).padStart(3, '0')} | ${question} · saved text with enough context to wrap across lines | VALUE_${String(index).padStart(3, '0')} |`).join('\n');
      const archive = createArchiveRecord({ text: question, task: question, results: [
        { host: 'claude.ai', label: 'Claude', text: `Saved answer start\n\n${table}\n\nFINAL_MARKER\n\n` +
          `[Readable source](${probe})\n\n![image description](${probe})\n\n<img src="${probe}">\n\n<script src="${probe}"></script>` },
        { host: 'chatgpt.com', label: 'ChatGPT', text: 'Truncated saved answer.', code: 'answer_truncated' }
      ] }, { id: 'report-fixture', now: 1_700_000_000_000, deviceId: 'synthetic' });
      const html = renderReportHtml({ kind: 'archive', archive }, locale);
      writeFileSync(join(output, `${locale}.html`), html);
      const pdf = await printReportPdf(html, { signal: new AbortController().signal, guard: sample });
      assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
      writeFileSync(join(output, `${locale}.pdf`), pdf);
      clean(locale);
    }
    // 即使打印层意外收到带外部图片的 HTML，CSP/会话仍阻断请求。
    await printReportPdf(`<html><body><img src="${probe}"><script src="${probe}"></script><p>Resource isolation</p></body></html>`,
      { signal: new AbortController().signal, guard: sample });
    clean('resource-isolation');
    const html = renderReportHtml({ kind: 'archive', archive: createArchiveRecord({ text: 'Lifecycle', task: 'Lifecycle', results: [] },
      { id: 'lifecycle', now: 0, deviceId: 'synthetic' }) });
    await assert.rejects(printReportPdf(html, { signal: new AbortController().signal, guard: sample, timeoutMs: 1 }), /report_pdf_timeout/);
    clean('timeout');
    const controller = new AbortController();
    const pending = printReportPdf(html, { signal: controller.signal, guard: sample });
    const rejected = assert.rejects(pending, /report_source_changed/);
    controller.abort(); await rejected; clean('abort');
    let current = true;
    const stale = printReportPdf(html, { signal: new AbortController().signal, guard: () => {
      sample(); if (!current) throw new Error('report_source_changed');
    } });
    current = false; await assert.rejects(stale, /report_source_changed/); clean('source-changed');
    await printReportPdf(html, { signal: new AbortController().signal, guard: sample });
    clean('reuse-after-failure');
    assert.equal(networkRequests, 0); assert.equal(deliveredRequests, 0);
    writeFileSync(join(output, 'report.json'), JSON.stringify({ electron: process.versions.electron, cases,
      networkRequests, deliveredRequests, destroyed: created.filter(contents => contents.isDestroyed()).length }));
  } finally {
    isolated.webRequest.onBeforeSendHeaders(null);
    await new Promise(resolve => server.close(resolve));
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  }
  app.quit();
}).catch(error => { console.error(error.stack || String(error)); app.exit(1); });
