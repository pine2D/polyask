import { SITES } from '../../src/main/sites';
import { createArchiveRecord } from '../../src/shared/archive';

export const nativeSources = SITES.map((site, index) => ({ host: site.host, label: site.label, state: 'think' as const,
  ...(index === 0 ? { code: 'answer_truncated' } : {}),
  text: `${site.label} literal first line.\r\n\r\n**Formatted emphasis** and repeated words.\r\n\r\nRepeated literal sentence.\r\n\r\nRepeated literal sentence.\r\n\r\n`
    + Array.from({ length: 24 }, (_, paragraph) => `${site.label} source paragraph ${paragraph}: saved evidence stays complete while comparison columns scroll independently. No claim of agreement is inferred from this manual fixture.`).join('\r\n\r\n') }));
export const nativeArchive = createArchiveRecord({ text: 'Original question\r\nwith preserved source requirements.', task: 'Native saved comparison', results: nativeSources },
  { id: 'native-reading-A', now: 1700000000000, deviceId: 'fixture' });
export const nativeOther = createArchiveRecord({ text: 'Other original question', task: 'Other saved result', results: nativeSources.slice(0, 2) },
  { id: 'native-reading-B', now: 1700000000001, deviceId: 'fixture' });
