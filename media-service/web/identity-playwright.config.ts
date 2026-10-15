import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:['identity-selection.spec.ts','jav-identity.spec.ts'],timeout:30000,
  outputDir:'../../.codex/identity-browser/identity',use:{baseURL:'http://127.0.0.1:18192',trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 18192 --strictPort',url:'http://127.0.0.1:18192',reuseExistingServer:true},
  projects:[{name:'desktop',use:{viewport:{width:1920,height:1080}}},{name:'narrow',use:{viewport:{width:390,height:844}}}]});
