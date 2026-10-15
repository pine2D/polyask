import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveCollectionActions } from '../src/renderer/archive-collection-actions';
import { getCopy } from '../src/shared/copy';
import { setShellApi } from '../src/renderer/shell-api';
import { archiveFixture } from './fixtures';

for (const locale of ['en', 'zh-CN', 'zh-TW']) {
  test(`${locale}: save-and-copy reports the completed stage without collecting twice`, async () => {
    const copy = getCopy(locale), record = archiveFixture();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      for (const failure of ['none', 'capture', 'markdown', 'clipboard']) {
        let captures = 0, exports = 0, writes = 0;
        const notices: string[] = [];
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: locale, clipboard: {
          writeText: async (value: string) => { writes++; assert.equal(value, '# Exact saved answer\n');
            if (failure === 'clipboard') throw Error('clipboard_refused'); }
        } } });
        setShellApi({ archiveMarkdown: async (id: string, language: string) => {
          exports++; assert.equal(id, record.id); assert.equal(language, locale);
          if (failure === 'markdown') throw Error('export_failed');
          return '# Exact saved answer\n';
        } } as any);
        const actions = archiveCollectionActions({ copy, runAuxiliary: action => action(),
          capture: { capture: async () => { captures++; if (failure === 'capture') throw Error('capture_failed'); return record; } },
          synthesis: { collect: async () => record.id }, openArchive: () => assert.fail('copy must preserve the current page'),
          announce: value => notices.push(value) });
        await actions.collectAndCopy();
        assert.equal(captures, 1, 'partial success must not recapture or repeat the save');
        assert.equal(exports, failure === 'capture' ? 0 : 1);
        assert.equal(writes, failure === 'capture' || failure === 'markdown' ? 0 : 1);
        assert.equal(notices.length, 1);
        assert.equal(notices[0], failure === 'none' ? copy.archiveCollected
          : failure === 'capture' ? copy.archiveCollectFailed : copy.archiveSavedCopyFailed);
      }
    } finally {
      setShellApi(null);
      if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
}
