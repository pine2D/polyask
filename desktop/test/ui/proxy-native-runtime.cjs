// 自定义代理原生端到端检查（spec §9.2「原生检查」）：真实 Electron 会话 + 生产代理装配 / IPC / 测试连接。
// 判定只看本地代理端日志与源站命中（T1 夹具），不看客户端自报。临时档案；只访问本机，不碰真实站点与 Drive。
const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const tools = require('./proxy-native-tools.cjs');
const { STAGES, STARTUP_STAGES } = require('./proxy-native-scenarios.cjs');

const output = process.argv[2];
// main：空档案起步的主流程；startup-closed：档案里预置一个没在运行的自定义代理（Review Focus 4）。
const suite = process.argv[3] === 'startup-closed' ? 'startup-closed' : 'main';
const profile = join(output, `profile-${suite}`);
app.setPath('userData', profile);
// 测试源站：经代理时由代理端 hosts 表解析，直连时由这条规则解析。测试连接的固定目标只许经代理到达
// （本机解析一律失败，也挡住 Chromium 网络质量估计器对它的 DNS 查询）。其它主机名本检查不会访问。
app.commandLine.appendSwitch('host-resolver-rules', `MAP ${tools.ORIGIN_HOST} 127.0.0.1, MAP www.gstatic.com ~NOTFOUND`);
// 不碰钥匙环：密码走「仅内存」降级（spec §4.4 basic_text），检查不依赖桌面会话。
app.commandLine.appendSwitch('password-store', 'basic');
// 窗口销毁不得让 Electron 退出：场景之间要继续跑，退出只由本入口的 app.quit / app.exit 决定。
app.on('window-all-closed', () => {});
process.on('unhandledRejection', error => { console.error('unhandled', error && error.stack); app.exit(1); });

app.whenReady().then(async () => {
  const s = require(join(output, 'services.cjs'));
  // 只访问本机：Chromium 会为每个 session 从 redirector.gvt1.com 下载拼写词典，并经当时应用的代理出网。
  // 改指回环上的已释放端口（回环恒直连、立即被拒）：既不出网，也不会出现在任何代理端日志里。
  const offline = `http://127.0.0.1:${await tools.closedPort()}/`;
  for (const partition of [s.SITE_PARTITION, s.NET_PARTITION, s.PROBE_PARTITION]) {
    session.fromPartition(partition).setSpellCheckerDictionaryDownloadURL(offline);
  }
  session.defaultSession.setSpellCheckerDictionaryDownloadURL(offline);
  const cert = readFileSync(join(output, 'cert.pem'), 'utf8'), key = readFileSync(join(output, 'key.pem'), 'utf8');
  const hosts = { [tools.ORIGIN_HOST]: '127.0.0.1' };
  const origin = await s.startOrigin(), origin2 = await s.startOrigin();
  const tls = await tools.startTlsOrigin({ key, cert });
  const proxies = {
    a: await s.startHttpProxy({ hosts }),
    b: await s.startHttpProxy({ hosts }),
    socks: await s.startSocksProxy({ version: 5, hosts }),
    auth: await s.startHttpProxy({ auth: { username: tools.USERNAME, password: tools.PASSWORD }, hosts }),
    unicode: await s.startHttpProxy({ auth: { username: tools.USERNAME, password: tools.UNICODE_PASSWORD }, hosts })
  };
  const shim = await tools.startConnectRewriter(proxies.auth.port, { 'www.gstatic.com:443': `${tools.ORIGIN_HOST}:${tls.port}` });
  const closedPort = await tools.closedPort();

  const database = s.DesktopDatabase.open(join(profile, 'polyask.sqlite'));
  database.meta.put('deviceId', 'local');
  // 「上次退出前保存过」：必须早于 createProxyServices，启动路径才会从存储里读到它。
  if (suite === 'startup-closed') new s.ProxyPreferenceStore(database).saveLocal(tools.custom(closedPort));
  const remoteDatabase = s.DesktopDatabase.open(':memory:');
  remoteDatabase.meta.put('deviceId', 'remote');
  const proxy = s.createProxyServices(database);
  await proxy.runtime.recomputeFromStore();
  const gate = new s.OperationGate();

  const probeSession = session.fromPartition(s.PROBE_PARTITION);
  probeSession.setCertificateVerifyProc((request, callback) => callback(request.hostname === 'www.gstatic.com'
    ? (tools.samePem(request.certificate.data, cert) ? 0 : -2) : -3));
  const probe = new s.ProxyProbe({ session: () => probeSession, translate: s.toProxyConfig, timeoutMs: 8000,
    fetchFor: (target, onLogin) => s.createSessionFetch(target, { onLogin }) });

  const shell = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: {
    preload: join(__dirname, 'proxy-native-preload.cjs'), sandbox: true, contextIsolation: true } });
  const site = new BrowserWindow({ show: false, webPreferences: { partition: s.SITE_PARTITION, sandbox: true, contextIsolation: true } });
  const dispose = s.registerProxyIpc({
    trusted: event => event.sender === shell.webContents && event.senderFrame?.parent === null,
    gate, runtime: proxy.runtime, store: proxy.store, auth: proxy.auth,
    dataAdmin: { isResetting: false }, probe,
    reloadSites: async () => ({ skipped: [] }),
    send: (channel, payload) => { if (!shell.isDestroyed()) shell.webContents.send(channel, payload); }
  });
  await shell.loadFile(join(output, 'index.html'));

  // polyask-net 的请求级 login 与生产 window-data-services 同一接法（T10 onProxyLogin → auth.handleRequestLogin）。
  const netFetch = s.createSessionFetch(session.fromPartition(s.NET_PARTITION),
    { onLogin: (request, authInfo, callback) => proxy.auth.handleRequestLogin(request, authInfo, callback) });
  const repository = new s.SyncRepository(database);
  const remoteRepository = new s.SyncRepository(remoteDatabase);
  const remoteStore = new s.ProxyPreferenceStore(remoteDatabase);
  let counter = 0;
  const url = (tag, server = origin) => `http://${tools.ORIGIN_HOST}:${server.port}/${tag}?n=${++counter}`;
  const pathOf = value => { const parsed = new URL(value); return parsed.pathname + parsed.search; };
  const invokeAll = calls => shell.webContents.executeJavaScript(`Promise.all(${JSON.stringify(calls)}.map(([channel, payload]) =>
    proxyCheck.invoke(channel, payload).then(value => ({ value }), error => ({ error: String(error && error.message) }))))`);
  const report = { suite, stages: [], observations: {} };
  const ctx = {
    assert, proxy, gate, origin, origin2, tls, proxies, shim, closedPort, url,
    loadSite: async (tag, server) => { const u = url(tag, server); await site.webContents.loadURL(u); return u; },
    /** 站点主帧加载必须失败：返回真实 did-fail-load 的错误号/名，以及生产 classifyNetError 给出的站点码。 */
    loadSiteFailure: async tag => {
      const u = url(tag);
      let failure = null;
      const onFail = (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (isMainFrame && errorCode !== -3 && !failure) failure = { errorCode, errorDescription };
      };
      site.webContents.on('did-fail-load', onFail);
      try {
        const rejected = await site.webContents.loadURL(u).then(() => false, () => true);
        assert.equal(rejected, true, `${tag} must not load`);
        await tools.waitFor(() => failure !== null, `${tag} did-fail-load`);
      } finally {
        site.webContents.off('did-fail-load', onFail);
      }
      return { url: u, ...failure, code: s.classifyNetError(failure.errorCode) ?? 'load_failed' };
    },
    /** polyask-net 请求必须失败：返回适配器 reject 的 message（T9：Chromium 原样错误名）。 */
    fetchNetFailure: async tag => {
      const u = url(tag);
      const message = await netFetch(u).then(() => null, error => String(error && error.message));
      assert.notEqual(message, null, `polyask-net ${tag} must not succeed`);
      return { url: u, message };
    },
    /** polyask-net 请求的原样结局：请求阶段 reject，还是先拿到 Response、读 body 时再失败（T9/T10 评审的 407 开放问题）。 */
    fetchNetOutcome: async u => {
      try {
        const response = await netFetch(u);
        const bodyError = await response.text().then(() => null, error => String(error && error.message));
        return { phase: 'response', status: response.status, bodyError };
      } catch (error) { return { phase: 'request', message: String(error && error.message) }; }
    },
    observe: (name, value) => { report.observations[name] = value; console.log(`observed ${name}: ${JSON.stringify(value)}`); },
    fetchNet: async tag => {
      const u = url(tag), response = await netFetch(u);
      assert.equal(response.status, 200, `polyask-net ${tag}`); await response.text(); return u;
    },
    fetchShell: async tag => {
      const u = url(tag), response = await session.defaultSession.fetch(u);
      assert.equal(response.status, 200, `defaultSession ${tag}`); await response.text(); return u;
    },
    hit: (u, server = origin) => server.hits.some(hit => hit.path === pathOf(u)),
    via: (handle, u, authorized = true) => handle.log.some(e => e.kind === 'http' && e.target === u && e.authorized === authorized),
    proxyTotal: () => Object.values(proxies).reduce((sum, handle) => sum + handle.log.length, 0),
    invokeAll,
    invoke: async (channel, payload) => (await invokeAll([[channel, payload]]))[0],
    code: r => r.error !== undefined ? s.ipcErrorCode(r.error)
      : r.value && r.value.ok === true ? 'ok' : r.value && r.value.ok === false ? String(r.value.result) : 'unexpected',
    pushes: () => shell.webContents.executeJavaScript('proxyCheck.pushes()'),
    policy: () => site.webContents.getWebRTCIPHandlingPolicy(),
    sync: {
      // 另一台设备先拿到本机上传的 S，再写自己的新版本；本机按生产同步投影合并（不入 outbox）。
      pullFromLocal: () => remoteRepository.applyStateFragments({ local: repository.localStateFragment() }),
      remoteWrites: value => {
        remoteStore.saveFollowing(value);
        repository.applyStateFragments({ remote: remoteRepository.localStateFragment() });
      }
    }
  };
  try {
    for (const [name, stage] of suite === 'startup-closed' ? STARTUP_STAGES : STAGES) {
      await stage(ctx);
      report.stages.push(name);
      console.log(`stage ok: ${name}`);
    }
  } finally {
    report.logs = Object.fromEntries(Object.entries(proxies).map(([name, handle]) => [name, handle.log.length]));
    report.tlsHits = tls.hits.slice();
    report.rewritten = shim.rewritten.slice();
    writeFileSync(join(output, `report-${suite}.json`), JSON.stringify(report, null, 2));
    try {
      dispose();
      site.destroy();
      shell.destroy();
      await Promise.all([origin, origin2, tls, shim, ...Object.values(proxies)].map(handle => handle.close()));
      database.close();
      remoteDatabase.close();
    } catch (error) { console.error('cleanup', error && error.stack); }
  }
  console.log(JSON.stringify(report));
  app.quit();
}).catch(error => { console.error(error && error.stack); app.exit(1); });
