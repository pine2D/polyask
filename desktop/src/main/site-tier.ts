import type { WebContentsView } from 'electron';
import type { SiteKey } from '../shared/contracts';
import type { SiteResult } from '../shared/protocol';
import { normalizeSelectionMetadata } from '../shared/selection';
import { navigationDisposition } from './navigation';
import type { SiteCommandChannel } from './site-command-channel';
import { SITES } from './sites';

/** 切档不产生提交状态，也不重建/重载视图；生成监控与采集保持原归属。 */
export async function switchSiteTier(site: SiteKey, view: WebContentsView | undefined,
  failure: string | null, navigating: boolean, commands: SiteCommandChannel,
  tier: 'think' | 'fast', deadline: number): Promise<SiteResult> {
  if (!view || view.webContents.isDestroyed()) return { ok: false, code: 'no_view' };
  if (failure) return { ok: false, code: failure };
  const contents = view.webContents, definition = SITES.find(item => item.key === site);
  if (!definition || navigating || navigationDisposition(definition, contents.getURL()) !== 'site') return { ok: false, code: 'not_ready' };
  const url = contents.getURL();
  const response = await commands.send(contents, { source: 'AMS', cmd: 'setTier', tier, deadline },
    { timeoutResult: { ok: false, code: 'timeout' } });
  if (Date.now() >= deadline) return { ok: false, code: 'timeout' };
  if (contents.isDestroyed() || contents.getURL() !== url) return { ok: false, code: 'not_ready' };
  if (!('ok' in response) || typeof response.ok !== 'boolean') return { ok: false, code: 'invalid_response' };
  const { selection } = normalizeSelectionMetadata(response);
  if (!response.ok) return { ok: false, code: 'code' in response ? response.code : 'error', ...(selection ? { selection } : {}) };
  if (!selection || selection.requested !== tier || selection.outcome === 'unconfirmed') return { ok: false, code: 'tier_unconfirmed' };
  return { ok: true, selection };
}
