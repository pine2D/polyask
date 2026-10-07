import { SITE_KEYS, type SiteKey } from '../shared/contracts';

export interface ParticipationSnapshot {
  readonly opened: readonly SiteKey[];
  readonly participating: readonly SiteKey[];
  readonly excluded: readonly SiteKey[];
}

export function participationSites(value: unknown): SiteKey[] {
  if (!Array.isArray(value) || value.length > SITE_KEYS.length ||
    value.some(site => !SITE_KEYS.includes(site as SiteKey)) || new Set(value).size !== value.length) {
    throw new Error('invalid_site_selection');
  }
  return [...value] as SiteKey[];
}

export function reconcileParticipation(openPages: readonly SiteKey[], desired: readonly SiteKey[]): ParticipationSnapshot {
  const opened = participationSites(openPages), requested = participationSites(desired);
  const participating = requested.filter(site => opened.includes(site));
  return { opened, participating, excluded: opened.filter(site => !participating.includes(site)) };
}

/** Opening a new send group never removes or silently reorders an existing page. */
export function pagesNeededForParticipation(openPages: readonly SiteKey[], desired: readonly SiteKey[]): readonly SiteKey[] {
  const opened = participationSites(openPages), requested = participationSites(desired);
  return [...opened, ...requested.filter(site => !opened.includes(site))];
}

export function isPageReorder(openPages: readonly SiteKey[], next: readonly SiteKey[]): boolean {
  const opened = participationSites(openPages), ordered = participationSites(next);
  return ordered.length === opened.length && ordered.every(site => opened.includes(site));
}
