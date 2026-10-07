import type { SiteKey, SiteDefinition } from '../shared/contracts';
import { SITES } from './sites';

export function ensureSiteViews(selected: readonly SiteKey[], views: ReadonlyMap<SiteKey, unknown>,
  create: (definition: SiteDefinition) => void): void {
  for (const key of selected) {
    if (views.has(key)) continue;
    const definition = SITES.find(site => site.key === key);
    if (definition) create(definition);
  }
}
