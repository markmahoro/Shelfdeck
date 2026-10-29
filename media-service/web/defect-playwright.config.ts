import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:'defect-admission.spec.ts',timeout:30000,
  use:{baseURL:'http://127.0.0.1:18247',trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 18247 --strictPort',url:'http://127.0.0.1:18247',reuseExistingServer:false,timeout:120000},
  projects:[
    {name:'wide',use:{...devices['Desktop Chrome'],viewport:{width:1920,height:1080}}},
    {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:800}}},
    {name:'tablet',use:{...devices['Desktop Chrome'],viewport:{width:1024,height:768}}},
    {name:'narrow',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
  ],
});
