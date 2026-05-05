import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Media page
await page.goto('http://127.0.0.1:18080/media', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const rows = await page.$$eval('[data-manage-item-id]', els => els.length);
console.log('Media rows rendered:', rows);
if (rows > 0) {
  const firstRow = await page.$eval('[data-manage-item-id]', el => el.textContent?.substring(0, 150));
  console.log('First row:', firstRow);
}

// Tasks page
await page.goto('http://127.0.0.1:18080/tasks', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const tasksText = await page.$eval('body', el => el.textContent?.substring(0, 400));
console.log('Tasks:', tasksText);

// Transcode page
await page.goto('http://127.0.0.1:18080/transcode', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const tcText = await page.$eval('body', el => el.textContent?.substring(0, 400));
console.log('Transcode:', tcText);

await browser.close();
