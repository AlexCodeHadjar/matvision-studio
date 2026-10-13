import { spawnSync } from 'node:child_process';
for (const args of [
  ['scripts/bake-garments.mjs'],
  ['scripts/bake-catalog.mjs'],
  ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.app.json'],
  ['node_modules/vite/bin/vite.js', 'build'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
