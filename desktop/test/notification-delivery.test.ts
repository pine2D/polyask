import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { NotificationDelivery } from '../src/main/notification-delivery';
import type { NotificationStatus } from '../src/shared/notification';

class NativeNotification extends EventEmitter {
  closed = false;
  show(): void {}
  close(): void { this.closed = true; this.emit('close'); }
}
const message = { title: 'PolyAsk', body: 'Test notification' };

test('delivery distinguishes requesting, OS show, unknown and failed without exposing OS details', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notices: NativeNotification[] = [], states: NotificationStatus[] = [];
  const delivery = new NotificationDelivery({ supported: () => true, create: () => {
    const notice = new NativeNotification(); notices.push(notice); return notice;
  }, onStatus: value => states.push(value) });
  assert.equal(delivery.send(message).state, 'requested');
  t.mock.timers.tick(5_000); assert.equal(delivery.status().state, 'unknown');
  notices[0].emit('show'); assert.equal(delivery.status().state, 'shown');
  notices[0].emit('failed', {}, 'secret token /private/path https://private.example');
  assert.equal(delivery.status().state, 'failed');
  assert.equal(JSON.stringify(states).includes('secret'), false);
  assert.equal(notices[0].eventNames().length, 0);
  delivery.dispose();
});

test('late old failure cannot overwrite a newer request and clicks run at most once', () => {
  const notices: NativeNotification[] = []; let clicks = 0;
  const delivery = new NotificationDelivery({ supported: () => true, create: () => {
    const notice = new NativeNotification(); notices.push(notice); return notice;
  } });
  delivery.send(message, () => { clicks++; });
  delivery.send(message); notices[1].emit('show');
  notices[0].emit('click'); notices[0].emit('click');
  assert.equal(clicks, 1);
  notices[0].emit('failed', {}, 'private error');
  assert.equal(delivery.status().state, 'shown');
  delivery.dispose();
  assert.equal(notices.every(notice => notice.closed), true);
});

test('unsupported, synchronous failure, reset and disposal release callbacks safely', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let created = 0, clicked = 0, supported = false;
  const notice = new NativeNotification();
  const delivery = new NotificationDelivery({ supported: () => supported, create: () => { created++; return notice; } });
  assert.equal(delivery.send(message).state, 'unsupported'); assert.equal(created, 0);
  supported = true; delivery.send(message, () => { clicked++; }); delivery.reset();
  notice.emit('show'); notice.emit('failed'); notice.emit('click'); t.mock.timers.tick(10_000);
  assert.equal(delivery.status().state, 'idle'); assert.equal(clicked, 0);
  delivery.dispose(); delivery.send(message); assert.equal(created, 1);
  const broken = new NotificationDelivery({ supported: () => true, create: () => { throw new Error('private'); } });
  assert.equal(broken.send(message).state, 'failed'); broken.dispose();
});
