import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Software rendering plus screenshot readback is slower than the native GPU.
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.015,
      threshold: 0.12,
      stylePath: './tests/browser/screenshot.css',
    },
  },
  reporter: [['list'], ['html', { outputFolder: 'test-results/browser-report', open: 'never' }]],
  outputDir: 'test-results/browser',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    channel: 'chromium',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      // Fix the renderer for reproducible pixels, while exercising real WebGL2.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'chromium-swiftshader', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1420 --strictPort',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
