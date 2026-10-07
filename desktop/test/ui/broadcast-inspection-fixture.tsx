import { setShellApi } from '../../src/renderer/shell-api';
import { SITES } from '../../src/main/sites';
import type { PolyAskDesktopApi } from '../../src/preload/shell';
import type { SiteKey } from '../../src/shared/contracts';
import { getCopy } from '../../src/shared/copy';

let selected: SiteKey[] = ['claude', 'chatgpt'];
let sends = 0, selections = 0;
let mainSelected = [...selected], inspections = 0;
const layouts: {mode: string; site: SiteKey}[] = [];
const workspace = () => ({ selectedSites: [...selected], groups: [], tier: null });
const sync = { state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false,
  oauthConfigured: false, secureTokenStorage: false } as const;
setShellApi(new Proxy({
  bootstrap: async () => ({ runtime: {version: 'fixture', distribution: 'installed'}, sites: SITES,
    statuses: [], layout: {mode: 'overview', focused: 'claude', page: 0, pageCount: 1, placements: []},
    workspace: workspace(), promptLibrary: {templates: [], history: []}, pendingSynthesis: null, sync }),
  setDisplayPreferences: async (value: unknown) => value,
  setSelection: async (value: SiteKey[]) => { selections++; selected = [...value]; mainSelected = [...value]; return workspace(); },
  inspectSite: async (site: SiteKey) => {
    inspections++;
    if (!mainSelected.includes(site)) return false;
    layouts.push({mode: 'focus', site}); return true;
  },
  setLayout: (mode: string, site: SiteKey) => { layouts.push({mode, site}); },
  setSurface: () => {}, setDrawerOpen: () => {}, setComposerExpanded: () => {}, setCompletionNotifications: () => {},
  broadcast: async () => { sends++; return [{site: 'claude', ok: false, code: 'submit_unconfirmed'}, {site: 'chatgpt', ok: true}]; }
}, {get: (target, key) => Reflect.get(target, key) ?? (String(key).startsWith('on') ? () => () => {} : async () => [])}) as unknown as PolyAskDesktopApi);
(window as any).inspectionFixture = { copy: getCopy('en'), state: () => ({selected, mainSelected, sends, selections, inspections, layouts}),
  mainRemove: (site: SiteKey) => { mainSelected = mainSelected.filter(key => key !== site); } };
void import('../../src/renderer/index');
