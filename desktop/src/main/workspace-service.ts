import { randomUUID } from "node:crypto";

import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { NewSessionSiteResult, Tier } from "../shared/protocol";
import {
  createWorkspaceGroup,
  groupSignature,
  isActiveWorkspaceGroup,
  normalizeSelection,
  tombstoneWorkspaceGroup,
  workspacePresets,
  type ActiveWorkspaceGroup,
  type WorkspaceGroup,
  type WorkspaceGroupTombstone,
  type WorkspaceState
} from "../shared/workspace";
import type { MetaRepository } from "./meta-repository";
import { nextSyncTime } from "../shared/sync";
import { SITES } from "./sites";
import type { StateRepository } from "./state-repository";

const WORKSPACE_KEY = "workspace";
// 新会话占着 OperationGate 等各站主帧提交的硬上限。Windows 真机 18 次新会话导航（两轮×9 站）里
// 发起→did-navigate 为 96–3557ms（最慢是锁屏下的 Gemini），常态 ≤1.8s。原取 10s，2026-10-05 Windows 第 6 轮
// 网络整体变慢时 ChatGPT 带 Cookie 的 HTML 约 13s 才回（页内 fetch 实测 13075ms），新会话超过 10s 被判 not_ready、
// 实际只是慢：上限低于实测值。现取 20s ≈ 13s 的 1.5 倍（≥20% 余量），门的占用仍远低于 did-finish-load 的 23–48s。
// 到点把该站报 not_ready、放开门之前，先经 abandon 中止仍未提交的导航并把该站钉成 load_failed：主帧没提交时
// 旧文档（旧会话）还活着、preload 照常应答，不收口的话下一次群发会打进旧会话，卡住的导航日后再提交还会
// 把发送/生成中的页面换掉（submit_unconfirmed → 用户重试 = 同一问题问两遍）。
export const NEW_SESSION_COMMIT_CAP_MS = 20_000;
const GROUP_PREFIX = "group:";

interface StoredWorkspace {
  readonly selectedSites: readonly SiteKey[];
  readonly tier: Tier;
  readonly updatedAt: number;
  readonly deviceId: string;
}

interface SaveGroupInput {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly sites?: unknown;
}

interface WorkspaceServiceOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly createDeviceId?: () => string;
  readonly onNewSession?: (sites: readonly SiteKey[]) => void;
  readonly navigationCapMs?: number;
  // 导航发起前取该站视图身份；到点时据此中止导航（视图已换掉则不动）。
  readonly context?: (site: SiteKey) => number | undefined;
  readonly abandon?: (site: SiteKey, contentsId: number) => void;
}

type NavigateSite = (site: SiteKey, url: string) => void | Promise<void>;

function strictSelection(value: unknown, allowEmpty: boolean): SiteKey[] {
  if (!Array.isArray(value)) throw new Error("invalid_site_selection");
  const seen = new Set<SiteKey>();
  for (const item of value) {
    if (typeof item !== "string" || !SITE_KEYS.includes(item as SiteKey)) {
      throw new Error("unknown_site");
    }
    const site = item as SiteKey;
    if (seen.has(site)) throw new Error("duplicate_site");
    seen.add(site);
  }
  if (!allowEmpty && seen.size === 0) throw new Error("no_selected_sites");
  return SITE_KEYS.filter((site) => seen.has(site));
}

function validTier(value: unknown): value is Tier {
  return value === null || value === "fast" || value === "think";
}

function validGroup(value: unknown): value is WorkspaceGroup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceGroup>;
  return typeof candidate.id === "string" && typeof candidate.updatedAt === "number";
}

export class WorkspaceService {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly createDeviceId: () => string;
  private readonly onNewSession: (sites: readonly SiteKey[]) => void;
  private readonly navigationCapMs: number;
  private readonly context: (site: SiteKey) => number | undefined;
  private readonly abandon: (site: SiteKey, contentsId: number) => void;

  constructor(
    private readonly state: StateRepository,
    private readonly meta: MetaRepository,
    private readonly navigate: NavigateSite,
    options: WorkspaceServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.createDeviceId = options.createDeviceId ?? randomUUID;
    this.onNewSession = options.onNewSession ?? (() => undefined);
    this.navigationCapMs = options.navigationCapMs ?? NEW_SESSION_COMMIT_CAP_MS;
    this.context = options.context ?? (() => undefined);
    this.abandon = options.abandon ?? (() => undefined);
  }

  getState(): WorkspaceState {
    const stored = this.state.get<Partial<StoredWorkspace>>(WORKSPACE_KEY);
    const selectedSites = stored && Array.isArray(stored.selectedSites)
      ? normalizeSelection(stored.selectedSites)
      : [...SITE_KEYS];
    const tier = stored && validTier(stored.tier) ? stored.tier : null;
    const groups = this.state.list<unknown>(GROUP_PREFIX)
      .filter(validGroup)
      .filter(isActiveWorkspaceGroup);
    return { selectedSites, tier, groups };
  }

  setSelection(value: unknown): WorkspaceState {
    const selectedSites = strictSelection(value, true);
    this.writeWorkspace(selectedSites, this.getState().tier);
    return this.getState();
  }

  setTier(value: unknown): WorkspaceState {
    if (!validTier(value)) throw new Error("invalid_tier");
    this.writeWorkspace(this.getState().selectedSites, value);
    return this.getState();
  }

  saveGroup(input: SaveGroupInput): ActiveWorkspaceGroup {
    if (!input || typeof input !== "object") throw new Error("invalid_group");
    const sites = strictSelection(input.sites, true);
    const signature = groupSignature(sites);
    const reserved = Object.entries(workspacePresets(SITES))
      .filter(([key]) => key !== "clear")
      .some(([, preset]) => groupSignature(preset) === signature);
    if (reserved) throw new Error("reserved_group_sites");
    const existingGroups = this.getState().groups;
    const requestedId = typeof input.id === "string" && input.id.trim() ? input.id : null;
    if (existingGroups.some((group) => group.id !== requestedId && groupSignature(group.sites) === signature)) {
      throw new Error("duplicate_group_sites");
    }
    const sameName = existingGroups.find((group) => group.name === String(input.name ?? "").trim());
    const id = requestedId ?? sameName?.id ?? this.createId();
    const current = this.state.get<WorkspaceGroup>(`${GROUP_PREFIX}${id}`);
    const group = createWorkspaceGroup({
      id,
      name: typeof input.name === "string" ? input.name : "",
      sites
    }, { now: current ? nextSyncTime(this.now(), current.updatedAt, "deletedAt" in current ? current.deletedAt : 0) : this.now(), deviceId: this.deviceId() });
    this.state.put(`${GROUP_PREFIX}${group.id}`, group, group.updatedAt);
    return group;
  }

  deleteGroup(id: unknown): WorkspaceGroupTombstone {
    if (typeof id !== "string" || !id.trim() || id.length > 128) throw new Error("invalid_group_id");
    const group = this.state.get<WorkspaceGroup>(`${GROUP_PREFIX}${id}`);
    if (!validGroup(group) || !isActiveWorkspaceGroup(group)) throw new Error("group_not_found");
    const deleted = tombstoneWorkspaceGroup(group, nextSyncTime(this.now(), group.updatedAt), this.deviceId());
    this.state.put(`${GROUP_PREFIX}${id}`, deleted, deleted.updatedAt);
    return deleted;
  }

  async newSession(value: unknown): Promise<NewSessionSiteResult[]> {
    const sites = strictSelection(value, false);
    this.onNewSession(sites);
    const settled = await Promise.allSettled(sites.map((site) => {
      const definition = SITES.find((candidate) => candidate.key === site);
      if (!definition) throw new Error("unknown_site");
      const contentsId = this.context(site);
      return this.capped(() => this.navigate(site, definition.url), () => {
        if (contentsId !== undefined) this.abandon(site, contentsId);
      });
    }));
    return sites.map((site, index) => settled[index].status === "fulfilled"
      ? { site, ok: true }
      : { site, ok: false, code: "not_ready" });
  }

  private capped(navigate: () => void | Promise<void>, onTimeout: () => void): Promise<void> {
    // 先发起导航（同步抛出照旧让整批 reject，如 view_manager_not_ready），再起计时器。
    const navigation = Promise.resolve(navigate());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // 先收口再放门：abandon 抛错也不能让这一站卡在「导航未提交、群发照常派发」的状态里不报。
        try { onTimeout(); } finally { reject(new Error("navigation_timeout")); }
      }, this.navigationCapMs);
    });
    return Promise.race([navigation, timeout]).finally(() => clearTimeout(timer));
  }

  private writeWorkspace(selectedSites: readonly SiteKey[], tier: Tier): void {
    const current = this.state.get<StoredWorkspace>(WORKSPACE_KEY);
    const updatedAt = current ? nextSyncTime(this.now(), current.updatedAt) : this.now();
    this.state.put<StoredWorkspace>(WORKSPACE_KEY, {
      selectedSites,
      tier,
      updatedAt,
      deviceId: this.deviceId()
    }, updatedAt);
  }

  private deviceId(): string {
    const stored = this.meta.get<unknown>("deviceId");
    if (typeof stored === "string" && stored) return stored;
    return this.meta.put("deviceId", this.createDeviceId());
  }
}
