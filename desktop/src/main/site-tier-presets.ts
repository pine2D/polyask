import type { WebContentsView } from 'electron';
import type { SiteKey } from '../shared/contracts';
import { isPresetSite, isTierPresetAction, normalizeTierPresetResult, type TierPresetAction, type TierPresetResult } from '../shared/tier-presets';
import { navigationDisposition } from './navigation';
import type { SiteCommandChannel } from './site-command-channel';
import { reassertPainting } from './paint-recovery';
import { SITES } from './sites';

/** 只作用于指定的已打开站点；导航（包括同 URL 页内导航）使整次读取/验证失效。 */
export async function inspectSitePreset(site: SiteKey, view: WebContentsView | undefined, failure: string | null,
  navigating: boolean, busy: boolean, commands: SiteCommandChannel, action: TierPresetAction, deadline: number): Promise<TierPresetResult> {
  if (!isPresetSite(site) || !isTierPresetAction(action)) return { ok: false, code: 'invalid_response' };
  if (!view || view.webContents.isDestroyed()) return { ok: false, code: 'no_view' };
  const contents = view.webContents, definition = SITES.find(candidate => candidate.key === site)!;
  if (failure || navigating || navigationDisposition(definition, contents.getURL()) !== 'site') return { ok: false, code: 'not_ready' };
  if (busy) return { ok: false, code: "preset_busy" };
  if (!Number.isFinite(deadline) || Date.now() >= deadline) return { ok: false, code: 'timeout' };
  // 设置页会遮挡站点；菜单动画依赖出帧，沿用现有恢复机制且不覆盖刻意开启的节流。
  reassertPainting(contents);
  const url = contents.getURL(); let navigated = false;
  const onNavigation = (details: { isMainFrame?: boolean }) => {
    if (!details.isMainFrame) return;
    navigated = true;
    // 不排在交互队列后面：同 URL 导航也须阻止运行时下一次选择/恢复。
    if (!contents.isDestroyed()) contents.send('polyask:preset-invalidate');
  };
  contents.on('did-start-navigation', onNavigation);
  try {
    const response = await commands.send(contents, { source: 'AMS', cmd: 'tierPreset', action, deadline },
      { timeoutResult: { ok: false, code: 'timeout' } });
    if (Date.now() >= deadline) return { ok: false, code: 'timeout' };
    if (navigated || contents.isDestroyed() || contents.getURL() !== url) return { ok: false, code: 'not_ready' };
    return normalizeTierPresetResult(response);
  } finally { contents.removeListener('did-start-navigation', onNavigation); }
}
