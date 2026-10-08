import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: /series-(material-field|shelf-rules|identity|collection)\.spec\.ts/, timeout: 30000,
  outputDir: '../../.codex/series-browser',
  use: { baseURL: 'http://127.0.0.1:18193', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 18193 --strictPort',
    url: 'http://127.0.0.1:18193', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
  ],
});
