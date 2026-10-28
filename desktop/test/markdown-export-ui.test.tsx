import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { mountDom } from './ui/dom-harness';
import { getCopy } from '../src/shared/copy';
import { setShellApi } from '../src/renderer/shell-api';
import { useMarkdownExport } from '../src/renderer/use-markdown-export';
import { exportDocuments } from './markdown-export-fixtures';
import type { MarkdownExportRequest } from '../src/shared/markdown-export';
const copy = getCopy('en');
function Harness() { const flow = useMarkdownExport({ copy, locale: 'en' }); return <><button onClick={() => flow.open(exportDocuments().map(d => d.target))}>Open export</button>{flow.panel}</>; }

test('site buttons toggle independently; cancelled native save retains choices and Escape restores focus', async () => {
  const saved: MarkdownExportRequest[] = [];
  setShellApi({ previewMarkdown: async () => exportDocuments(), exportMarkdown: async (r: MarkdownExportRequest) => { saved.push(r); return { status: 'cancelled' }; } } as any);
  const h = await mountDom(<Harness />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  try {
    const opener = button('Open export'); await act(async () => opener.focus()); await h.click(opener);
    assert.equal(h.document.querySelector('[role="dialog"]') !== null, true);
    await h.click(button('Claude'));
    assert.equal(button('Claude').getAttribute('aria-pressed'), 'false');
    assert.equal(button('ChatGPT').getAttribute('aria-pressed'), 'true');
    await h.click(button(copy.markdownSaveOne));
    assert.deepEqual(saved[0].selections.map(s => [...s.entryIds]), [['g1'], ['g2']]);
    assert.equal(h.document.querySelector('[role="dialog"]') !== null, true);
    assert.equal(button('Claude').getAttribute('aria-pressed'), 'false');
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })));
    assert.equal(h.document.querySelector('[role="dialog"]') !== null, true);
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.equal(h.document.activeElement === opener, true);
  } finally { await h.close(); setShellApi(null); }
});

test('closing a loading panel ignores its late preview and reopening starts a fresh task', async () => {
  let resolve!: (v: ReturnType<typeof exportDocuments>) => void, calls = 0;
  setShellApi({ previewMarkdown: () => { calls++; return calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(exportDocuments()); } } as any);
  const h = await mountDom(<Harness />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  try {
    await h.click(button('Open export')); await h.click(button(copy.cancel));
    await act(async () => resolve(exportDocuments()));
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    await h.click(button('Open export'));
    assert.equal(button(copy.markdownSaveOne).disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('partial state is exposed and empty selection cannot save; failure stays retryable without losing choices', async () => {
  let calls = 0;
  setShellApi({ previewMarkdown: async () => exportDocuments(), exportMarkdown: async () => { calls++; return calls === 1 ? { status: 'failed', code: 'markdown_failed' } : { status: 'saved' }; } } as any);
  const h = await mountDom(<Harness />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  try {
    await h.click(button('Open export'));
    await h.click(h.document.querySelector<HTMLInputElement>('.markdown-export-entry input')!);
    assert.equal(button('Claude').getAttribute('aria-pressed'), 'mixed');
    assert.equal(h.document.querySelector<HTMLInputElement>('.markdown-export-record-heading input')!.indeterminate, true);
    await h.click(button(copy.markdownClear)); assert.equal(button(copy.markdownSaveOne).disabled, true);
    await h.click(button('ChatGPT')); await h.click(button(copy.markdownSaveOne));
    assert.equal(h.document.querySelector('[role="alert"]')?.textContent, copy.markdownFailed);
    assert.equal(button('Claude').getAttribute('aria-pressed'), 'false');
    await h.click(button(copy.markdownSaveOne)); assert.equal(calls, 2);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
  } finally { await h.close(); setShellApi(null); }
});

test('one saving task blocks duplicate clicks and unmount ignores its late result', async () => {
  let calls = 0, status = '', resolve!: (value: any) => void;
  setShellApi({ previewMarkdown: async () => exportDocuments(), exportMarkdown: () => { calls++; return new Promise(r => { resolve = r; }); } } as any);
  function Single() { const flow = useMarkdownExport({ copy, locale: 'en', onStatus: text => { status = text; } });
    return <button onClick={() => { void flow.single({ kind: 'history', id: 'q1' }, 'old'); }}>Single</button>; }
  const h = await mountDom(<Single />);
  try {
    await h.click(h.document.querySelector('button')!); await h.click(h.document.querySelector('button')!);
    assert.equal(calls, 1); assert.equal(status, copy.markdownSaving);
    await h.render(null); await act(async () => resolve({ status: 'saved' }));
    assert.equal(status, copy.markdownSaving, 'late completion cannot change a different view');
  } finally { await h.close(); setShellApi(null); }
});

test('single archive export refuses a newer record rather than following its reused answer index', async () => {
  let saves = 0, status = '';
  setShellApi({ previewMarkdown: async () => [{ ...exportDocuments()[0], updatedAt: 2000 }],
    exportMarkdown: async () => { saves++; return { status: 'saved' }; } } as any);
  function Single() { const flow = useMarkdownExport({ copy, locale: 'en', onStatus: text => { status = text; } });
    return <button onClick={() => { void flow.single({ kind: 'archive', id: 'a' }, 'old', 1000); }}>Single</button>; }
  const h = await mountDom(<Single />);
  try { await h.click(h.document.querySelector('button')!); assert.equal(saves, 0); assert.equal(status, copy.markdownSourceChanged); }
  finally { await h.close(); setShellApi(null); }
});
