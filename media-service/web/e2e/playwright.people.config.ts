import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const runRoot = path.resolve(process.env.SHELFDECK_PEOPLE_E2E_ROOT || '');
const port = Number(process.env.SHELFDECK_PEOPLE_E2E_PORT || 18182);

export default defineConfig({
  testDir: '.',
  testMatch: 'people-avatar.spec.ts',
  timeout: 45_000,
  outputDir: path.join(runRoot, 'playwright', process.env.SHELFDECK_PEOPLE_PLAYWRIGHT_RUN || 'current'),
  reporter: [['line']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node people-e2e-server.cjs',
    url: `http://127.0.0.1:${port}/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
});
