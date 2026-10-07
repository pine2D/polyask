import { useEffect, useRef, useState } from 'react';
import type { FolderTarget } from '../shared/task-folder';
import { shell } from './shell-api';
import { bulkMarkdown, mergeBulkOutcomes, runLibraryBulk, targetKey, type BulkOutcome, type BulkRequest } from './library-bulk-runner';

function download(markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `polyask-selection-${new Date().toISOString().slice(0, 10)}.md`;
  try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 5_000); }
}
async function perform(target: FolderTarget, request: BulkRequest): Promise<string | void> {
  if (request.action === 'add-folder') {
    await shell.patchFolderMemberships(target, (request.folderIds ?? []).map(folderId => ({ folderId, present: true })));
  } else if (request.action === 'favorite') {
    if (target.kind !== 'archive') throw new Error('archive_only');
    await shell.updateArchive(target.id, { favorite: request.favorite !== false });
  } else return target.kind === 'archive' ? shell.archiveMarkdown(target.id, request.locale) : shell.decisionMarkdown(target.id, request.locale);
}

export function useLibraryBulk(onBlocking: (busy: boolean) => void, onComplete: () => void) {
  const [running, setRunning] = useState(false), [done, setDone] = useState(0);
  const [result, setResult] = useState<{ request: BulkRequest; outcome: BulkOutcome } | null>(null);
  const pending = useRef(false), stopping = useRef(false), mounted = useRef(true);
  const callbacks = useRef({ onBlocking, onComplete }); callbacks.current = { onBlocking, onComplete };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopping.current = true; }; }, []);
  const execute = async (request: BulkRequest, original?: { request: BulkRequest; outcome: BulkOutcome }, skipped: readonly FolderTarget[] = []) => {
    if (pending.current || !mounted.current || (!request.targets.length && !skipped.length)) return;
    if (request.action === 'favorite' && request.targets.some(target => target.kind !== 'archive')) return;
    pending.current = true; stopping.current = false;
    callbacks.current.onBlocking(true); setRunning(true); setDone(0);
    try {
      const next = await runLibraryBulk(request, { perform, progress: value => { if (mounted.current) setDone(value); } },
        () => stopping.current || !mounted.current);
      if (!mounted.current) return;
      const outcome = original ? mergeBulkOutcomes(original.outcome, { ...next, stopped: [...next.stopped, ...skipped] }, [...request.targets, ...skipped]) : next;
      const complete = original?.request ?? request;
      setResult({ request: complete, outcome });
      if (complete.action === 'export') {
        const markdown = bulkMarkdown(complete, outcome);
        if (markdown !== null && !stopping.current) download(markdown);
      }
      callbacks.current.onComplete();
    } finally {
      pending.current = false;
      if (mounted.current) { setRunning(false); callbacks.current.onBlocking(false); }
    }
  };
  return { running, done, result, start: (request: BulkRequest) => { setResult(null); void execute(request); },
    stop: () => { stopping.current = true; },
    retry: (live: readonly FolderTarget[]) => {
      if (!result || pending.current) return;
      const keys = new Set(live.map(targetKey));
      const targets = result.outcome.failed.filter(target => keys.has(targetKey(target)));
      const skipped = result.outcome.failed.filter(target => !keys.has(targetKey(target)));
      void execute({ ...result.request, targets }, result, skipped);
    } };
}
