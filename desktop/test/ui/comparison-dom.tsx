import { act, StrictMode } from 'react';
import { mountDom } from './dom-harness';
import { createArchiveRecord, updateArchiveRecord, type ArchiveRecord } from '../../src/shared/archive';
import { getCopy } from '../../src/shared/copy';
import { SITES } from '../../src/main/sites';
import { setShellApi } from '../../src/renderer/shell-api';
import type { SynthesisDraftStore } from '../../src/renderer/synthesis-draft';

export const comparisonCopy = getCopy('en');
export const comparisonRecord = createArchiveRecord({ text: 'Original research question', task: 'Compare saved answers',
  results: ['Claude', 'ChatGPT', 'Kimi'].map((label, index) => ({ host: ['claude.ai', 'chatgpt.com', 'www.kimi.com'][index], label,
    text: 'Shared paragraph.\n\n' + Array.from({ length: 20 }, (_, i) => `${label} paragraph ${i}.`).join('\n\n') })) },
{ id: 'comparison-A', now: 100, deviceId: 'fixture' });

export async function comparisonWait(predicate: () => unknown) {
  const end = Date.now() + 2500;
  while (!predicate()) { if (Date.now() > end) throw new Error('comparison condition did not become ready');
    await act(async () => new Promise(resolve => setTimeout(resolve, 10))); }
}

export async function comparisonMount(options: { synthesisDrafts?: SynthesisDraftStore; onArchiveEntered?: (id: string, mode: string) => void } = {}) {
  const css = require.extensions['.css']; require.extensions['.css'] = () => {};
  const resize = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  const { ArchiveSurface } = await import('../../src/renderer/archive-surface');
  let records = [comparisonRecord, { ...comparisonRecord, id: 'comparison-B', task: 'Other saved result' }];
  let writes = 0;
  let decisionWrites = 0;
  let read: ((id: string) => Promise<ArchiveRecord | null>) | null = null;
  setShellApi({ listFolders: async () => [], listArchiveTags: async () => [],
    searchFolderContents: async () => records.map(record => ({ kind: 'archive', record })),
    getArchive: async (id: string) => read ? read(id) : records.find(record => record.id === id) || null,
    createDecision: async () => { decisionWrites++; throw new Error('unexpected fixture write'); },
    updateArchive: async (id: string, patch: Parameters<typeof updateArchiveRecord>[1]) => {
      writes++; const saved = updateArchiveRecord(records.find(record => record.id === id)!, patch, { now: 200, deviceId: 'fixture' });
      records = records.map(record => record.id === id ? saved : record); return saved;
    }
  } as any);
  const h = await mountDom(<StrictMode><ArchiveSurface copy={comparisonCopy} locale="en" sites={SITES} synthesisSites={SITES}
    defaultTier={null} preferredId={comparisonRecord.id} comparisonId={comparisonRecord.id}
    synthesisDrafts={options.synthesisDrafts}
    {...{ onArchiveEntered: options.onArchiveEntered }}
    pendingSynthesis={null} synthesisCandidate={null} onClose={() => {}} onCapture={async () => comparisonRecord}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => comparisonRecord} /></StrictMode>);
  await comparisonWait(() => h.document.querySelector('.archive-compare'));
  const button = (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.textContent === label || node.getAttribute('aria-label') === label);
  return { ...h, button, get writes() { return writes; }, get decisionWrites() { return decisionWrites; },
    readWith(handler: ((id: string) => Promise<ArchiveRecord | null>) | null) { read = handler; },
    replace(record: ArchiveRecord) { records = records.map(current => current.id === record.id ? record : current); },
    async choose(label: string, value: string) {
      const trigger = button(label); if (!trigger) throw new Error('missing comparison choice'); await h.click(trigger);
      const option = [...h.document.querySelectorAll<HTMLElement>('[role=option]')]
        .find(node => node.querySelector('span')?.textContent === value && node.getAttribute('aria-disabled') !== 'true');
      if (!option) throw new Error('missing enabled comparison option'); await h.click(option);
    },
    async scroll(node: HTMLElement, value: number) { await act(async () => {
      node.scrollTop = value; node.dispatchEvent(new h.window.Event('scroll', { bubbles: true }));
    }); },
    async close() { await h.close(); setShellApi(null); if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
      if (resize) Object.defineProperty(globalThis, 'ResizeObserver', resize); else Reflect.deleteProperty(globalThis, 'ResizeObserver'); }
  };
}
