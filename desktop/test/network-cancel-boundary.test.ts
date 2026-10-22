import assert from 'node:assert/strict';
import test from 'node:test';
import { DriveClient } from '../src/main/drive-client';
import { createSessionFetch } from '../src/main/net-request-fetch';
import { clientRequestStub, type StubIncoming } from './support/client-request-stub';

for (const headerLimit of [true, false]) test(`Drive size rejection cancels native response and ignores late events (header=${headerLimit})`, async () => {
  let incoming!: StubIncoming;
  const stub = clientRequestStub(request => {
    incoming = request.respond(200, headerLimit
      ? { headers: { 'content-length': '128' }, end: false }
      : { chunks: ['123456789'], end: false });
  });
  const client = new DriveClient({ accessToken: async () => 'synthetic-access' },
    createSessionFetch({} as never, { request: stub.request }));
  await assert.rejects(client.download('synthetic-image', undefined, headerLimit ? 64 : 8),
    (error: unknown) => (error as { code?: string }).code === 'invalid_response');
  assert.equal(stub.requests[0].aborted, 1);
  assert.doesNotThrow(() => { incoming.emit('data', Buffer.from('late')); incoming.emit('end');
    incoming.emit('aborted'); incoming.emit('error', new Error('late failure')); });
});

test('explicit response cancellation releases the abort listener and aborts only once', async () => {
  const stub = clientRequestStub(request => request.respond(200, { end: false }));
  const controller = new AbortController();
  const response = await createSessionFetch({} as never, { request: stub.request })('https://example.test/', { signal: controller.signal });
  await response.body!.cancel();
  assert.equal(stub.requests[0].aborted, 1);
  controller.abort();
  assert.equal(stub.requests[0].aborted, 1);
});
