import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, normalize, relative as pathRelative, resolve, sep } from 'node:path';
import { FuseV1Options, FuseVersion, flipFuses, getCurrentFuseWire } from '@electron/fuses';
import { SENTINEL } from '@electron/fuses/dist/constants';

// 开发入口与发行包共用这一个真源。已有加密档案不得降为未加密运行时。
export const ENABLE_COOKIE_ENCRYPTION = true;
const enabled = 0x31, disabled = 0x30;
const marker = '.polyask-dev-runtime.json';
export interface DevelopmentRuntime { dist: string; executable: string; version: string }
function failure(code: string): Error { return Object.assign(new Error(code), { code }); }

export async function verifyDevelopmentCookieEncryption(executable: string): Promise<void> {
  let wire;
  try { wire = await getCurrentFuseWire(executable); }
  catch { throw failure('dev_cookie_encryption_unverified'); }
  if (wire.version !== FuseVersion.V1 || wire[FuseV1Options.EnableCookieEncryption] !== enabled
    || (await allCookieStates(executable)).some(value => value !== enabled))
    throw failure('dev_cookie_encryption_required');
}

function fuseFile(executable: string): string {
  if (executable.endsWith('.app')) return join(executable, 'Contents/Frameworks/Electron Framework.framework/Electron Framework');
  return executable.includes('.app')
    ? resolve(executable, '../../Frameworks/Electron Framework.framework/Electron Framework') : executable;
}
// getCurrentFuseWire 只读首份 wire；universal 二进制中的所有架构都必须核验。
async function allCookieStates(executable: string): Promise<number[]> {
  const bytes = await readFile(fuseFile(executable)), states: number[] = [];
  for (let index = bytes.indexOf(SENTINEL); index !== -1; index = bytes.indexOf(SENTINEL, index + SENTINEL.length)) {
    const offset = index + SENTINEL.length, length = bytes[offset + 1];
    if (bytes[offset] !== Number(FuseVersion.V1) || length <= FuseV1Options.EnableCookieEncryption || offset + 2 + length > bytes.length)
      throw failure('dev_cookie_encryption_unverified');
    states.push(bytes[offset + 2 + FuseV1Options.EnableCookieEncryption]);
  }
  if (!states.length) throw failure('dev_cookie_encryption_unverified');
  return states;
}
async function verifyOwnedFuseFile(dist: string, executable: string): Promise<void> {
  const root = await realpath(dist);
  for (const target of new Set([executable, fuseFile(executable)])) {
    const relative = pathRelative(root, await realpath(target));
    if (isAbsolute(relative) || relative === '..' || relative.startsWith('..' + sep))
      throw failure('dev_runtime_executable_outside_copy');
  }
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function plainDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw failure('dev_runtime_directory_untrusted');
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** 只复制安装依赖中的运行时；不读取、复制、创建或清理任何登录档案。 */
export async function prepareDevelopmentRuntime(desktopDirectory: string): Promise<DevelopmentRuntime> {
  const root = await realpath(desktopDirectory);
  const localRequire = createRequire(join(root, 'package.json'));
  const packagePath = localRequire.resolve('electron/package.json');
  const source = resolve(packagePath, '../dist');
  const { version } = JSON.parse(await readFile(packagePath, 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw failure('dev_runtime_version_unverified');
  const relative = (await readFile(resolve(packagePath, '../path.txt'), 'utf8')).trim();
  if (!relative || isAbsolute(relative) || normalize(relative).split(sep).includes('..'))
    throw failure('dev_runtime_path_unverified');
  // 拒绝将缓存目录链接到 node_modules、正式安装或用户档案。
  let parent = root;
  for (const part of ['test-artifacts', 'dev-runtime']) {
    parent = join(parent, part);
    if (!await plainDirectory(parent)) await mkdir(parent, { mode: 0o700 });
    if (await realpath(parent) !== parent) throw failure('dev_runtime_directory_untrusted');
  }
  const dist = join(parent, `${version}-${process.platform}-${process.arch}`);
  const executable = join(dist, relative);
  const expected = { schema: 1, version, platform: process.platform, arch: process.arch, relative, cookieEncryption: true };
  const validateCache = async (): Promise<DevelopmentRuntime> => {
    await plainDirectory(dist);
    let saved;
    try {
      const markerInfo = await lstat(join(dist, marker));
      if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) throw failure('dev_runtime_cache_unverified');
      saved = JSON.parse(await readFile(join(dist, marker), 'utf8'));
    }
    catch { throw failure('dev_runtime_cache_unverified'); }
    await verifyOwnedFuseFile(dist, executable);
    if (Object.entries(expected).some(([key, value]) => saved?.[key] !== value)
      || saved.digest !== await digest(fuseFile(executable))) throw failure('dev_runtime_cache_unverified');
    await verifyDevelopmentCookieEncryption(executable);
    return { dist, executable, version };
  };
  if (await plainDirectory(dist)) return validateCache();
  const sourceExecutable = join(source, relative);
  const originalWire = await getCurrentFuseWire(sourceExecutable);
  if (originalWire.version !== FuseVersion.V1 ||
    ![enabled, disabled].includes(originalWire[FuseV1Options.EnableCookieEncryption]!) ||
    (await allCookieStates(sourceExecutable)).some(value => ![enabled, disabled].includes(value)))
    throw failure('dev_runtime_source_unverified');
  // mkdir 排他取得所有权；并发准备中的目录不能被执行或被另一进程清理。
  try { await mkdir(dist, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return validateCache(); throw error; }
  try {
    await cp(source, dist, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    await verifyOwnedFuseFile(dist, executable);
    await flipFuses(executable, { version: FuseVersion.V1,
      [FuseV1Options.EnableCookieEncryption]: ENABLE_COOKIE_ENCRYPTION,
      resetAdHocDarwinSignature: process.platform === 'darwin' && process.arch === 'arm64' });
    await verifyDevelopmentCookieEncryption(executable);
    const preparedWire = await getCurrentFuseWire(executable);
    for (const [key, value] of Object.entries(originalWire)) {
      if (key !== String(FuseV1Options.EnableCookieEncryption) && (preparedWire as Record<string, unknown>)[key] !== value)
        throw failure('dev_runtime_unexpected_fuse_change');
    }
    await writeFile(join(dist, marker), JSON.stringify({ ...expected, digest: await digest(fuseFile(executable)) }),
      { flag: 'wx', mode: 0o600 });
    return { dist, executable, version };
  } catch (error) { await rm(dist, { recursive: true, force: true }); throw error; }
}

/** 保留 Forge 原有启动与退出流程，仅在它启动 Electron 前准备和核对实际运行时。 */
export async function prepareDevelopmentStart(): Promise<DevelopmentRuntime> {
  let prepared: DevelopmentRuntime | undefined;
  if (!process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    prepared = await prepareDevelopmentRuntime(__dirname);
    process.env.ELECTRON_OVERRIDE_DIST_PATH = prepared.dist;
  }
  process.env.ELECTRON_OVERRIDE_DIST_PATH = resolve(process.env.ELECTRON_OVERRIDE_DIST_PATH!);
  const relative = (await readFile(require.resolve('electron/path.txt'), 'utf8')).trim();
  const expected = join(process.env.ELECTRON_OVERRIDE_DIST_PATH, relative);
  const executable = require('electron') as string;
  if (typeof executable !== 'string' || !isAbsolute(executable) || await realpath(executable) !== await realpath(expected))
    throw failure('dev_runtime_selected_path_unverified');
  await verifyDevelopmentCookieEncryption(executable);
  console.log(`Development runtime verified: Cookie encryption enabled.\n${executable}`);
  return prepared ?? { dist: resolve(process.env.ELECTRON_OVERRIDE_DIST_PATH!), executable,
    version: 'external' };
}
