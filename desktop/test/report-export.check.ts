import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import webpack from 'webpack';

test('native reports preserve three languages, tables and pagination without network or leaked windows', { timeout: 180000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-report-native-'));
  console.log(`Report native evidence: ${output}`);
  const { runOwnedNative } = require('../scripts/lib/owned-native-process.mjs');
  let passed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), target: 'electron-main', devtool: false,
        entry: join(__dirname, 'ui/report-export-services.ts'),
        output: { path: output, filename: 'services.cjs', library: { type: 'commonjs2' } },
        resolve: { extensions: ['.ts', '.js'] },
        module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] }] }
      });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
        ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    const binary = require('electron') as string, headless = process.platform === 'linux' && !process.env.DISPLAY;
    const args = [join(__dirname, 'ui/report-export-runtime.cjs'), output];
    const result = await runOwnedNative({ command: headless ? 'xvfb-run' : binary,
      args: headless ? ['-a', binary, ...args] : args, cwd: join(__dirname, '..'), output, timeout: 90000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
        ...(process.platform === 'linux' ? { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-polyask-report-bus' } : {}) },
      cleanupPaths: () => [join(output, 'profile')]
    });
    assert.equal(result.live.length, 0); assert.equal(result.errors.length, 0);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    assert.equal(report.cases.length, 8); assert.equal(report.destroyed, 8);
    assert.equal(report.networkRequests, 0); assert.equal(report.deliveredRequests, 0);
    const pages: number[] = [];
    for (const [locale, question] of [['en', 'Saved question example'], ['zhCN', '示例问题'], ['zhTW', '範例問題']]) {
      const pdf = join(output, `${locale}.pdf`);
      const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
      const count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]); pages.push(count);
      assert.equal(count > 1, true);
      const size = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/);
      assert.equal(!!size && Math.abs(Number(size[1]) - 595.28) < 1 && Math.abs(Number(size[2]) - 841.89) < 1, true,
        'A4 dimensions allow Chromium sub-point rounding');
      const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
      assert.equal(text.replace(/\s/g, '').includes(question.replace(/\s/g, '')), true, `${locale}: question retained`);
      assert.match(text, /FINAL_MARKER/); assert.match(text, /Readable source/); assert.match(text, /image description/);
      for (let i = 0; i < 90; i++) {
        assert.equal(text.includes(`ROW_${String(i).padStart(3, '0')}`), true, `${locale}: row ${i} retained`);
        assert.equal(text.includes(`VALUE_${String(i).padStart(3, '0')}`), true, `${locale}: final column ${i} retained`);
      }
      const boxes = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' });
      for (const word of boxes.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)) {
        assert.equal(Number(word[1]) >= 0 && Number(word[2]) >= 0 && Number(word[3]) <= 596 && Number(word[4]) <= 843, true,
          `${locale}: text stays within A4`);
      }
      execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1100', '-png', pdf, join(output, locale)]);
    }
    if (process.platform === 'linux') {
      const boundary = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8'));
      assert.equal(boundary.samples.length >= 8, true);
      for (const pid of boundary.observed) {
        let live = false; try { process.kill(pid, 0); live = true; } catch { /* exited */ }
        assert.equal(live, false, `native report process ${pid} exited`);
      }
    }
    console.log(`Native PDF passed: ${JSON.stringify({ ...report, pages })}`);
    passed = true;
  } finally {
    if (passed && process.env.POLYASK_REPORT_KEEP_ARTIFACTS !== '1') rmSync(output, { recursive: true, force: true });
  }
});
