import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import webpack from "webpack";

test("production shell reset clears old inputs and synthesis hooks reject departed responses", { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), "polyask-reset-ui-"));
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: "development", context: join(__dirname, ".."), devtool: false,
        entry: { bundle: join(__dirname, "ui/local-data-reset-fixture.tsx"), flow: join(__dirname, "ui/synthesis-flow-fixture.tsx") },
        output: { path: output, filename: "[name].js" },
        resolve: { extensions: [".tsx", ".ts", ".js"] }, module: { rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: "ts-loader", options: { transpileOnly: true } }] },
          { test: /\.css$/, use: ["style-loader", "css-loader"] }
        ] }
      });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    writeFileSync(join(output, "index.html"), "<!doctype html><meta charset=\"utf-8\"><div id=\"root\"></div><script src=\"bundle.js\"></script>");
    writeFileSync(join(output, "flow.html"), "<!doctype html><meta charset=\"utf-8\"><div id=\"root\"></div><script src=\"flow.js\"></script>");
    const binary = require("electron") as string;
    const args = [join(__dirname, "ui/local-data-reset-runtime.cjs"), output];
    const headless = process.platform === "linux" && !process.env.DISPLAY;
    const result = spawnSync(headless ? "xvfb-run" : binary, headless ? ["-a", binary, ...args] : args,
      { encoding: "utf8", timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "", DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, "no-session-bus")}` } });
    if (process.platform === 'linux' && existsSync(join(output, 'process-boundary.json'))) {
      const { observed } = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8')) as { observed: number[] };
      for (let round = 0; round < 20 && observed.some(pid => existsSync(`/proc/${pid}`)); round++) await new Promise(resolve => setTimeout(resolve, 50));
      const remaining = observed.filter(pid => existsSync(`/proc/${pid}`));
      writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ remainingObservedPids: remaining }));
      assert.equal(remaining.length, 0, 'observed Electron processes exit');
    }
    console.log(`Native artifacts: ${output}`);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  } finally { rmSync(join(output, 'profile'), { recursive: true, force: true }); }
});
