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
  const { printReportPdf, renderReportHtml, createArchiveRecord, fitReportMath,renderReportDiagrams, ReportExportService } = require(join(output, 'services.cjs'));
  const sample = processBoundary(app, output), created = [], cases = [];
  let networkRequests = 0, deliveredRequests = 0, staticDiagrams = 0, staticFormulas = 0;
  const server = createServer((_request, response) => { deliveredRequests++; response.end('must not load'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const probe = `http://127.0.0.1:${server.address().port}/probe`;
  const isolated = session.fromPartition('polyask-reports', { cache: false });
  isolated.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    networkRequests++; callback({ requestHeaders: details.requestHeaders });
  });
  const rendererSession = session.fromPartition('polyask-report-render', { cache: false });
  rendererSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { networkRequests++; callback({requestHeaders: details.requestHeaders}); });
  app.on('web-contents-created', (_event, contents) => {
    created.push(contents);
    const prefs = contents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.javascript, contents.session === rendererSession);
    assert.equal(contents.session === isolated || contents.session === rendererSession, true);
  });
  const clean = name => {
    assert.equal(created.every(contents => contents.isDestroyed()), true, `${name}: all report contents destroyed`);
    assert.equal(BrowserWindow.getAllWindows().length, 0, `${name}: no temporary windows`);
    assert.equal(webContents.getAllWebContents().length, 0, `${name}: no live contents`);
    sample(); cases.push(name);
  };
  try {
    const longFormula = Array(150).fill('x').join('+');
    const tallFormula = '\\begin{matrix}' + Array(80).fill('z').join('\\\\') + '\\\\\\mathrm{ENDTALLFORMULA}\\end{matrix}';
    const wideTableFormula = Array(35).fill('w').join('+');
    for (const [locale, question] of [['en', 'Saved question example'], ['zhCN', '示例问题'], ['zhTW', '範例問題']]) {
      const table = '| SOURCE_KEY | Saved content | Final column |\n| --- | --- | --- |\n' +
        Array.from({ length: 90 }, (_, index) => `| ROW_${String(index).padStart(3, '0')} | ${question} · saved text with enough context to wrap across lines | VALUE_${String(index).padStart(3, '0')} |`).join('\n');
      const archive = createArchiveRecord({ text: `${question}\nFULL_PROMPT_CONTEXT_MARKER`, task: question, results: [
        { host: 'claude.ai', label: 'Claude', observation: { questionId: 'synthetic-question', site: 'claude', attempt: 2, observedAt: 1700000000000,
          selection: { requested: 'think', observed: 'think', outcome: 'preferred', model: 'Example Pro OBSERVATION_MARKER' } }, text: `Saved answer start\n\nBLOCKSTART\n\n$$${longFormula}=\\mathrm{ENDLONGFORMULA}$$\n\nBLOCKEND\n\nINLINESTART $${longFormula}=\\mathrm{ENDINLINEFORMULA}$ INLINEEND\n\n| Formula | Value |\n| --- | --- |\n| $${wideTableFormula}=\\mathrm{ENDTABLEFORMULA}$ | narrow cell |\n\nTALLSTART\n\n$$${tallFormula}$$\n\nTALLEND\n\n$x^2+y^2=z^2$\n\n$$\\frac{a}{b}$$\n\n\`\`\`mermaid\ngraph TD; A[问题]-->B[Decision]\n\`\`\`\n\n${table}\n\nFINAL_MARKER\n\n` +
          `[Readable source](${probe})\n\n![image description](${probe})\n\n<img src="${probe}">\n\n<script src="${probe}"></script>` },
        { host: 'chatgpt.com', label: 'ChatGPT', text: 'Truncated saved answer.', code: 'answer_truncated' }
      ] }, { id: 'report-fixture', now: 1_700_000_000_000, deviceId: 'synthetic' });
      const service = new ReportExportService({ archives: { get: () => archive }, decisions: { get: () => null },
        epoch: () => 0, isCurrent: () => true, choosePath: async request => join(output, `${locale}.${request.format}`),
        fitMath: (html, math, options) => fitReportMath(html, math, options, join(output, 'report-preload.cjs')),
        renderDiagrams: (sources, options) => renderReportDiagrams(sources, options, join(output, 'report-preload.cjs')),
        printPdf: printReportPdf });
      for (const format of ['html', 'pdf']) {
        const saved = await service.export({kind:'archive', id:archive.id, locale, format});
        assert.equal(saved.status, 'saved', JSON.stringify(saved));
      }
      const html = require('node:fs').readFileSync(join(output, `${locale}.html`),'utf8');
      assert.equal((html.match(/<img src="data:image\/png;base64,/g)||[]).length, 1);
      assert.equal((html.match(/<math /g)||[]).length, 2);
      staticDiagrams++; staticFormulas+=2;
      clean(locale);
    }
    const renderOptions = () => ({signal:new AbortController().signal, guard:sample, deadline:Date.now()+30000});
    const preload = join(output,'report-preload.cjs');
    const invalid = ['%%{init: {"securityLevel":"loose"}}%%\ngraph TD; A-->B',
      'graph TD;'+'A;'.repeat(251), 'graph TD; A['+'x'.repeat(20001)+']', 'not a diagram',
      'graph TD; A["<svg onload=alert(1)><image href='+probe+'/></svg>"]'];
    const unsafe = await renderReportDiagrams(invalid,renderOptions(),preload);
    assert.equal(unsafe.has(invalid[0]),false); assert.equal(unsafe.has(invalid[1]),false);
    assert.equal(unsafe.has(invalid[2]),false); assert.equal(unsafe.has(invalid[3]),false);
    clean('invalid-and-long-diagrams');
    await assert.rejects(renderReportDiagrams(['graph TD; A-->B'],{...renderOptions(),deadline:Date.now()+1},preload),/report_pdf_timeout/);clean('render-total-timeout');
    const cancelled = new AbortController();
    const stopped = renderReportDiagrams(['graph TD; A-->B'],{...renderOptions(),signal:cancelled.signal},preload);
    cancelled.abort(); await assert.rejects(stopped,/report_source_changed/);clean('render-abort');
    let fresh=true;
    const changed = renderReportDiagrams(['graph TD; A-->B'],{...renderOptions(),guard:()=>{if(!fresh)throw Error('report_source_changed');}},preload);
    fresh=false;await assert.rejects(changed,/report_source_changed/);clean('render-source-changed');
    const closing = renderReportDiagrams(['graph TD; A-->B'],renderOptions(),preload);
    BrowserWindow.getAllWindows()[0].destroy(); await closing;clean('render-window-closed');
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
      networkRequests, deliveredRequests, staticDiagrams, staticFormulas, destroyed: created.filter(contents => contents.isDestroyed()).length }));
  } finally {
    isolated.webRequest.onBeforeSendHeaders(null); rendererSession.webRequest.onBeforeSendHeaders(null);
    await new Promise(resolve => server.close(resolve));
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  }
  app.quit();
}).catch(error => { console.error(error.stack || String(error)); app.exit(1); });
