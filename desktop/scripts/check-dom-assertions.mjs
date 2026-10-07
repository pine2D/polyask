import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDomAssertions } from './lib/dom-assertion-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['test', 'scripts'].flatMap(directory => readdirSync(resolve(root, directory), { recursive: true })
  .filter(file => /\.(test|check)\.(ts|tsx|js|mjs)$/.test(file))
  .map(file => resolve(root, directory, file)));
const failures = files.flatMap(file => checkDomAssertions(readFileSync(file, 'utf8'), relative(root, file)));
for (const failure of failures.slice(0, 100)) {
  console.error(`${failure.filename}:${failure.line}: compare DOM existence/identity as a boolean, or compare scalar properties`);
}
if (failures.length > 100) console.error(`${failures.length - 100} more unsafe assertions`);
if (failures.length) process.exitCode = 1;
else console.log(`DOM assertion check passed (${files.length} files)`);
