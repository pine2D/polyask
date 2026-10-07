import type { SiteDefinition, SiteKey } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { unsupportedImageSites } from '../shared/images';

export function imageSupportWarning(copy: DesktopCopy, count: number, participating: ReadonlySet<SiteKey>,
  sites: readonly SiteDefinition[], locale: string) {
  const unsupported = new Set(count ? unsupportedImageSites([...participating], sites) : []);
  const unsupportedSites = sites.filter(site => unsupported.has(site.key));
  const imageWarning = unsupportedSites.length ? formatCopy(copy.imageUnsupported, {
    sites: new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(unsupportedSites.map(site => site.label))
  }) : null;
  return { unsupportedSites, imageWarning };
}
