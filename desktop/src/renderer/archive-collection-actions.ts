import { type DesktopCopy } from '../shared/copy';
import type { ArchiveRecord } from '../shared/archive';
import type { useArchiveCapture } from './use-archive-capture';
import type { useSynthesisFlow } from './use-synthesis-flow';
import { shell } from './shell-api';

export function archiveCollectionActions(options: {
  copy: DesktopCopy; capture: Pick<ReturnType<typeof useArchiveCapture>, 'capture'>; synthesis: Pick<ReturnType<typeof useSynthesisFlow>, 'collect'>;
  runAuxiliary: (action: () => Promise<void>) => Promise<void>;
  openArchive: (id?: string, mode?: 'read' | 'compare') => void;
  announce: (text: string, notice?: boolean, durable?: boolean) => void;
}) {
  const collectAndCopy = () => options.runAuxiliary(async () => {
    try {
      const record = await options.capture.capture();
      await navigator.clipboard.writeText(await shell.archiveMarkdown(record.id, navigator.language));
      options.announce(options.copy.archiveCollected, true, true);
    } catch { options.announce(options.copy.archiveCollectFailed); }
  });
  const collectSynthesis = () => options.runAuxiliary(async () => {
    try { const id = await options.synthesis.collect(); options.openArchive(id, 'read'); }
    catch { options.announce(options.copy.synthesisCollectFailed); }
  });
  const collectAndCompare = () => options.runAuxiliary(async () => {
    try {
      const record: ArchiveRecord = await options.capture.capture();
      options.openArchive(record.id);
      options.announce(record.results.filter(answer => answer.text?.trim()).length >= 2
        ? options.copy.archiveSaved : options.copy.compareNeedsAnswers);
    } catch { options.announce(options.copy.archiveCollectFailed); }
  });
  return { collectAndCopy, collectSynthesis, collectAndCompare };
}
