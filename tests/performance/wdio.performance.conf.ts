import { config as nativeConfig } from '../../wdio.conf';
import { resolve } from 'node:path';

export const config = {
  ...nativeConfig,
  specs: [resolve('tests/performance/native-performance.e2e.ts')],
  outputDir: './test-results/native-performance/logs',
  mochaOpts: { ui: 'bdd', timeout: 600_000 },
};
