import { act, type ReactNode } from 'react';

/** Real component mount; only browser globals are supplied by jsdom. */
export async function mountDom(element: ReactNode) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://polyask.test/' });
  dom.window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const browserGlobals = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver',
    'KeyboardEvent', 'Event', 'File', 'FileReader', 'navigator'] as const;
  for (const key of browserGlobals) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true,
      value: key === 'window' ? dom.window : dom.window[key] });
  }
  descriptors.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = async (node: ReactNode) => { await act(async () => root.render(node)); };
  await render(element);
  return {
    document: dom.window.document as Document, window: dom.window,
    render,
    click: async (node: HTMLElement) => { await act(async () => node.click()); },
    input: async (node: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const prototype = node.tagName === 'INPUT' ? dom.window.HTMLInputElement.prototype : dom.window.HTMLTextAreaElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
        node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async close() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  };
}
