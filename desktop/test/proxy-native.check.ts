import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import webpack from "webpack";

const STAGES = ["startup-system", "custom-http", "switch-socks5", "direct", "http-auth", "probe", "http-auth-unicode",
  "busy-pending", "pending-confirm"];
const STARTUP_STAGES = ["startup-closed-port"];

/** 剥掉开发机的代理与桌面会话变量：「跟随系统」在本检查里稳定等于直连（Linux 无桌面时 Chromium 只读 *_proxy）。 */
function hermeticEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "", WAYLAND_DISPLAY: "", WAYLAND_SOCKET: "" };
  for (const key of Object.keys(env)) {
    if (/^(https?|all|no|ftp|socks)_proxy$/i.test(key)) delete env[key];
  }
  for (const key of ["XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "GNOME_DESKTOP_SESSION_ID", "KDE_FULL_SESSION"]) delete env[key];
  return env;
}

test("custom proxy routes real Electron sessions, gates saves, probes credentials and waits for confirmation", { timeout: 300000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), "polyask-proxy-native-"));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: "development", context: join(__dirname, ".."), devtool: false, target: "electron-main",
      entry: join(__dirname, "ui/proxy-native-services.ts"),
      output: { path: output, filename: "services.cjs", library: { type: "commonjs2" } },
      resolve: { extensions: [".ts", ".js"] },
      module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: [{ loader: "ts-loader", options: { transpileOnly: true } }] }] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  // 测试连接的目标写死为 www.gstatic.com（spec §6.3）：自签一张只给它用的证书，probe session 只信任这一张。
  const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", join(output, "key.pem"), "-out", join(output, "cert.pem"), "-days", "2",
    "-subj", "/CN=www.gstatic.com/O=PolyAsk native proxy check", "-addext", "subjectAltName=DNS:www.gstatic.com"],
  { encoding: "utf8", timeout: 20000 });
  assert.equal(certificate.status, 0, `openssl failed: ${certificate.stderr}`);
  writeFileSync(join(output, "index.html"), '<!doctype html><meta charset="utf-8"><title>proxy check</title>');
  const binary = require("electron") as string;
  const headless = process.platform === "linux" && !process.env.DISPLAY;
  // 每个 suite 一次独立的 Electron 进程、独立的档案目录（profile-<suite>），报告写 report-<suite>.json。
  const launch = (suite: string, timeout: number): { stages: string[] } => {
    const args = [join(__dirname, "ui/proxy-native-runtime.cjs"), output, suite];
    const result = spawnSync(headless ? "xvfb-run" : binary, headless ? ["-a", binary, ...args] : args,
      { encoding: "utf8", timeout, env: hermeticEnv() });
    console.log(`Proxy native check (${suite}): ${output}\n${result.stdout}`);
    assert.equal(result.status, 0, `${suite}\n${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
    return JSON.parse(readFileSync(join(output, `report-${suite}.json`), "utf8")) as { stages: string[] };
  };
  // Review Focus 4：启动前档案里就存着一个没在运行的自定义代理。必须是独立进程——「启动」只能发生一次。
  assert.deepEqual(launch("startup-closed", 60000).stages, STARTUP_STAGES, "the dead-proxy startup stage ran to completion");
  assert.deepEqual(launch("main", 150000).stages, STAGES, "every native stage ran to completion");
});
