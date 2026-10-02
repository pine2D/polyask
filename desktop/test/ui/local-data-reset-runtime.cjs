const { app, BrowserWindow } = require("electron");
const { join } = require("node:path");
const output = process.argv[2];
app.setPath("userData", join(output, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1400, height: 900, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let failed = false;
  for (const file of ["index.html", "flow.html"]) {
    await window.loadFile(join(output, file));
    const result = await window.webContents.executeJavaScript("window.resetResult");
    console.log(JSON.stringify({ file, ...result }));
    if (!result.ok) failed = true;
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
