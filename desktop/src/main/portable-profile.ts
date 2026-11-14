import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import type { RuntimeInfo } from "../shared/runtime";

export interface RuntimeProfile extends RuntimeInfo {
  readonly userDataPath: string;
  readonly portableRoot?: string;
  readonly legacyUserDataPath?: string;
}

interface ResolveRuntimeProfileInput {
  readonly isPackaged: boolean;
  readonly execPath: string;
  readonly defaultUserDataPath: string;
  readonly version: string;
  readonly markerExists?: (path: string) => boolean;
  readonly readMarker?: (path: string) => string | null;
  readonly envPreview?: boolean;
}

interface PortableMarkerConfig {
  readonly dataDirectory: string;
  readonly preview: boolean;
}

const DATA_MARKER = ".polyask-data-v1";
const IMPORT_STAGING = ".polyask-import-v1";
const IMPORT_IDENTITY_MARKER = ".polyask-import-identity-v1";
const BOOTSTRAP_MARKER = ".polyask-bootstrap-v1";
const DEFAULT_PORTABLE_DATA_DIR = "PolyAsk Data";
const DEFAULT_PREVIEW_DATA_DIR = "Preview Data";
const SAFE_DATA_DIR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const LEGACY_DATA_ENTRIES = ["polyask.sqlite", "Local State", "Partitions", "Default"] as const;
const MAX_BOOTSTRAP_LOCAL_STATE_BYTES = 64 * 1024;
const CHROMIUM_EPHEMERAL_DIRS = new Set([
  "Crashpad",
  "GPUPersistentCache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "GraphiteDawnCache",
  "DawnCache",
  "DawnWebGPUCache",
  "DawnGraphiteCache",
  "Code Cache",
  "blob_storage"
]);
type PathExists = (path: string) => boolean;

export function resolveRuntimeProfile(input: ResolveRuntimeProfileInput): RuntimeProfile {
  if (!input.isPackaged) {
    const preview = input.envPreview ?? process.env.POLYASK_PREVIEW === "1";
    return {
      distribution: "installed",
      version: input.version,
      userDataPath: input.defaultUserDataPath,
      ...(preview ? { preview: true } : {})
    };
  }
  const portableRoot = dirname(dirname(input.execPath));
  const markerPath = join(portableRoot, "portable.json");
  const config = resolvePortableMarkerConfig(markerPath, input);
  if (!config) {
    return { distribution: "installed", version: input.version, userDataPath: input.defaultUserDataPath };
  }
  return {
    distribution: "portable",
    version: input.version,
    ...(config.preview ? { preview: true } : {}),
    portableRoot,
    userDataPath: join(portableRoot, config.dataDirectory),
    ...(config.preview ? {} : { legacyUserDataPath: input.defaultUserDataPath })
  };
}

export function isPortableDataInitialized(
  profile: RuntimeProfile,
  exists: PathExists = markerExists
): boolean {
  return profile.distribution === "portable" && exists(join(profile.userDataPath, DATA_MARKER));
}

export function preparePortableBootstrap(profile: RuntimeProfile): string | null {
  if (profile.distribution !== "portable" || isPortableDataInitialized(profile)) return null;
  const marker = join(profile.userDataPath, BOOTSTRAP_MARKER);
  if (pathExists(profile.userDataPath)) {
    if (!statSync(profile.userDataPath).isDirectory()) throw new Error("portable_data_unrecognized");
    const existing = readBootstrap(marker);
    const entries = readdirSync(profile.userDataPath);
    const allowChromiumRuntime = Boolean(existing || profile.preview);
    const unknown = entries.filter((entry) => !isAllowedRuntimeEntry(profile.userDataPath, entry, allowChromiumRuntime));
    if (unknown.length || (existing && !entries.includes(BOOTSTRAP_MARKER))) {
      throw new Error("portable_data_unrecognized");
    }
    if (existing) return existing;
  } else {
    mkdirSync(profile.userDataPath, { recursive: true });
  }
  const bootstrap = randomUUID();
  writeFileSync(marker, `${bootstrap}\n`);
  return bootstrap;
}

export function hasImportableLegacyData(
  profile: RuntimeProfile,
  exists: PathExists = pathExists
): boolean {
  if (profile.distribution !== "portable" || !profile.legacyUserDataPath) return false;
  return LEGACY_DATA_ENTRIES.some((entry) => exists(join(profile.legacyUserDataPath!, entry)));
}

export function applyPortableImportIdentity(
  profile: RuntimeProfile,
  writeDeviceId: (deviceId: string) => void
): boolean {
  if (profile.distribution !== "portable") return false;
  const marker = join(profile.userDataPath, IMPORT_IDENTITY_MARKER);
  let deviceId: string;
  try { deviceId = readFileSync(marker, "utf8").trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    throw new Error("portable_import_failed");
  }
  writeDeviceId(deviceId);
  rmSync(marker, { force: true });
  return true;
}

export async function initializePortableData(
  profile: RuntimeProfile,
  chooseImport: () => Promise<boolean>,
  legacyDataAvailable = hasImportableLegacyData(profile)
): Promise<"ready" | "fresh" | "import_staged"> {
  if (profile.distribution !== "portable") return "ready";
  if (profile.preview) {
    await mkdir(profile.userDataPath, { recursive: true });
    if (await markerFileExists(join(profile.userDataPath, DATA_MARKER))) return "ready";
    await ensureBootstrapDirectory(profile.userDataPath, true);
    await writeFile(join(profile.userDataPath, DATA_MARKER), "1\n");
    await rm(join(profile.userDataPath, BOOTSTRAP_MARKER), { force: true });
    return "fresh";
  }
  if (!profile.legacyUserDataPath) return "ready";
  if (!profile.portableRoot) throw new Error("portable_root_missing");
  const staging = join(profile.portableRoot, IMPORT_STAGING);
  await mkdir(profile.userDataPath, { recursive: true });
  if (await markerFileExists(join(profile.userDataPath, DATA_MARKER))) return "ready";
  const bootstrap = await ensureBootstrapDirectory(profile.userDataPath);

  const source = profile.legacyUserDataPath;
  const canImport = source !== profile.userDataPath && legacyDataAvailable;
  if (!canImport || !await chooseImport()) {
    await rm(staging, { recursive: true, force: true });
    await writeFile(join(profile.userDataPath, DATA_MARKER), "1\n");
    await rm(join(profile.userDataPath, BOOTSTRAP_MARKER), { force: true });
    return "fresh";
  }

  try {
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, {
      recursive: true,
      force: true,
      filter: (path) => {
        const sourceRelativePath = relative(source, path);
        if (!sourceRelativePath || sourceRelativePath.includes(sep)) return true;
        return sourceRelativePath !== "lockfile"
          && sourceRelativePath !== DATA_MARKER
          && sourceRelativePath !== BOOTSTRAP_MARKER
          && sourceRelativePath !== IMPORT_IDENTITY_MARKER
          && !sourceRelativePath.startsWith("Singleton");
      }
    });
    await writeFile(join(staging, BOOTSTRAP_MARKER), `${bootstrap}\n`);
    await writeFile(join(staging, IMPORT_IDENTITY_MARKER), `${randomUUID()}\n`);
    await writeFile(join(staging, DATA_MARKER), "1\n");
    return "import_staged";
  } catch (cause) {
    if ((cause as { message?: string }).message === "portable_data_unrecognized") throw cause;
    throw Object.assign(new Error("portable_import_failed"), { cause });
  }
}

export function finalizePortableDataImport(profile: RuntimeProfile): boolean {
  if (profile.distribution !== "portable" || !profile.portableRoot) return false;
  const staging = join(profile.portableRoot, IMPORT_STAGING);
  if (!markerExists(join(staging, DATA_MARKER))) return false;
  try {
    if (markerExists(join(profile.userDataPath, DATA_MARKER))) {
      rmSync(staging, { recursive: true, force: true });
      return false;
    }
    if (pathExists(profile.userDataPath)) {
      const targetBootstrap = readBootstrap(join(profile.userDataPath, BOOTSTRAP_MARKER));
      const stagingBootstrap = readBootstrap(join(staging, BOOTSTRAP_MARKER));
      const entries = readdirSync(profile.userDataPath);
      if (!targetBootstrap || targetBootstrap !== stagingBootstrap
        || entries.some((entry) => !isAllowedRuntimeEntry(profile.userDataPath, entry, true))) {
        throw new Error("portable_data_unrecognized");
      }
    }
    rmSync(profile.userDataPath, { recursive: true, force: true });
    renameSync(staging, profile.userDataPath);
    return true;
  } catch (cause) {
    if ((cause as { message?: string }).message === "portable_data_unrecognized") throw cause;
    throw Object.assign(new Error("portable_import_failed"), { cause });
  }
}

async function ensureBootstrapDirectory(path: string, preview = false): Promise<string> {
  const marker = join(path, BOOTSTRAP_MARKER);
  const existing = await readBootstrapAsync(marker);
  const entries = await readdir(path);
  const allowChromiumRuntime = Boolean(existing || preview);
  const unknown = entries.filter((entry) => !isAllowedRuntimeEntry(path, entry, allowChromiumRuntime));
  if (unknown.length || (existing && !entries.includes(BOOTSTRAP_MARKER))) {
    throw new Error("portable_data_unrecognized");
  }
  if (existing) return existing;
  const bootstrap = randomUUID();
  await writeFile(marker, `${bootstrap}\n`);
  return bootstrap;
}

function isAllowedRuntimeEntry(baseDir: string, entry: string, allowChromiumRuntime: boolean): boolean {
  let info;
  try { info = lstatSync(join(baseDir, entry)); }
  catch { return false; }
  if (entry.startsWith("Singleton")) {
    return info.isFile() || info.isSocket() || info.isSymbolicLink();
  }
  if (entry === BOOTSTRAP_MARKER || entry === "lockfile") {
    return info.isFile() && info.size <= 4096;
  }
  if (entry === "Crashpad") return info.isDirectory();
  if (!allowChromiumRuntime) return false;
  if (entry === "Local State") {
    return info.isFile() && info.size <= MAX_BOOTSTRAP_LOCAL_STATE_BYTES;
  }
  return CHROMIUM_EPHEMERAL_DIRS.has(entry) && info.isDirectory();
}

function resolvePortableMarkerConfig(
  markerPath: string,
  input: ResolveRuntimeProfileInput
): PortableMarkerConfig | null {
  if (input.readMarker) {
    const raw = input.readMarker(markerPath);
    return raw === null ? null : parsePortableMarker(raw);
  }
  if (input.markerExists) {
    return input.markerExists(markerPath)
      ? { dataDirectory: DEFAULT_PORTABLE_DATA_DIR, preview: false }
      : null;
  }
  const raw = readPortableMarkerFile(markerPath);
  return raw === null ? null : parsePortableMarker(raw);
}

function readPortableMarkerFile(path: string): string | null {
  try {
    if (!statSync(path).isFile()) throw new Error("portable_data_unrecognized");
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function parsePortableMarker(raw: string): PortableMarkerConfig {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("portable_data_unrecognized"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("portable_data_unrecognized");
  }
  const record = parsed as { format?: unknown; dataDirectory?: unknown; preview?: unknown };
  if (record.format !== 1) throw new Error("portable_data_unrecognized");
  if (record.preview !== undefined && typeof record.preview !== "boolean") {
    throw new Error("portable_data_unrecognized");
  }
  const preview = record.preview === true;
  const dataDirectory = record.dataDirectory === undefined
    ? (preview ? DEFAULT_PREVIEW_DATA_DIR : DEFAULT_PORTABLE_DATA_DIR)
    : record.dataDirectory;
  if (typeof dataDirectory !== "string"
    || !SAFE_DATA_DIR_PATTERN.test(dataDirectory)
    || dataDirectory.includes("..")
    || dataDirectory.endsWith(".")
    || dataDirectory.endsWith(" ")
    || (preview && dataDirectory === DEFAULT_PORTABLE_DATA_DIR)) {
    throw new Error("portable_data_unrecognized");
  }
  return { dataDirectory, preview };
}

function markerExists(path: string): boolean {
  try {
    if (!statSync(path).isFile()) throw new Error("portable_data_unrecognized");
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function pathExists(path: string): boolean {
  try { statSync(path); return true; }
  catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function markerFileExists(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("portable_data_unrecognized");
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function readBootstrap(path: string): string | null {
  try { return validBootstrap(readFileSync(path, "utf8")); }
  catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readBootstrapAsync(path: string): Promise<string | null> {
  try { return validBootstrap(await readFile(path, "utf8")); }
  catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function validBootstrap(value: string): string {
  const id = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("portable_data_unrecognized");
  }
  return id;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
