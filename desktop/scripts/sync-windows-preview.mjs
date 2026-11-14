import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

const ENABLED = 0x31;
const ALLOWED_PREVIEW_ENTRIES = new Set([
  "App",
  "App.staging",
  "App.previous",
  "Preview Data",
  "portable.json",
  "README-PREVIEW.txt"
]);

export const PREVIEW_MARKER = `${JSON.stringify({
  format: 1,
  dataDirectory: "Preview Data",
  preview: true
}, null, 2)}\n`;

export const PREVIEW_README = [
  "【PolyAsk 试玩版 · 独立隔离目录】",
  "",
  "1. 启动入口：双击桌面「【PolyAsk 试玩版】」快捷方式，或运行本目录下的 App\\polyask-desktop.exe。",
  "2. 数据完全隔离：试玩版的所有问答、设置与网页登录状态均保存在同级 Preview Data 文件夹中，",
  "   绝不读取、导入或修改正式版（%APPDATA%\\PolyAsk 或正式便携版 PolyAsk Data）的任何数据。",
  "3. 持续更新保留状态：每次同步更新试玩版只会替换 App 文件夹，Preview Data 会原样保留。",
  ""
].join("\r\n");

function failure(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

export async function verifyPreviewPackageFuses(executablePath) {
  let wire;
  try {
    wire = await getCurrentFuseWire(executablePath);
  } catch (cause) {
    throw Object.assign(failure("preview_fuse_unverified", executablePath), { cause });
  }
  if (wire.version !== FuseVersion.V1 || wire[FuseV1Options.EnableCookieEncryption] !== ENABLED) {
    throw failure("preview_cookie_encryption_required", executablePath);
  }
  if (wire[FuseV1Options.OnlyLoadAppFromAsar] !== ENABLED) {
    throw failure("preview_asar_fuse_required", executablePath);
  }
}

export async function validatePreviewTargetRoot(targetRoot, forbiddenPaths = []) {
  if (typeof targetRoot !== "string" || !isAbsolute(targetRoot)) {
    throw failure("preview_target_invalid", String(targetRoot));
  }
  const normalizedTarget = normalize(targetRoot);
  if (basename(normalizedTarget) !== "PolyAsk-Preview") {
    throw failure("preview_target_must_be_polyask_preview", normalizedTarget);
  }
  const lowerTarget = normalizedTarget.replace(/\\/g, "/").toLowerCase();
  if (lowerTarget.includes("/roaming/polyask") || lowerTarget.includes("polyask portable")) {
    throw failure("preview_target_overlaps_formal", normalizedTarget);
  }
  for (const rawForbidden of forbiddenPaths) {
    if (!rawForbidden) continue;
    const lowerForbidden = normalize(rawForbidden).replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
    const cleanTarget = lowerTarget.replace(/\/+$/, "");
    if (cleanTarget === lowerForbidden
      || cleanTarget.startsWith(`${lowerForbidden}/`)
      || lowerForbidden.startsWith(`${cleanTarget}/`)) {
      throw failure("preview_target_overlaps_formal", normalizedTarget);
    }
  }
  try {
    const info = await lstat(normalizedTarget);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw failure("preview_target_untrusted", normalizedTarget);
    }
    const entries = await readdir(normalizedTarget);
    const unexpected = entries.filter((entry) => !ALLOWED_PREVIEW_ENTRIES.has(entry));
    if (unexpected.length > 0) {
      throw failure("preview_target_unrecognized", unexpected.join(", "));
    }
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
}

export async function stagePreviewDirectory(options) {
  const {
    packageDir,
    targetRoot,
    forbiddenPaths = [],
    isPreviewRunning = async () => false,
    verifyFuses = verifyPreviewPackageFuses
  } = options;

  await validatePreviewTargetRoot(targetRoot, forbiddenPaths);
  const sourceExe = join(packageDir, "polyask-desktop.exe");
  const sourceAsar = join(packageDir, "resources", "app.asar");
  await stat(sourceExe).catch(() => { throw failure("preview_package_missing", sourceExe); });
  await stat(sourceAsar).catch(() => { throw failure("preview_package_missing", sourceAsar); });
  await verifyFuses(sourceExe);

  const appDir = join(targetRoot, "App");
  const targetExe = join(appDir, "polyask-desktop.exe");
  if (await isPreviewRunning(targetExe)) {
    throw failure("preview_process_running", "请先关闭正在运行的【PolyAsk 试玩版】窗口后再同步更新。");
  }

  await mkdir(targetRoot, { recursive: true });
  const stagingDir = join(targetRoot, "App.staging");
  const previousDir = join(targetRoot, "App.previous");
  await rm(stagingDir, { recursive: true, force: true });
  await rm(previousDir, { recursive: true, force: true });

  try {
    await cp(packageDir, stagingDir, { recursive: true, force: true });
    await verifyFuses(join(stagingDir, "polyask-desktop.exe"));
    const hasExistingApp = await stat(appDir).then(() => true).catch(() => false);
    if (hasExistingApp) {
      await rename(appDir, previousDir);
    }
    try {
      await rename(stagingDir, appDir);
    } catch (swapError) {
      if (hasExistingApp) {
        await rename(previousDir, appDir).catch(() => undefined);
      }
      throw swapError;
    }
    await rm(previousDir, { recursive: true, force: true });
    await writeFile(join(targetRoot, "portable.json"), PREVIEW_MARKER, "utf8");
    await writeFile(join(targetRoot, "README-PREVIEW.txt"), PREVIEW_README, "utf8");
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    root: targetRoot,
    app: appDir,
    executable: targetExe,
    data: join(targetRoot, "Preview Data")
  };
}

const WSL_POWERSHELL_FALLBACK = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    return execFileSync("powershell.exe", args, opts).trim();
  } catch (error) {
    if (error && error.code === "ENOENT" && existsSync(WSL_POWERSHELL_FALLBACK)) {
      return execFileSync(WSL_POWERSHELL_FALLBACK, args, opts).trim();
    }
    throw error;
  }
}

function toHostPath(windowsPath) {
  if (process.platform === "win32") return windowsPath;
  return execFileSync("wslpath", ["-u", windowsPath], { encoding: "utf8" }).trim();
}

function toWindowsPath(hostPath) {
  if (process.platform === "win32") return hostPath;
  return execFileSync("wslpath", ["-w", hostPath], { encoding: "utf8" }).trim();
}

function resolveWindowsEnvironment() {
  const raw = runPowerShell([
    "$ProgressPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "@{",
    "  localAppData = [Environment]::GetFolderPath('LocalApplicationData')",
    "  roamingAppData = [Environment]::GetFolderPath('ApplicationData')",
    "  desktop = [Environment]::GetFolderPath('Desktop')",
    "} | ConvertTo-Json -Compress"
  ].join("\n"));
  const parsed = JSON.parse(raw);
  return {
    localAppDataWin: parsed.localAppData,
    roamingAppDataWin: parsed.roamingAppData,
    desktopWin: parsed.desktop,
    localAppDataHost: toHostPath(parsed.localAppData),
    roamingAppDataHost: toHostPath(parsed.roamingAppData),
    desktopHost: toHostPath(parsed.desktop)
  };
}

function checkWindowsPreviewProcessRunning(targetExeHostPath) {
  const winExe = toWindowsPath(targetExeHostPath).replace(/'/g, "''");
  const out = runPowerShell([
    `$target = '${winExe}'`,
    "$running = Get-Process -Name 'polyask-desktop' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq $target) }",
    "if ($running) { 'RUNNING' } else { 'IDLE' }"
  ].join("\n"));
  return out === "RUNNING";
}

function createWindowsDesktopShortcut(shortcutWinPath, targetExeWinPath, workingDirWinPath) {
  const lnk = shortcutWinPath.replace(/'/g, "''");
  const exe = targetExeWinPath.replace(/'/g, "''");
  const cwd = workingDirWinPath.replace(/'/g, "''");
  runPowerShell([
    "$shell = New-Object -ComObject WScript.Shell",
    `$shortcut = $shell.CreateShortcut('${lnk}')`,
    `$shortcut.TargetPath = '${exe}'`,
    `$shortcut.WorkingDirectory = '${cwd}'`,
    `$shortcut.IconLocation = '${exe},0'`,
    "$shortcut.Description = 'PolyAsk 试玩版（独立 Preview Data 数据目录，不影响正式版）'",
    "$shortcut.Save()"
  ].join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  const skipPackage = args.includes("--skip-package");
  const noShortcut = args.includes("--no-shortcut");
  const targetIndex = args.indexOf("--target");
  const customTarget = targetIndex >= 0 ? resolve(args[targetIndex + 1] ?? "") : null;

  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (!skipPackage) {
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["electron-forge", "package", "--platform=win32", "--arch=x64"],
      { cwd: desktopRoot, stdio: "inherit" }
    );
  }

  const packageDir = join(desktopRoot, "out", "PolyAsk-win32-x64");
  const winEnv = customTarget && noShortcut ? null : resolveWindowsEnvironment();
  const targetRoot = customTarget ?? join(winEnv.localAppDataHost, "PolyAsk-Preview");
  const forbiddenPaths = winEnv
    ? [join(winEnv.roamingAppDataHost, "PolyAsk"), join(winEnv.localAppDataHost, "PolyAsk")]
    : [];

  const result = await stagePreviewDirectory({
    packageDir,
    targetRoot,
    forbiddenPaths,
    isPreviewRunning: async (exePath) => winEnv ? checkWindowsPreviewProcessRunning(exePath) : false
  });

  let shortcutPath = null;
  if (!noShortcut && winEnv) {
    const shortcutWinPath = `${winEnv.desktopWin.replace(/\\+$/, "")}\\【PolyAsk 试玩版】.lnk`;
    createWindowsDesktopShortcut(shortcutWinPath, toWindowsPath(result.executable), toWindowsPath(result.app));
    shortcutPath = join(winEnv.desktopHost, "【PolyAsk 试玩版】.lnk");
  }

  process.stdout.write(`${JSON.stringify({ ...result, shortcut: shortcutPath }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
