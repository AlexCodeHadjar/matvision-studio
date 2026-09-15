import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Options } from '@wdio/types';
import type { TauriCapabilities } from '@wdio/tauri-service';

const application = resolve(
  process.env.MATVISION_BINARY ??
    `src-tauri/target/release/matvision-studio${process.platform === 'win32' ? '.exe' : ''}`,
);

export const config: Options.Testrunner & { capabilities: TauriCapabilities[] } = {
  runner: 'local',
  specs: ['./tests/native/**/*.e2e.ts'],
  maxInstances: 1,
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  reporters: ['spec'],
  logLevel: 'warn',
  outputDir: './test-results/native/logs',
  waitforTimeout: 20_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  services: [
    [
      '@wdio/tauri-service',
      {
        driverProvider: 'external',
        appBinaryPath: application,
        autoInstallTauriDriver: true,
        autoDownloadEdgeDriver: true,
        ...(process.env.TAURI_DRIVER_PATH
          ? { tauriDriverPath: process.env.TAURI_DRIVER_PATH }
          : {}),
        captureBackendLogs: false,
        captureFrontendLogs: false,
        startTimeout: 60_000,
      },
    ],
  ],
  capabilities: [{ browserName: 'tauri', 'tauri:options': { application } }],
  onPrepare() {
    if (!existsSync(application)) {
      throw new Error(`Build the Tauri application first. Binary is missing: ${application}`);
    }
    mkdirSync('test-results/native', { recursive: true });
  },
};
