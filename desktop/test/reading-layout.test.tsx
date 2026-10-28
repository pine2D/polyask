import assert from 'node:assert/strict';
import React, { useRef } from 'react';
import test from 'node:test';
import { useReadingLayout, type ReadingLayoutMemory } from '../src/renderer/reading-layout';
import { ArchiveCompare } from '../src/renderer/archive-compare';
import { initialArchiveReader, useArchiveReader } from '../src/renderer/archive-reader-session';
import { createArchiveRecord } from '../src/shared/archive';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

function observerEnvironment() {
  const callbacks = new Map<Set<Element>, ResizeObserverCallback>();
  const descriptors = ['ResizeObserver', 'getComputedStyle'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  return {
    setup(window: Window & typeof globalThis) {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 480; } });
      Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: window.getComputedStyle.bind(window) });
      Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
        nodes = new Set<Element>();
        constructor(callback: ResizeObserverCallback) { callbacks.set(this.nodes, callback); }
        observe(node: Element) { this.nodes.add(node); }
        disconnect() { callbacks.delete(this.nodes); }
      } });
    },
    emit(target: Element, height: number) {
      for (const [nodes, callback] of callbacks) if (nodes.has(target)) callback([
        { target, contentRect: { width: 480, height } } as ResizeObserverEntry
      ], {} as ResizeObserver);
    },
    restore() { for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    } }
  };
}

test('partial size observations survive remount and source revision invalidates old sizes', async () => {
  const memory: ReadingLayoutMemory = { surfaces: {} }, environment = observerEnvironment();
  function Blocks({ revision }: { revision: number }) {
    const root = useRef<HTMLDivElement>(null);
    useReadingLayout(root, 'p', 'read', revision, memory);
    return <div ref={root}><p>First</p><p>Offscreen</p><p>Last</p></div>;
  }
  const h = await mountDom(<Blocks revision={1} />, environment.setup);
  try {
    environment.emit(h.document.querySelector('p')!, 123);
    await h.render(<div>Another view</div>);
    await h.render(<Blocks revision={1} />);
    assert.equal(h.document.querySelector('p')!.style.containIntrinsicBlockSize, 'auto 123px', 'one observed block remains known even when offscreen siblings never resized');
    await h.render(<div>Another view</div>);
    await h.render(<Blocks revision={2} />);
    assert.equal(h.document.querySelector('p')!.style.containIntrinsicBlockSize, '', 'changed source cannot inherit stale geometry');
  } finally { await h.close(); environment.restore(); }
});

test('changing the opposite comparison source keeps the current paragraphs observed', async () => {
  const environment = observerEnvironment();
  const firstHalf = Array.from({ length: 55 }, (_, index) => `First paragraph ${index} with **evidence**.`).join('\n\n');
  const secondHalf = Array.from({ length: 55 }, (_, index) => `Second paragraph ${index} with **assumptions**.`).join('\n\n');
  const record = createArchiveRecord({ task: 'Compare complete sources', text: 'Compare complete sources', results: [
    { host: 'claude.ai', label: 'Claude', text: firstHalf + '\n\n' + secondHalf }, { host: 'chatgpt.com', label: 'ChatGPT', text: firstHalf },
    { host: 'gemini.google.com', label: 'Gemini', text: secondHalf }
  ] }, { id: 'layout', now: 1000, deviceId: 'fixture' });
  let selectRight = (_host: string) => {};
  let saved: ReturnType<typeof initialArchiveReader> | null = null;
  function Comparison() {
    const reader = useArchiveReader(record, true, saved ?? { ...initialArchiveReader(record, true), differencesOnly: true }, value => { saved = value; });
    selectRight = host => reader.change({ rightHost: host });
    return <ArchiveCompare record={record} results={record.results} reader={reader} copy={getCopy('en')} />;
  }
  const h = await mountDom(<Comparison />, environment.setup);
  try {
    const first = h.document.querySelector('.archive-compare-column .archive-compare-paragraph')!;
    environment.emit(first, 123);
    await React.act(async () => selectRight('gemini.google.com'));
    const current = h.document.querySelector('.archive-compare-column .archive-compare-paragraph')!;
    assert.equal(current.textContent?.includes('First paragraph 0'), true);
    environment.emit(current, 456);
    await h.render(<div>Another view</div>); await h.render(<Comparison />);
    assert.equal(h.document.querySelector<HTMLElement>('.archive-compare-column .archive-compare-paragraph')!.style.containIntrinsicBlockSize,
      'auto 456px', 'the new paragraphs keep their own measured height after switching sources and remounting');
  } finally { await h.close(); environment.restore(); }
});
