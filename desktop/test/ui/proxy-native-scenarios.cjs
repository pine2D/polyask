// 原生代理检查的分段场景（spec §9.2「原生检查」五条 + §3.1 三出口 + §3.2 WebRTC 策略 + §6.3 测试连接隔离
// + 计划头 Review Focus 4「启动时代理没在运行」、5「密码含 : @ 与非 ASCII」）。
const {
  ORIGIN_HOST, USERNAME, PASSWORD, UNICODE_PASSWORD, basic, proxyStatus, preference, custom, waitFor
} = require('./proxy-native-tools.cjs');

const routeOf = pending => ({ scheme: pending.scheme, host: pending.host, port: pending.port });

/** 对照组：空档案启动为「跟随系统」（启动环境已剥离 *_proxy），站点直连，代理端什么都收不到。 */
async function startupSystem(ctx) {
  const { assert, proxy } = ctx;
  const state = proxy.runtime.state();
  assert.equal(state.applied?.mode, 'system', 'empty profile starts in system mode');
  assert.equal(state.blocked, false, 'empty profile is not blocked');
  const before = ctx.proxyTotal();
  const control = await ctx.loadSite('control-system');
  assert.equal(ctx.hit(control), true, 'control page reached the origin');
  assert.equal(ctx.proxyTotal(), before, 'no proxy saw the control request');
}

/** 经代理加载：站点 partition、polyask-net（Drive/OAuth）、defaultSession（Shell）三个出口都走同一代理。 */
async function customHttp(ctx) {
  const { assert, proxies } = ctx;
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: custom(proxies.a.port) })), 'ok');
  assert.equal(ctx.proxy.runtime.state().applied?.port, proxies.a.port, 'proxy A is the applied configuration');
  assert.equal(ctx.policy(), 'disable_non_proxied_udp', 'existing site webContents switch WebRTC policy');
  for (const u of [await ctx.loadSite('site-a'), await ctx.fetchNet('net-a'), await ctx.fetchShell('shell-a')]) {
    assert.equal(ctx.via(proxies.a, u), true, `${u} went through proxy A`);
    assert.equal(ctx.hit(u), true, `${u} reached the origin`);
  }
}

/** 运行中切换：HTTP 代理 A → SOCKS5，新请求改走 SOCKS5（代理端解析域名），A 不再收到。 */
async function switchSocks5(ctx) {
  const { assert, proxies } = ctx;
  const before = proxies.socks.log.length;
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: custom(proxies.socks.port, { scheme: 'socks5' }) })), 'ok');
  const site = await ctx.loadSite('site-socks');
  const afterSite = proxies.socks.log.length;
  assert.ok(afterSite > before, 'the site request opened a SOCKS5 connection');
  const net = await ctx.fetchNet('net-socks');
  assert.ok(proxies.socks.log.length > afterSite, 'polyask-net opened its own SOCKS5 connection');
  const target = `${ORIGIN_HOST}:${ctx.origin.port}`;
  assert.equal(proxies.socks.log.slice(before).every(e => e.kind === 'socks5' && e.target === target && e.resolvedBy === 'proxy'),
    true, 'SOCKS5 entries name the origin host and are resolved by the proxy');
  for (const u of [site, net]) {
    assert.equal(ctx.hit(u), true, `${u} reached the origin`);
    assert.equal(proxies.a.log.some(e => e.target === u), false, `${u} did not go through the old proxy A`);
  }
}

/** 直连：三个出口都直达源站，四个代理端都收不到请求；WebRTC 策略回到 default。 */
async function direct(ctx) {
  const { assert } = ctx;
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: preference('direct') })), 'ok');
  assert.equal(ctx.policy(), 'default', 'direct mode restores the default WebRTC policy');
  const before = ctx.proxyTotal();
  for (const u of [await ctx.loadSite('site-direct'), await ctx.fetchNet('net-direct'), await ctx.fetchShell('shell-direct')]) {
    assert.equal(ctx.hit(u), true, `${u} reached the origin directly`);
  }
  assert.equal(ctx.proxyTotal(), before, 'direct mode: no proxy received any request');
}

/** 带认证的 HTTP 代理：站点先吃 407，再由 app.on('login') 交出密码；polyask-net 由请求级 login 交出。 */
async function httpAuth(ctx) {
  const { assert, proxies } = ctx;
  const value = custom(proxies.auth.port, { username: USERNAME });
  // 先不给密码：polyask-net 的请求级 login 只能 callback() 取消（与熔断后同一出口）。HTTPS 目标走 CONNECT 隧道。
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value })), 'ok');
  const tunnel = `${ORIGIN_HOST}:${ctx.origin.port}`;
  const cancelled = await ctx.fetchNetOutcome(`https://${tunnel}/net-auth-cancelled`);
  ctx.observe('net-https-407-cancelled', cancelled);
  // Electron 44.5.0 实测：适配器先拿到 407 Response，读 body 时才以隧道失败报错（不是请求阶段的 net 错误）。
  assert.deepEqual(cancelled, { phase: 'response', status: 407, bodyError: 'net::ERR_TUNNEL_CONNECTION_FAILED' },
    'a cancelled HTTPS proxy challenge surfaces as a 407 Response whose body fails with the tunnel error');
  assert.equal(proxies.auth.log.some(e => e.kind === 'connect' && e.target === tunnel && !e.authorized), true,
    'the cancelled CONNECT was challenged with 407');
  assert.equal(proxies.auth.log.some(e => e.target === tunnel && e.authorized), false, 'no tunnel opened without a password');
  assert.equal(ctx.origin.hits.some(hit => hit.path === '/net-auth-cancelled'), false, 'the cancelled request never reached the origin');
  assert.equal(ctx.proxy.auth.authFailed(), false, 'a cancelled first challenge does not trip the breaker');
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value, password: PASSWORD })), 'ok');
  const site = await ctx.loadSite('site-auth');
  assert.equal(ctx.via(proxies.auth, site, false), true, 'the first site attempt was challenged with 407');
  assert.equal(ctx.via(proxies.auth, site, true), true, 'app-level login answered with the saved credential');
  const net = await ctx.fetchNet('net-auth');
  assert.equal(ctx.via(proxies.auth, net, true), true, 'polyask-net request-level login answered');
  for (const u of [site, net]) assert.equal(ctx.hit(u), true, `${u} reached the origin`);
}

/** 测试连接：并发第二次被拒；正确密码成功并经代理；错误密码失败且从未打通隧道；正式线路不受影响。 */
async function probe(ctx) {
  const { assert, proxies, shim, tls } = ctx;
  const value = custom(shim.port, { username: USERNAME });
  const tunnel = `${ORIGIN_HOST}:${tls.port}`;
  const tunnels = authorized => proxies.auth.log.filter(e => e.kind === 'connect' && e.target === tunnel && e.authorized === authorized).length;
  const [first, second] = await ctx.invokeAll([
    ['polyask:proxy-test', { value, password: PASSWORD }], ['polyask:proxy-test', { value, password: PASSWORD }]]);
  assert.equal(ctx.code(first), 'ok', 'the correct password passes the probe');
  assert.equal(first.value.route, 'proxy', 'the probe target went through the proxy');
  assert.equal(typeof first.value.ms, 'number', 'the probe reports its latency');
  assert.equal(ctx.code(second), 'proxy_test_busy', 'a concurrent probe is rejected');
  // 407 带 Connection: close，Chromium 带凭据重连时会再经过一次前置，所以只要求全部指向固定目标。
  assert.equal(shim.rewritten.length > 0 && shim.rewritten.every(t => t === 'www.gstatic.com:443'), true,
    'the probe asked for the fixed generate_204 host');
  const granted = tunnels(true);
  assert.ok(granted >= 1, 'the correct password opened an authorised tunnel');
  assert.deepEqual(tls.hits, ['/generate_204'], 'exactly one probe reached the target');
  const denied = tunnels(false);
  const wrong = await ctx.invoke('polyask:proxy-test', { value, password: 'wrong-password' });
  assert.equal(ctx.code(wrong), 'proxy_auth_failed', 'the wrong password fails the probe');
  assert.equal(tunnels(true), granted, 'the wrong password never opened a tunnel');
  assert.ok(tunnels(false) > denied, 'the proxy rejected the wrong password');
  assert.deepEqual(tls.hits, ['/generate_204'], 'the failed probe never reached the target');
  assert.equal(ctx.proxy.runtime.state().applied?.port, proxies.auth.port, 'probing does not touch the applied route');
  const after = await ctx.loadSite('site-after-probe');
  assert.equal(ctx.via(proxies.auth, after, true), true, 'site traffic still uses the applied proxy');
}

/**
 * Review Focus 5：密码 `p@ss:wörd` 原样交给 Chromium。站点视图走 app.on('login')，polyask-net 走请求级 login，
 * 都必须以授权请求到达代理。先用 Node 直连代理做对照，证明夹具按 UTF-8 整串比对、能区分转码与截断。
 */
async function httpAuthUnicode(ctx) {
  const { assert, proxies } = ctx;
  const handle = proxies.unicode;
  const controls = [
    ['ctl-utf8', basic(USERNAME, UNICODE_PASSWORD, 'utf8'), true],
    ['ctl-latin1', basic(USERNAME, UNICODE_PASSWORD, 'latin1'), false],
    ['ctl-urlencoded', basic(USERNAME, encodeURIComponent(UNICODE_PASSWORD)), false],
    ['ctl-truncated', basic(USERNAME, UNICODE_PASSWORD.split(':')[0]), false]
  ];
  for (const [tag, authorization, accepted] of controls) {
    const status = await proxyStatus(handle.port, ctx.url(tag), authorization);
    assert.equal(status !== 407, accepted, `fixture control ${tag}: ${status}`);
  }
  const value = custom(handle.port, { username: USERNAME });
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value, password: UNICODE_PASSWORD })), 'ok');
  const site = await ctx.loadSite('site-unicode');
  assert.equal(ctx.via(handle, site, false), true, 'the first site attempt was challenged with 407');
  assert.equal(ctx.via(handle, site, true), true, 'app-level login handed over the UTF-8 password unchanged');
  const net = await ctx.fetchNet('net-unicode');
  assert.equal(ctx.via(handle, net, true), true, 'polyask-net request-level login handed over the UTF-8 password unchanged');
  for (const u of [site, net]) assert.equal(ctx.hit(u), true, `${u} reached the origin`);
  assert.equal(ctx.proxy.auth.authFailed(), false, 'no repeated 407 tripped the breaker');
}

/** 群发中：保存返回 proxy_busy；同步带来的变化只记脏标记，线路不变；群发结束后才应用。 */
async function busyPending(ctx) {
  const { assert, proxies, proxy, gate, sync } = ctx;
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: custom(proxies.a.port) })), 'ok');
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-follow', { enabled: true })), 'ok');
  assert.equal(proxy.runtime.state().following, true, 'following is on');
  sync.pullFromLocal();
  let release = () => {};
  const hold = gate.run(() => new Promise(resolve => { release = resolve; }));
  try {
    assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: custom(proxies.b.port) })), 'proxy_busy');
    sync.remoteWrites(preference('direct'));
    proxy.runtime.request();
    await waitFor(() => proxy.runtime.state().pending === true, 'the refresh marked the proxy dirty');
    const held = await ctx.loadSite('site-held');
    assert.equal(ctx.via(proxies.a, held), true, 'the route does not change mid-broadcast');
    assert.equal(proxies.b.log.length, 0, 'the rejected save never reached proxy B');
    assert.equal(proxy.runtime.state().applied?.port, proxies.a.port, 'proxy A is still applied');
  } finally {
    release();
    await hold;
  }
  await waitFor(() => {
    const state = proxy.runtime.state();
    return state.pending === false && state.applied?.mode === 'direct';
  }, 'the pending change was applied once the gate went idle');
  const before = ctx.proxyTotal();
  const flushed = await ctx.loadSite('site-flushed');
  assert.equal(ctx.hit(flushed), true, 'the flushed direct route reached the origin');
  assert.equal(ctx.proxyTotal(), before, 'after the flush no proxy receives traffic');
  assert.equal((await ctx.pushes()).some(state => state && state.pending === true), true, 'the shell was told about the pending change');
}

/** 同步待确认：横幅数据出现、线路不变；本机保存被拒；过期版本与「S 已换成 Y」的确认都被拒；确认 Y 后才换线。 */
async function pendingConfirm(ctx) {
  const { assert, proxies, proxy, sync } = ctx;
  sync.remoteWrites(custom(proxies.b.port));
  proxy.runtime.request();
  await waitFor(() => proxy.runtime.state().pendingConfirm?.port === proxies.b.port, 'pending confirmation for proxy B');
  const x = proxy.runtime.state().pendingConfirm;
  assert.deepEqual(routeOf(x), { scheme: 'http', host: '127.0.0.1', port: proxies.b.port });
  const shown = await ctx.invoke('polyask:proxy-state');
  assert.deepEqual(shown.value?.pendingConfirm, x, 'proxy-state (the banner source) carries the pending address');
  await waitFor(async () => (await ctx.pushes()).some(state => state?.pendingConfirm?.port === proxies.b.port),
    'the pending address was pushed to the shell');
  const totals = ctx.proxyTotal();
  const unconfirmed = await ctx.loadSite('site-unconfirmed');
  assert.equal(ctx.hit(unconfirmed), true, 'traffic keeps the confirmed direct route');
  assert.equal(ctx.proxyTotal(), totals, 'the unconfirmed address carries no traffic');
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: custom(proxies.a.port) })), 'proxy_pending_confirm');
  const stale = { ...routeOf(x), version: { updatedAt: x.version.updatedAt - 1, deviceId: x.version.deviceId } };
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-accept', stale)), 'proxy_not_pending', 'a stale version is rejected');
  sync.remoteWrites(custom(proxies.socks.port, { scheme: 'socks5' }));
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-accept', { ...routeOf(x), version: x.version })), 'proxy_not_pending',
    'accepting X is rejected once the stored S became Y');
  await waitFor(() => proxy.runtime.state().pendingConfirm?.port === proxies.socks.port, 'the banner refreshed to Y');
  assert.equal(proxy.runtime.state().applied?.mode, 'direct', 'nothing was applied without confirmation');
  assert.equal(ctx.proxyTotal(), totals, 'neither X nor Y carried traffic before confirmation');
  const y = proxy.runtime.state().pendingConfirm;
  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-accept', { ...routeOf(y), version: y.version })), 'ok');
  assert.equal(proxy.runtime.state().pendingConfirm, null, 'the confirmation cleared the banner');
  assert.equal(proxy.runtime.state().applied?.port, proxies.socks.port, 'the confirmed address is applied');
  const before = proxies.socks.log.length;
  const accepted = await ctx.loadSite('site-accepted', ctx.origin2);
  assert.equal(ctx.hit(accepted, ctx.origin2), true, 'the accepted route reached the origin');
  assert.equal(proxies.socks.log.slice(before).some(e => e.target === `${ORIGIN_HOST}:${ctx.origin2.port}`), true,
    'the confirmed address now carries traffic');
}

/**
 * Review Focus 4（独立启动，suite startup-closed）：档案里存着指向已释放端口的自定义代理。
 * 应用照常起来、配置照常应用；站点报 proxy_failed 且不悄悄直连；设置卡数据可读；测试连接给 proxy_failed；改到可用代理立即恢复。
 */
async function startupClosedPort(ctx) {
  const { assert, proxy, proxies, closedPort, origin, tls, shim } = ctx;
  const state = proxy.runtime.state();
  assert.equal(state.applied?.mode, 'custom', 'the stored custom proxy is applied at startup');
  assert.equal(state.applied?.port, closedPort, 'the applied port is the stored (dead) one');
  assert.equal(state.blocked, false, 'a proxy that is not running is not an apply failure');
  assert.equal(state.appliedResult, 'ok', 'resolveProxy validation passed; only the connection fails');

  const before = ctx.proxyTotal();
  const failure = await ctx.loadSiteFailure('site-dead-proxy');
  assert.equal(failure.errorDescription, 'ERR_PROXY_CONNECTION_FAILED', `site failure: ${failure.errorCode} ${failure.errorDescription}`);
  assert.equal(failure.errorCode, -130, 'the measured Chromium errno for a closed proxy port');
  assert.equal(failure.code, 'proxy_failed', 'the site status code is proxy_failed, not the generic load_failed');
  const netFailure = await ctx.fetchNetFailure('net-dead-proxy');
  assert.equal(netFailure.message, 'net::ERR_PROXY_CONNECTION_FAILED', 'polyask-net (Drive/OAuth) fails on the dead proxy');
  assert.equal(ctx.hit(failure.url) || ctx.hit(netFailure.url), false, 'nothing fell back to a direct connection');
  assert.equal(origin.hits.length, 0, 'the origin saw no traffic at all');
  assert.equal(ctx.proxyTotal(), before, 'no live proxy received the requests');

  const shown = await ctx.invoke('polyask:proxy-state');
  assert.equal(shown.error, undefined, `the settings card can read proxy-state: ${shown.error}`);
  assert.equal(shown.value.applied?.port, closedPort, 'proxy-state reports the applied dead proxy');
  assert.equal(shown.value.formValue?.port, closedPort, 'the settings form is prefilled with the stored address');
  assert.equal(shown.value.blocked, false, 'proxy-state is not blocked');

  const tested = await ctx.invoke('polyask:proxy-test', { value: custom(closedPort) });
  assert.equal(ctx.code(tested), 'proxy_failed', 'the probe reports proxy_failed for the dead proxy');
  assert.equal(tls.hits.length + shim.rewritten.length, 0, 'the failed probe reached nothing');

  assert.equal(ctx.code(await ctx.invoke('polyask:proxy-set', { value: custom(proxies.a.port) })), 'ok', 'the settings card can save a working proxy');
  const recovered = await ctx.loadSite('site-recovered');
  assert.equal(ctx.via(proxies.a, recovered), true, 'after saving, sites go through the working proxy');
  assert.equal(ctx.hit(recovered), true, 'the recovered route reached the origin');
}

const STAGES = [
  ['startup-system', startupSystem], ['custom-http', customHttp], ['switch-socks5', switchSocks5], ['direct', direct],
  ['http-auth', httpAuth], ['probe', probe], ['http-auth-unicode', httpAuthUnicode],
  ['busy-pending', busyPending], ['pending-confirm', pendingConfirm]
];
const STARTUP_STAGES = [['startup-closed-port', startupClosedPort]];

module.exports = { STAGES, STARTUP_STAGES };
