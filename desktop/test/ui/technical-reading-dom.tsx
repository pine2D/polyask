import assert from 'node:assert/strict';
import React from 'react';
import { MarkdownPreview } from '../../src/renderer/markdown-preview';
import { mountDom } from './dom-harness';

export interface MathJob { readonly id: number; readonly source: string; readonly display: boolean }
export type MathReply = { readonly ok: true; readonly mathml: string } | { readonly ok: false; readonly reason: 'failed' };
export const fractionMathml = '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mfrac><mn>1</mn><mn>2</mn></mfrac><annotation encoding="application/x-tex">\\frac{1}{2}</annotation></semantics></math>';
let workerTransport: { jobs: MathJob[]; reply?: (job: MathJob) => MathReply | Promise<MathReply> } | null = null;

/** Only the browser Worker transport is doubled; production tokens/rendering stay real. */
export async function mountTechnical(value: string, options: {
  clipboard?: (text: string) => Promise<void>;
  reply?: (job: MathJob) => MathReply | Promise<MathReply>;
} = {}) {
  const jobs: MathJob[] = [];
  workerTransport = { jobs, reply: options.reply };
  const h = await mountDom(<MarkdownPreview value={value} />);
  h.document.documentElement.lang = 'en';
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  class BrowserWorker {
    onmessage: ((event: { data: MathReply & { id: number } }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
    private terminated = false;
    postMessage(job: MathJob) {
      const transport = workerTransport;
      if (!transport) throw Error('the browser transport must be mounted before a request');
      transport.jobs.push(job);
      const reply = transport.reply?.(job) ?? (job.source.trim() === '\\frac{' ? { ok: false, reason: 'failed' } : { ok: true, mathml: fractionMathml });
      void Promise.resolve(reply).then(result => {
        if (this.terminated) return;
        const event = { data: { id: job.id, ...result } };
        this.onmessage?.(event as { data: MathReply & { id: number } });
        for (const listener of this.listeners.get('message') ?? []) listener(event);
      });
    }
    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: (event: unknown) => void) { this.listeners.get(type)?.delete(listener); }
    terminate() { this.terminated = true; }
  }
  for (const [key, replacement] of [['DOMParser', h.window.DOMParser], ['Worker', BrowserWorker]] as const) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: replacement });
    Object.defineProperty(h.window, key, { configurable: true, writable: true, value: replacement });
  }
  Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true,
    value: { writeText: options.clipboard ?? (async () => {}) } });
  return { ...h, jobs,
    async close() {
      await h.close();
      workerTransport = null;
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    }
  };
}

export function technicalButton(doc: Document, label: string): HTMLButtonElement {
  const node = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
  assert.equal(node !== undefined, true, `the real reading control must exist: ${label}`);
  return node!;
}

export function formulaSource(doc: Document): string { return doc.querySelector('.markdown-math-source')?.textContent ?? ''; }
