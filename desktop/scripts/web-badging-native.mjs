import { createRequire } from 'node:module';
import { accessSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runOwnedNative } from './lib/owned-native-process.mjs';
import { packagedExecutablePath } from './runtime-runner.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = process.argv.includes('--built-preloads');
const output = mkdtempSync(join(tmpdir(), 'polyask-web-badging-'));
console.log(`Web badging evidence: ${output}`);
const boundaryOutput = join(output, 'launcher-boundary');
mkdirSync(boundaryOutput);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const sample = processBoundary({ getAppMetrics: () => [] }, boundaryOutput);
for (const [source, target] of [['main/web-badging', 'web-badging'], ['preload/web-badging', 'badge-preload']]) {
  writeFileSync(join(output, `${target}.cjs`), ts.transpileModule(readFileSync(join(root, `src/${source}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText);
}
const archive = join(dirname(packagedExecutablePath()), 'resources/app.asar');
const entries = ['.webpack/renderer/site_window/preload.js', '.webpack/renderer/web_badging/preload.js'];
if (built) for (const entry of entries) require('@electron/asar').extractFile(archive, entry);
const [framePreload, workerPreload] = built ? entries.map(entry => join(archive, entry)) : [join(output, 'badge-preload.cjs'), join(output, 'badge-preload.cjs')];
if (!built) accessSync(framePreload);
const result = await runOwnedNative({
  command: 'xvfb-run',
  args: ['-a', require('electron'), join(root, 'test/ui/web-badging-native-runtime.cjs'), output, framePreload, workerPreload],
  cwd: root, output, timeout: 30000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` },
  onSample: sample, onStdout: chunk => process.stdout.write(chunk),
  cleanupPaths: () => [join(output, 'profile')]
});
console.log(`Web badging native checks passed; ${result.observed.length} owned processes exited`);
