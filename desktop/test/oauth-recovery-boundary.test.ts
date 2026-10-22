import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import http from 'node:http';
import { TokenStore, safeEncryptionAvailability } from '../src/main/token-store';
import { SECRET_KEYRING_TIMEOUT_MS } from '../src/main/secret-file-store';
import { OAuthSession } from '../src/main/oauth-session';
import { listenLoopback } from '../src/main/oauth-pkce';

const secure = { backend: () => 'gnome_libsecret', available: async () => true,
  encrypt: async (value: string) => Buffer.from('cipher:' + value),
  decrypt: async (value: Buffer) => value.toString().slice(7) };

test('memory-only OAuth reauthorization cannot resurrect the previous account after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'polyask-token-boundary-'));
  const path = join(directory, 'synthetic-token.bin');
  try {
    await new TokenStore(path, secure).save('synthetic-account-A');
    const temporary = new TokenStore(path, { ...secure, backend: () => 'unavailable', available: async () => false });
    const options = { credentials: { clientId: 'synthetic.apps.googleusercontent.com', clientSecret: 'synthetic-client-secret' },
      scope: 'synthetic-scope', openExternal: async () => undefined };
    const connected = new OAuthSession({ ...options, tokenStore: temporary,
      authorize: async () => ({ accessToken: 'synthetic-access-B', refreshToken: 'synthetic-account-B', expiresAt: Date.now() + 3_600_000 }) });
    await connected.connect();
    assert.equal(await connected.accessToken(false), 'synthetic-access-B');
    assert.equal(await temporary.load(), 'synthetic-account-B');
    let refreshes = 0;
    const restarted = new OAuthSession({ ...options, tokenStore: new TokenStore(path, secure),
      refresh: async () => { refreshes++; return { accessToken: 'old-account', refreshToken: null, expiresAt: 1 }; } });
    await assert.rejects(restarted.accessToken(false), { message: 'auth_failed' });
    assert.equal(refreshes, 0, 'restart must require reauthorization rather than silently switching accounts');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('memory-only token replacement cannot clear a later serialized secure save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'polyask-token-serial-'));
  const path = join(directory, 'synthetic-token.bin');
  try {
    await new TokenStore(path, secure).save('original');
    let calls = 0;
    const store = new TokenStore(path, { ...secure, available: async () => ++calls > 1 });
    const first = store.save('memory-only'), second = store.save('latest');
    assert.equal(await first, false); assert.equal(await second, true);
    assert.equal(await new TokenStore(path, secure).load(), 'latest');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('startup keyring availability has the same finite budget and ignores late availability', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (value: boolean) => void, result: boolean | undefined;
  const pending = safeEncryptionAvailability(() => new Promise<boolean>(done => { resolve = done; }));
  void pending.then(value => { result = value; });
  t.mock.timers.tick(SECRET_KEYRING_TIMEOUT_MS + 1);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(result, false, 'startup must finish if the keyring does not answer');
  resolve(true);
  assert.equal(await pending, false);
});

test('malformed loopback paths cannot escape the server callback or finish authorization', async t => {
  let handle!: (request: { url: string }, response: unknown) => void;
  const server = { once: () => server, listen: (_port: number, _host: string, ready: () => void) => { ready(); return server; },
    address: () => ({ port: 12345 }), close: (closed: () => void) => { closed(); return server; } };
  t.mock.method(http, 'createServer', (listener: typeof handle) => { handle = listener; return server; });
  const receiver = await listenLoopback(); receiver.expect('synthetic-private-state');
  let status = 0, resolved = false;
  const response = { writeHead: (value: number) => { status = value; return response; }, end() {} };
  void receiver.receive.then(() => { resolved = true; });
  try {
    assert.doesNotThrow(() => handle({ url: '//[' }, response));
    assert.equal(status, 404);
    handle({ url: '/?code=wrong&state=not-expected' }, response);
    await Promise.resolve(); assert.equal(resolved, false);
    handle({ url: '/?code=valid&state=synthetic-private-state' }, response);
    assert.equal((await receiver.receive).code, 'valid'); assert.equal(status, 200);
  } finally { await receiver.close(); }
});
