import { SITE_KEYS, type SiteKey } from '../shared/contracts';
import { parseSiteFindRequest, type SiteFindMenuAction, type SiteFindState } from '../shared/site-find';
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
  trusted: (event: any) => boolean, contents: ShellContents,
  menu?: (state: SiteFindState) => Promise<SiteFindMenuAction>): () => void {
  let active = true, menuPending = false;
  const showMenu = (value: unknown): Promise<SiteFindState> => {
    if (!value || typeof value !== 'object') throw Error('invalid_site_find_request');
    const { session, revision } = value as Record<string, unknown>;
    if (!Number.isSafeInteger(session) || !Number.isSafeInteger(revision) || (session as number) < 0 || (revision as number) < 0)
      throw Error('invalid_site_find_request');
    const snapshot = controller.state;
    const current = () => active && controller.state.open && controller.state.session === snapshot.session &&
      controller.state.revision === snapshot.revision && controller.state.query === snapshot.query && controller.state.scope === snapshot.scope;
    if (!menu || menuPending || !snapshot.open || session !== snapshot.session || revision !== snapshot.revision) return Promise.resolve(controller.state);
    menuPending = true;
    return menu(snapshot).then(action => {
      if (current() && action) {
        if (action.kind === 'select') return controller.select(action.site);
        if (action.kind === 'refresh') return controller.find({ query: snapshot.query, scope: snapshot.scope });
      }
      return controller.state;
    }).finally(() => { menuPending = false; });
  };
  const channels = {
    'polyask:find-menu': showMenu,
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
    if (!active || !trusted(event)) throw Error('untrusted_sender');
    return action(value);
  });
  const onInput = (event: any, input: any) => controller.handleInput(event, input);
  contents.on('before-input-event', onInput);
  return () => {
    active = false;
    contents.off('before-input-event', onInput);
    for (const channel of Object.keys(channels)) ipc.removeHandler(channel);
    controller.close(false);
  };
}
