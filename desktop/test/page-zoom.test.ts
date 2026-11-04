import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { IpcMain, WebContents } from 'electron';
import { registerPageZoomIpc } from '../src/main/page-zoom';

function harness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  let zoom = 1, mode = 'default', destroyed = false, layouts = 0;
  const published: number[] = [];
  const contents = Object.assign(new EventEmitter(), {
    getZoomFactor: () => zoom, setZoomFactor: (value: number) => { zoom = value; },
    getZoomMode: () => mode, setZoomMode: (value: string) => { mode = value; },
    isDestroyed: () => destroyed, send: (_channel: string, value: number) => published.push(value)
  });
  const ipc = { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
    removeHandler: (name: string) => handlers.delete(name) };
  const close = registerPageZoomIpc(ipc as unknown as IpcMain, contents as unknown as WebContents,
    event => (event as any).trusted === true, () => { layouts++; });
  return { contents, handlers, published, close, layouts: () => layouts, destroy: () => { destroyed = true; },
    change: (action: unknown, trusted = true) => handlers.get('polyask:page-zoom-change')!({ trusted }, action) };
}

test('page zoom rejects untrusted senders and arbitrary factors, preserves browser bounds and reset', () => {
  const h = harness();
  try {
    assert.throws(() => h.change('in', false), /untrusted_sender/);
    assert.throws(() => h.handlers.get('polyask:page-zoom-get')!({}), /untrusted_sender/);
    for (const value of [1.5, NaN, null, {}, 'zoom-in']) assert.throws(() => h.change(value), /invalid_zoom_action/);
    assert.equal(h.layouts(), 0);
    for (let i = 0; i < 30; i++) h.change('in');
    assert.equal(h.contents.getZoomFactor(), 5);
    for (let i = 0; i < 30; i++) h.change('out');
    assert.equal(h.contents.getZoomFactor(), 0.25);
    assert.equal(h.change('reset'), 1);
    assert.equal(h.published.at(-1), 1);
  } finally { h.close(); }
});

test('wheel and keyboard use one controlled zoom step; typing and IME remain untouched', () => {
  const h = harness(); let prevented = 0;
  try {
    assert.equal(h.contents.getZoomMode(), 'isolated');
    h.contents.emit('zoom-changed', {}, 'in');
    assert.equal(h.contents.getZoomFactor(), 1.1);
    const key = { type: 'keyDown', key: '=', control: true, meta: false, alt: false };
    h.contents.emit('before-input-event', { preventDefault: () => { prevented++; } }, key);
    assert.equal(h.contents.getZoomFactor(), 1.25);
    for (const extra of [{ control: false }, { alt: true }, { isComposing: true }, { type: 'keyUp' }]) {
      h.contents.emit('before-input-event', { preventDefault: () => { prevented++; } }, { ...key, ...extra });
    }
    assert.equal(prevented, 1);
    assert.equal(h.layouts(), 2);
    assert.equal(h.published.join(','), '1.1,1.25');
  } finally { h.close(); }
  assert.equal(h.contents.getZoomMode(), 'default');
  assert.equal(h.handlers.size, 0);
  assert.equal(h.contents.listenerCount('before-input-event'), 0);
  assert.equal(h.contents.listenerCount('zoom-changed'), 0);
});

test('page zoom cleanup after window destruction does not access a dead WebContents', () => {
  const h = harness(); h.destroy();
  h.contents.setZoomMode = () => { throw Error('destroyed'); };
  assert.doesNotThrow(h.close);
  assert.equal(h.handlers.size, 0);
});
