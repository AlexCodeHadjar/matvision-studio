// Fails the build when an emitted JavaScript chunk exceeds RENDER_BUDGET.maxBundleJsBytes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(new URL('../src/scene/budget.ts', import.meta.url), 'utf8');
const match = /maxBundleJsBytes:\s*([\d_]+)/.exec(source);
if (!match) throw new Error('maxBundleJsBytes is missing from src/scene/budget.ts');
const limit = Number(match[1].replaceAll('_', ''));

const directory = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const chunks = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, bytes: fs.statSync(path.join(directory, name)).size }));
if (!chunks.length)
  throw new Error('No JavaScript chunks found in dist/assets. Run the build first.');

let failed = false;
for (const { name, bytes } of chunks) {
  const over = bytes > limit;
  failed ||= over;
  console.log(`${over ? 'OVER BUDGET' : 'ok'}  ${name}  ${bytes} / ${limit} bytes`);
}
if (failed) process.exit(1);
