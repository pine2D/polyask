const { app, BrowserWindow, session, ipcMain } = require('electron');
const { join } = require('node:path');
const { writeFileSync, statSync } = require('node:fs');
const assert = require('node:assert/strict');
const { seed, cases } = require('./resource-baseline-data.cjs');
const { distribution, instrumentDatabase } = require('./resource-baseline-metrics.cjs');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2], build = process.argv[3], count = Number(process.argv[4]), repeats = Number(process.argv[5]);
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.whenReady().then(async () => {
  const { DesktopDatabase, createLocalDataServices, registerTaskFolderIpc, createArchiveRecord } = require(join(build, 'services.cjs'));
  let blocked = 0, db, dispose;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { blocked++; cb({ cancel: true }); });
  const win = new BrowserWindow({ show: true, width: 1200, height: 800, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, preload: join(build, 'preload.cjs') } });
  const boundary = processBoundary(app, output), path = join(output, 'synthetic-data', 'library.sqlite');
  const report = { kind: 'real-sqlite-production-ipc', count, repeats, versions: process.versions,
    platform: process.platform, arch: process.arch, cold: 'connection reopen / first query; OS file cache NOT cleared', rows: [] };
  const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify({ ...report, blocked }, null, 2));
  try {
    db = DesktopDatabase.open(path);
    const data = seed(db, createLocalDataServices(db), count, createArchiveRecord); db.close(); db = null;
    report.data = { ...data, databaseBytesAfterClose: statSync(path).size }; save();
    await win.loadFile(join(build, 'index.html')); boundary();
    for (const scenario of cases(count, data.folderId)) {
      const startedOpen = performance.now(); db = DesktopDatabase.open(path);
      const services = createLocalDataServices(db), meter = instrumentDatabase(db);
      const original = ipcMain.handle.bind(ipcMain);
      // Fixture-only envelope/instrumentation around the REAL production registered handler and trusted sender.
      ipcMain.handle = (channel, handler) => original(channel, (event, value) => {
        meter.begin(); const start = performance.now();
        try { const result = handler(event, value), sql = meter.end(), mainMs = performance.now() - start;
          return { value: result, trace: { ...sql, mainMs, mainNonSqlMs: mainMs - sql.sqliteMs } }; }
        catch (error) { meter.end(); throw error; }
      });
      try { dispose = registerTaskFolderIpc({ folders: services.folders,
        trusted: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame }); }
      finally { ipcMain.handle = original; }
      const row = { scenario: scenario.name, request: scenario.request, reopenMs: performance.now() - startedOpen, samples: [], censored: [] };
      report.rows.push(row); save();
      // One first-query, two warmups, then independent measured repetitions. No fake cold-cache claim.
      for (let i = -3; i < repeats; i++) {
        writeFileSync(join(output, 'in-flight.json'), JSON.stringify({ scenario: scenario.name, index: i, startedAt: Date.now() }));
        const sample = await win.webContents.executeJavaScript(`window.consume(${JSON.stringify(scenario.request)})`);
        assert.equal(sample.projectedBodies, false); assert.equal(sample.ids.length <= 100, true);
        assert.equal(sample.domItems, sample.ids.length); assert.equal(sample.sqlCalls >= 2, true);
        assert.equal(sample.mainMs >= sample.sqliteMs, true);
        if (i === -3) row.firstQuery = sample;
        else if (i >= 0) row.samples.push(sample);
        save();
      }
      row.stages = Object.fromEntries(['sqliteMs', 'mainMs', 'mainNonSqlMs', 'roundtripMs', 'consumerMs', 'bytes'].map(key =>
        [key, distribution(row.samples.map(sample => sample[key]))]));
      // Compare scalar business results to first-query and all repeats, including selected targets.
      const signature = s => JSON.stringify([s.total, s.page, s.selectedPage, s.selected, s.selectedTargets, s.ids]);
      assert.equal(row.samples.every(s => signature(s) === signature(row.firstQuery)), true);
      dispose(); dispose = null; db.close(); db = null; boundary(); save();
      console.log(JSON.stringify({ count, scenario: scenario.name, sqlite: row.stages.sqliteMs, roundtrip: row.stages.roundtripMs }));
    }
    assert.equal(blocked, 0); win.destroy(); app.exit(0);
  } finally { dispose?.(); db?.close(); }
}).catch(error => { writeFileSync(join(output, 'failure.txt'), String(error.stack)); console.error(error.stack); app.exit(1); });
