import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { DRAFT_KINDS, type DraftKind } from '../shared/drafts';
import { isPreferenceKey, PREFERENCE_GROUPS, type PreferenceGroup, type PreferenceValues } from '../shared/preferences';
import type { PreferenceRuntime } from './preference-runtime';

const CHANNELS = ['polyask:preferences', 'polyask:preferences-seed', 'polyask:preference-set',
  'polyask:preferences-follow', 'polyask:draft-sync', 'polyask:draft-list', 'polyask:draft-save', 'polyask:draft-remove'] as const;
export function registerPreferencesDraftsIpc(options: { readonly runtime: PreferenceRuntime;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean; readonly publishDrafts: () => void }): () => void {
  const handle = (channel: typeof CHANNELS[number], action: (value: any) => unknown) => {
    ipcMain.handle(channel, (event, value: unknown) => {
      if (!options.trusted(event)) throw new Error('untrusted_sender');
      return action(value);
    });
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
    return value as Record<string, unknown>;
  };
  const epoch = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('invalid_request');
    return Number(value);
  };
  const { runtime } = options;
  handle(CHANNELS[0], () => runtime.snapshot());
  handle(CHANNELS[1], value => runtime.seed(object(value) as Partial<PreferenceValues>));
  handle(CHANNELS[2], value => {
    const v = object(value); if (!isPreferenceKey(v.key)) throw new Error('invalid_preference');
    return runtime.set(v.key, v.value);
  });
  handle(CHANNELS[3], value => {
    const v = object(value);
    if (!PREFERENCE_GROUPS.includes(v.group as PreferenceGroup) || typeof v.enabled !== 'boolean') throw new Error('invalid_preference_group');
    return runtime.follow(v.group as PreferenceGroup, v.enabled);
  });
  handle(CHANNELS[4], value => {
    if (typeof value !== 'boolean') throw new Error('invalid_draft');
    const result = runtime.setDraftSync(value); options.publishDrafts(); return result;
  });
  handle(CHANNELS[5], value => {
    const v = value === undefined ? {} : object(value);
    if ((v.kind !== undefined && !DRAFT_KINDS.includes(v.kind as DraftKind)) ||
      (v.context !== undefined && (typeof v.context !== 'string' || [...v.context].length > 512))) throw new Error('invalid_draft');
    return { epoch: runtime.drafts.epoch(), deviceId: runtime.snapshot().deviceId,
      drafts: runtime.drafts.list(v.kind as DraftKind | undefined, v.context as string | undefined) };
  });
  handle(CHANNELS[6], value => {
    const v = object(value), result = runtime.drafts.save(v.input, epoch(v.epoch));
    options.publishDrafts(); return result;
  });
  handle(CHANNELS[7], value => {
    const v = object(value);
    if (typeof v.id !== 'string' || typeof v.updatedAt !== 'number') throw new Error('invalid_draft');
    const result = runtime.drafts.remove(v.id, v.updatedAt, epoch(v.epoch));
    options.publishDrafts(); return result;
  });
  return () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); };
}
