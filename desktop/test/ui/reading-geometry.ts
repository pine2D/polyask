import { act } from 'react';

/** Only supply layout and observer scheduling; all view/state behavior stays in production components. */
export function readingGeometry() {
  const metrics = { paneHeight: 787, scrollHeight: 2300, columnTop: 510, navigationBottom: 240,
    starts: [300, 900, 1500], answerHeights: [600, 600, 600] };
  const frames = new Map<number, FrameRequestCallback>();
  const observers = new Set<{ callback: () => void; targets: Set<Element> }>();
  let serial = 0;
  const configure = (window: Window & typeof globalThis) => {
    window.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
    window.cancelAnimationFrame = id => { frames.delete(id); };
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
      entry: { callback: () => void; targets: Set<Element> };
      constructor(callback: () => void) { this.entry = { callback, targets: new Set() }; observers.add(this.entry); }
      observe(node: Element) { this.entry.targets.add(node); }
      disconnect() { observers.delete(this.entry); }
    } });
    const bounds = window.HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true,
      get(this: HTMLElement) { return this.classList.contains('archive-detail-pane') ? metrics.paneHeight : 0; } });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true,
      get(this: HTMLElement) { return this.classList.contains('archive-detail-pane') ? metrics.scrollHeight : 0; } });
    window.HTMLElement.prototype.getBoundingClientRect = function() {
      const pane = this.closest('.archive-detail-pane'), scroll = pane?.scrollTop ?? 0;
      if (this.classList.contains('archive-detail-pane')) return new window.DOMRect(0, 113, 1000, metrics.paneHeight);
      if (this.classList.contains('library-reading-navigation')) return new window.DOMRect(0, 113, 1000, metrics.navigationBottom - 113);
      if (this.classList.contains('archive-compare-column')) return new window.DOMRect(0, metrics.columnTop - scroll, 450, 400);
      if (this.classList.contains('archive-answer')) {
        const index = Number(this.id.split('-').at(-1));
        return new window.DOMRect(0, metrics.starts[index] - scroll, 900, metrics.answerHeights[index]);
      }
      return bounds.call(this);
    };
  };
  return { metrics, configure, get pending() { return frames.size; }, get observed() { return observers.size; },
    resize() { observers.forEach(observer => observer.callback()); },
    async flush() { await act(async () => {
      const batch = [...frames]; frames.clear(); batch.forEach(([, callback]) => callback(0));
    }); }
  };
}
