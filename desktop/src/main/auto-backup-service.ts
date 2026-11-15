import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AutoBackupSummary, BackupPreview } from "../shared/backup";
import type { BackupGuard } from "./backup-container";
import { BackupService } from "./backup-service";
import { DesktopDatabase, LOCAL_DB_SCHEMA_VERSION, peekProtectedSqliteState } from "./database";

export const MAX_AUTO_BACKUPS = 5;
export const CURRENT_PROTECTED_SYNC_SCHEMA = 7;

const PROTECTED_RUNTIME_META_KEY = "lastProtectedRuntime";
const AUTO_BACKUP_DIR_NAME = "auto-backups";
const AUTO_BACKUP_ID_PATTERN = /^auto-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/;

interface ProtectedRuntimeState {
  readonly version: string;
  readonly dbSchema: number;
  readonly syncSchema: number;
  readonly updatedAt: number;
}

interface StoredAutoBackupMeta {
  readonly format: 1;
  readonly id: string;
  readonly filename: string;
  readonly fromVersion: string | null;
  readonly toVersion: string;
  readonly fromDbSchema: number | null;
  readonly toDbSchema: number;
  readonly fromSyncSchema: number | null;
  readonly toSyncSchema: number;
  readonly createdAt: number;
  readonly textOnly: boolean;
}

export interface CaptureUpgradeInput {
  readonly currentVersion: string;
  readonly currentDbSchema?: number;
  readonly currentSyncSchema?: number;
  readonly preOpenDbSchema?: number | null;
}

export class AutoBackupService {
  private readonly dir: string | null;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly maxSnapshots: number;

  constructor(
    private readonly database: DesktopDatabase,
    private readonly backup: BackupService,
    options?: {
      readonly userDataPath?: string;
      readonly now?: () => number;
      readonly createId?: () => string;
      readonly maxSnapshots?: number;
    }
  ) {
    this.dir = options?.userDataPath ? join(options.userDataPath, AUTO_BACKUP_DIR_NAME) : null;
    this.now = options?.now ?? Date.now;
    this.createId = options?.createId ?? randomUUID;
    this.maxSnapshots = Math.max(1, options?.maxSnapshots ?? MAX_AUTO_BACKUPS);
  }

  async captureIfUpgrading(input: CaptureUpgradeInput): Promise<AutoBackupSummary | null> {
    if (!this.dir) return null;
    let tempPolyask: string | null = null;
    let tempMeta: string | null = null;
    try {
      const currentDbSchema = input.currentDbSchema ?? LOCAL_DB_SCHEMA_VERSION;
      const currentSyncSchema = input.currentSyncSchema ?? CURRENT_PROTECTED_SYNC_SCHEMA;
      const saved = readProtectedRuntime(this.database.meta.get<unknown>(PROTECTED_RUNTIME_META_KEY));
      const effectiveFromDbSchema = resolvePreviousDbSchema(saved?.dbSchema ?? null, input.preOpenDbSchema ?? null);
      if (!isUpgradeNeeded(saved, input.preOpenDbSchema ?? null, input)) return null;

      if (!this.database.hasUserRecords()) {
        this.database.meta.put(PROTECTED_RUNTIME_META_KEY, {
          version: input.currentVersion,
          dbSchema: currentDbSchema,
          syncSchema: currentSyncSchema,
          updatedAt: this.now()
        } satisfies ProtectedRuntimeState);
        return null;
      }

      const timestamp = this.now();
      const id = formatAutoBackupId(timestamp, this.createId());
      tempPolyask = join(this.dir, `${id}.polyask.tmp`);
      tempMeta = join(this.dir, `${id}.json.tmp`);
      const finalPolyask = join(this.dir, `${id}.polyask`);
      const finalMeta = join(this.dir, `${id}.json`);

      await mkdir(this.dir, { recursive: true });
      const guard = this.backup.beginOperation();
      const missing = await this.backup.missingOriginals(guard);
      const textOnly = missing.length > 0;
      await this.backup.exportFile(tempPolyask, textOnly ? "text-only" : "complete", guard);
      const info = await stat(tempPolyask);
      const filename = buildDisplayFilename(saved?.version ?? null, input.currentVersion, timestamp);
      const meta: StoredAutoBackupMeta = {
        format: 1,
        id,
        filename,
        fromVersion: saved?.version ?? null,
        toVersion: input.currentVersion,
        fromDbSchema: effectiveFromDbSchema,
        toDbSchema: currentDbSchema,
        fromSyncSchema: saved?.syncSchema ?? null,
        toSyncSchema: currentSyncSchema,
        createdAt: timestamp,
        textOnly
      };
      await writeFile(tempMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
      await rename(tempPolyask, finalPolyask);
      await rename(tempMeta, finalMeta);
      this.database.meta.put(PROTECTED_RUNTIME_META_KEY, {
        version: input.currentVersion,
        dbSchema: currentDbSchema,
        syncSchema: currentSyncSchema,
        updatedAt: timestamp
      } satisfies ProtectedRuntimeState);
      await this.pruneExcessSnapshots();
      return { ...meta, sizeBytes: info.size };
    } catch {
      if (tempPolyask) await rm(tempPolyask, { force: true }).catch(() => undefined);
      if (tempMeta) await rm(tempMeta, { force: true }).catch(() => undefined);
      console.warn("auto_backup_capture_failed");
      return null;
    }
  }

  async list(): Promise<AutoBackupSummary[]> {
    if (!this.dir) return [];
    let entries: string[];
    try { entries = await readdir(this.dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("backup_read_failed");
    }
    const items: AutoBackupSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -5);
      if (!AUTO_BACKUP_ID_PATTERN.test(id)) continue;
      const summary = await this.readSummary(id);
      if (summary) items.push(summary);
    }
    return items.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  }

  async preview(id: string, guard: BackupGuard = this.backup.beginOperation()): Promise<BackupPreview> {
    const { polyaskPath } = this.resolvePaths(id);
    const summary = await this.readSummary(id);
    if (!summary) throw new Error("backup_missing");
    const preview = await this.backup.previewFile(polyaskPath, guard);
    return { ...preview, filename: summary.filename };
  }

  async getSummary(id: string): Promise<AutoBackupSummary> {
    this.resolvePaths(id);
    const summary = await this.readSummary(id);
    if (!summary) throw new Error("backup_missing");
    return summary;
  }

  async exportCopy(id: string, destinationPath: string): Promise<void> {
    const { polyaskPath } = this.resolvePaths(id);
    const summary = await this.readSummary(id);
    if (!summary) throw new Error("backup_missing");
    try { await copyFile(polyaskPath, destinationPath); }
    catch { throw new Error("backup_write_failed"); }
  }

  async clearAll(): Promise<void> {
    if (!this.dir) return;
    await rm(this.dir, { recursive: true, force: true });
  }

  private resolvePaths(id: string): { polyaskPath: string; metaPath: string } {
    if (!this.dir) throw new Error("backup_missing");
    if (typeof id !== "string" || !AUTO_BACKUP_ID_PATTERN.test(id)) throw new Error("invalid_request");
    const polyaskPath = join(this.dir, `${id}.polyask`);
    const metaPath = join(this.dir, `${id}.json`);
    if (dirname(polyaskPath) !== this.dir || dirname(metaPath) !== this.dir) throw new Error("invalid_request");
    return { polyaskPath, metaPath };
  }

  private async readSummary(id: string): Promise<AutoBackupSummary | null> {
    if (!this.dir) return null;
    try {
      const [raw, info] = await Promise.all([
        readFile(join(this.dir, `${id}.json`), "utf8"),
        stat(join(this.dir, `${id}.polyask`))
      ]);
      if (!info.isFile()) return null;
      const parsed = JSON.parse(raw) as Partial<StoredAutoBackupMeta>;
      if (parsed.format !== 1 || parsed.id !== id || typeof parsed.filename !== "string"
        || (parsed.fromVersion !== null && typeof parsed.fromVersion !== "string")
        || typeof parsed.toVersion !== "string"
        || typeof parsed.createdAt !== "number" || !Number.isFinite(parsed.createdAt)
        || typeof parsed.toDbSchema !== "number" || typeof parsed.toSyncSchema !== "number"
        || typeof parsed.textOnly !== "boolean") {
        return null;
      }
      return {
        id,
        filename: parsed.filename,
        fromVersion: parsed.fromVersion ?? null,
        toVersion: parsed.toVersion,
        fromDbSchema: typeof parsed.fromDbSchema === "number" ? parsed.fromDbSchema : null,
        toDbSchema: parsed.toDbSchema,
        fromSyncSchema: typeof parsed.fromSyncSchema === "number" ? parsed.fromSyncSchema : null,
        toSyncSchema: parsed.toSyncSchema,
        createdAt: parsed.createdAt,
        sizeBytes: info.size,
        textOnly: parsed.textOnly
      };
    } catch {
      return null;
    }
  }

  private async pruneExcessSnapshots(): Promise<void> {
    if (!this.dir) return;
    const all = await this.list();
    for (const stale of all.slice(this.maxSnapshots)) {
      await rm(join(this.dir, `${stale.id}.polyask`), { force: true }).catch(() => undefined);
      await rm(join(this.dir, `${stale.id}.json`), { force: true }).catch(() => undefined);
    }
  }
}

function isUpgradeNeeded(
  saved: ProtectedRuntimeState | null,
  preOpenDbSchema: number | null,
  input: CaptureUpgradeInput
): boolean {
  const currentDbSchema = input.currentDbSchema ?? LOCAL_DB_SCHEMA_VERSION;
  const currentSyncSchema = input.currentSyncSchema ?? CURRENT_PROTECTED_SYNC_SCHEMA;
  const effectiveFromDbSchema = resolvePreviousDbSchema(saved?.dbSchema ?? null, preOpenDbSchema);
  return !saved
    || compareSemver(input.currentVersion, saved.version) > 0
    || (effectiveFromDbSchema !== null && currentDbSchema > effectiveFromDbSchema)
    || currentSyncSchema > saved.syncSchema;
}

function readProtectedRuntime(value: unknown): ProtectedRuntimeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<ProtectedRuntimeState>;
  if (typeof record.version !== "string" || !record.version
    || typeof record.dbSchema !== "number" || !Number.isFinite(record.dbSchema)
    || typeof record.syncSchema !== "number" || !Number.isFinite(record.syncSchema)) {
    return null;
  }
  return {
    version: record.version,
    dbSchema: record.dbSchema,
    syncSchema: record.syncSchema,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0
  };
}

function resolvePreviousDbSchema(saved: number | null, preOpen: number | null): number | null {
  if (preOpen !== null && preOpen > 0) {
    return saved !== null ? Math.min(saved, preOpen) : preOpen;
  }
  return saved;
}

export function compareSemver(left: string, right: string): number {
  const parse = (raw: string): readonly [number, number, number, string] => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
    if (!match) return [0, 0, 0, raw.trim()];
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number) ? 1 : -1;
  }
  if (!a[3] && b[3]) return 1;
  if (a[3] && !b[3]) return -1;
  return a[3].localeCompare(b[3]);
}

function formatAutoBackupId(timestamp: number, uuid: string): string {
  const iso = new Date(timestamp).toISOString();
  const date = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  const suffix = uuid.replace(/[^a-f0-9]/gi, "").toLowerCase().slice(0, 8).padEnd(8, "0");
  return `auto-${date}-${time}-${suffix}`;
}

function sanitizeVersionSlug(value: string): string {
  return value.replace(/[^0-9A-Za-z._-]/g, "-").slice(0, 24) || "unknown";
}

function buildDisplayFilename(fromVersion: string | null, toVersion: string, timestamp: number): string {
  const date = new Date(timestamp).toISOString().slice(0, 10);
  const fromSlug = fromVersion ? `v${sanitizeVersionSlug(fromVersion)}-to-` : "before-";
  return `polyask-auto-${fromSlug}v${sanitizeVersionSlug(toVersion)}-${date}.polyask`;
}

export interface PreUpgradeSnapshotReceipt {
  readonly summary: AutoBackupSummary | null;
  readonly shouldRecordRuntime: boolean;
}

export async function captureStartupUpgradeSnapshot(
  database: DesktopDatabase,
  input: CaptureUpgradeInput & { readonly userDataPath: string }
): Promise<AutoBackupSummary | null> {
  try {
    const deviceId = (): string => {
      const stored = database.meta.get<unknown>("deviceId");
      return typeof stored === "string" && stored ? stored : database.meta.put("deviceId", randomUUID());
    };
    const backup = new BackupService(database, { deviceId });
    try {
      const service = new AutoBackupService(database, backup, { userDataPath: input.userDataPath });
      return await service.captureIfUpgrading(input);
    } finally {
      backup.dispose();
    }
  } catch {
    console.warn("auto_backup_capture_failed");
    return null;
  }
}

export async function preparePreUpgradeSnapshot(
  dbPath: string,
  input: CaptureUpgradeInput & { readonly userDataPath: string }
): Promise<PreUpgradeSnapshotReceipt> {
  if (dbPath === ":memory:") return { summary: null, shouldRecordRuntime: false };
  if (!existsSync(dbPath)) return { summary: null, shouldRecordRuntime: true };

  const preState = peekProtectedSqliteState(dbPath, PROTECTED_RUNTIME_META_KEY);
  if (preState) {
    const saved = readProtectedRuntime(preState.metaValue);
    if (!isUpgradeNeeded(saved, preState.userVersion, input)) {
      return { summary: null, shouldRecordRuntime: false };
    }
  }

  const tempClonePath = join(input.userDataPath, `.polyask-pre-upgrade-${randomUUID()}.sqlite.tmp`);
  let cloned: ReturnType<typeof DesktopDatabase.cloneBeforeMigration> = null;
  try {
    cloned = DesktopDatabase.cloneBeforeMigration(dbPath, tempClonePath);
    if (!cloned) return { summary: null, shouldRecordRuntime: false };
    if (!cloned.database.hasUserRecords()) {
      const saved = readProtectedRuntime(cloned.database.meta.get<unknown>(PROTECTED_RUNTIME_META_KEY));
      return { summary: null, shouldRecordRuntime: isUpgradeNeeded(saved, cloned.preOpenDbSchema, input) };
    }
    const summary = await captureStartupUpgradeSnapshot(cloned.database, {
      ...input,
      preOpenDbSchema: cloned.preOpenDbSchema
    });
    return { summary, shouldRecordRuntime: summary !== null };
  } catch {
    console.warn("auto_backup_capture_failed");
    return { summary: null, shouldRecordRuntime: false };
  } finally {
    try { cloned?.database.close(); } catch { /* ignore temp clone close error */ }
    await Promise.all([
      rm(tempClonePath, { force: true }).catch(() => undefined),
      rm(`${tempClonePath}-wal`, { force: true }).catch(() => undefined),
      rm(`${tempClonePath}-shm`, { force: true }).catch(() => undefined)
    ]);
  }
}

export function commitPreUpgradeSnapshotState(
  database: DesktopDatabase,
  receipt: PreUpgradeSnapshotReceipt,
  input: CaptureUpgradeInput & { readonly now?: () => number }
): void {
  if (!receipt.shouldRecordRuntime) return;
  try {
    if (receipt.summary === null && database.hasUserRecords()) return;
    database.meta.put(PROTECTED_RUNTIME_META_KEY, {
      version: input.currentVersion,
      dbSchema: input.currentDbSchema ?? LOCAL_DB_SCHEMA_VERSION,
      syncSchema: input.currentSyncSchema ?? CURRENT_PROTECTED_SYNC_SCHEMA,
      updatedAt: receipt.summary?.createdAt ?? (input.now ?? Date.now)()
    } satisfies ProtectedRuntimeState);
  } catch {
    console.warn("auto_backup_commit_failed");
  }
}
