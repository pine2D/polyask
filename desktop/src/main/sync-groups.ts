import { compareSyncVersion, mergeStateFragments, type StateFragment, type VersionedSyncValue } from "../shared/sync";
import type { SiteKey } from "../shared/contracts";
import type { WorkspaceGroup } from "../shared/workspace";
import { SITES } from "./sites";

type WireGroup = VersionedSyncValue & { readonly id: string };
const hostFor = (key: SiteKey) => SITES.find((site) => site.key === key)?.host;
const known = (host: unknown) => typeof host === "string" && SITES.some((site) => site.host === host);

/**
 * Projects local groups for upload while keeping hosts this build cannot resolve, the same way
 * site order and selection keep them. An untouched group is republished verbatim (same version,
 * same content, so ties between copies cannot depend on fragment order); a local edit replaces
 * the known hosts and carries the unknown ones from the newest cloud copy, so it can win the
 * merge instead of being rolled back by it on the next pull.
 */
export function projectGroups(groups: readonly WorkspaceGroup[], remoteStates: Readonly<Record<string, StateFragment>>): Record<string, WireGroup> {
  const cloud = mergeStateFragments(Object.values(remoteStates)).materialized.groups;
  return Object.fromEntries(groups.map((value) => {
    if ("deletedAt" in value) return [value.id, value];
    const winner = cloud[value.id] as (WireGroup & { readonly hosts?: unknown }) | undefined;
    const unknown = winner && !("deletedAt" in winner) && Array.isArray(winner.hosts)
      ? winner.hosts.filter((host): host is string => typeof host === "string" && !known(host)) : [];
    if (unknown.length && winner && compareSyncVersion(winner, value) === 0) return [value.id, winner];
    const hosts = [...value.sites.flatMap((key) => hostFor(key) ?? []), ...new Set(unknown)];
    return [value.id, { id: value.id, name: value.name, hosts, updatedAt: value.updatedAt, deviceId: value.deviceId }];
  }));
}
