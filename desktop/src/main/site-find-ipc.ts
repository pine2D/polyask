import { SITE_KEYS, type SiteKey } from '../shared/contracts';
import { parseSiteFindRequest } from '../shared/site-find';
import type { SiteFindController } from './site-find';

interface IpcRegistry {
  handle(channel: string, listener: (event: any, value?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}
interface ShellContents {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}
export function registerSiteFindIpc(ipc: IpcRegistry, controller: SiteFindController,
  trusted: (event: any) => boolean, contents: ShellContents): () => void {
  const channels = {
    'polyask:find-open': () => controller.open(),
    'polyask:find-state': () => controller.state,
    'polyask:find-query': (value: unknown) => {
      const request = parseSiteFindRequest(value);
      if (!request) throw Error('invalid_site_find_request');
      return controller.find(request);
    },
    'polyask:find-move': (value: unknown) => {
      if (value !== 1 && value !== -1) throw Error('invalid_site_find_direction');
      return controller.move(value);
    },
    'polyask:find-select': (value: unknown) => {
      if (typeof value !== 'string' || !SITE_KEYS.includes(value as SiteKey)) throw Error('invalid_site');
      return controller.select(value as SiteKey);
    },
    'polyask:find-close': (value: unknown) => {
      if (value !== undefined && typeof value !== 'boolean') throw Error('invalid_site_find_request');
      return controller.close(value !== false);
    }
  };
  for (const [channel, action] of Object.entries(channels)) ipc.handle(channel, (event, value) => {
    if (!trusted(event)) throw Error('untrusted_sender');
    return action(value);
  });
  const onInput = (event: any, input: any) => controller.handleInput(event, input);
  contents.on('before-input-event', onInput);
  return () => {
    contents.off('before-input-event', onInput);
    for (const channel of Object.keys(channels)) ipc.removeHandler(channel);
    controller.close(false);
  };
}
