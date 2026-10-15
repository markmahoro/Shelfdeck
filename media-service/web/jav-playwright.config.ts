import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:/jav-.*\.spec\.ts/,timeout:30000,
  outputDir:'../../.codex/jav-browser',use:{baseURL:'http://127.0.0.1:18194',trace:'retain-on-failure'},
  webServer:{command:'npx vite preview --host 127.0.0.1 --port 18194 --strictPort',url:'http://127.0.0.1:18194',reuseExistingServer:false},
  projects:[{name:'wide',use:{viewport:{width:1920,height:1080}}},{name:'narrow',use:{viewport:{width:390,height:844}}}]});
