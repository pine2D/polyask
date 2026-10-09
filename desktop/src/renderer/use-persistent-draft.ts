import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftCopy } from '../shared/draft-copy';
import type { DraftInput, StoredDraft } from '../shared/drafts';
import { parseStoredDraft } from '../shared/drafts';
import { PersistentDraftClient, type DraftClientApi } from './draft-client';
import type { DraftReceipt } from './draft-receipt';
import type { DraftRecoveryProps } from './draft-recovery';
import { shell } from './shell-api';

export interface PersistentDraftOptions extends DraftInput {
  readonly enabled?: boolean;
  readonly dirty?: boolean;
  readonly copy?: DraftCopy;
  readonly onRestore: (content: unknown, draft: StoredDraft) => void | boolean | Promise<void | boolean>;
}

const RESET_EVENT = 'polyask:drafts-reset';
// Older component fixtures can omit the draft bridge entirely; production preload supplies it.
const draftApi: DraftClientApi = new Proxy({} as DraftClientApi, { get(_target, key) {
  try { return (shell as unknown as Record<PropertyKey, unknown>)[key]; } catch { return undefined; }
} });
/** Call synchronously at the start of a local reset, before awaiting its IPC. */
export function invalidatePersistentDrafts(): void { window.dispatchEvent(new Event(RESET_EVENT)); }

export type DraftRecoveryState = Omit<DraftRecoveryProps, 'copy'>;

export function usePersistentDraft(options: PersistentDraftOptions) {
  const [, render] = useState(0);
  const latest = useRef(options); latest.current = options;
  const client = useMemo(() => new PersistentDraftClient(draftApi,
    () => render(value => value + 1)), [options.kind, options.context]);
  client.edit({ kind: options.kind, context: options.context, title: options.title, content: options.content,
    ...(options.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: options.sourceUpdatedAt }) },
  options.enabled ?? true, options.dirty ?? true);
  const signature = JSON.stringify(client.currentInput());

  useEffect(() => {
    client.activate();
    const unsubscribe = draftApi.onDraftsChanged?.(() => { void client.refresh(); });
    const reset = () => client.invalidate();
    window.addEventListener(RESET_EVENT, reset);
    void client.refresh();
    return () => { unsubscribe?.(); window.removeEventListener(RESET_EVENT, reset); client.dispose(); };
  }, [client]);
  useEffect(() => { client.schedule(); }, [client, signature, options.enabled, options.dirty]);

  const recovery: DraftRecoveryState = {
    ...client.snapshot(), dirty: options.dirty ?? true, sourceUpdatedAt: options.sourceUpdatedAt,
    contextKey: JSON.stringify([options.kind, options.context]),
    onRestore: async value => {
      const draft = parseStoredDraft(value);
      if (!draft || !client.isCurrentDraft(draft)) return false;
      try { return (await latest.current.onRestore(draft.content, draft)) !== false; }
      catch { return false; }
    },
    onRemove: value => client.remove(value), onRetry: () => { void client.flush(); }
  };
  return { recovery, flush: () => client.flush(), clearSaved: (expected?: DraftReceipt) => client.clearSaved(expected),
    reset: () => client.invalidate() };
}
