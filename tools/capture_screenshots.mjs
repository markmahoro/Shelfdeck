import { chromium } from 'playwright';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const BASE = 'http://127.0.0.1:18080';
const OUT = 'C:\\Users\\markm\\Desktop\\shelfdeck_use_case';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });

// Wide viewport for media pages so the action button column is visible
const wideContext = await browser.newContext({
  viewport: { width: 1680, height: 900 },
  deviceScaleFactor: 2,
});
// Standard viewport for dashboard / config pages
const stdContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

async function shot(context, pagePath, filename, { waitFn, preActions, blurSelectors } = {}) {
  const page = await context.newPage();
  console.log(`Navigating to ${BASE}${pagePath}`);
  await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  if (waitFn) await waitFn(page);
  if (preActions) await preActions(page);

  // Blur sensitive text (movie names) before capturing
  if (blurSelectors) {
    for (const sel of blurSelectors) {
      await page.$$eval(sel, els => els.forEach(el => {
        el.style.filter = 'blur(7px)';
        el.style.userSelect = 'none';
      }));
    }
    await page.waitForTimeout(300);
  }

  const outPath = join(OUT, filename);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`Saved: ${outPath}`);
  await page.close();
}

// ──────────────────────────────────────────────
// Screenshot 1: Dashboard (standard width)
// ──────────────────────────────────────────────
await shot(stdContext, '/', '01-dashboard.png', {
  waitFn: async (page) => {
    await page.waitForSelector('.healthCard', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
  },
  // Blur sublibrary name if visible on dashboard
  blurSelectors: [],
});

// ──────────────────────────────────────────────
// Screenshot 2: Media Library — all items (wide)
// ──────────────────────────────────────────────
await shot(wideContext, '/media', '02-media-library-all.png', {
  waitFn: async (page) => {
    await page.waitForSelector('[data-manage-item-id]', { timeout: 15000 });
    await page.waitForTimeout(800);
  },
  blurSelectors: ['.mediaManageTitle'],
});

// ──────────────────────────────────────────────
// Screenshot 3: Media Library — transcode filter (wide)
// ──────────────────────────────────────────────
await shot(wideContext, '/media', '03-media-library-transcode.png', {
  waitFn: async (page) => {
    await page.waitForSelector('[data-manage-item-id]', { timeout: 15000 });
    await page.waitForTimeout(800);
  },
  preActions: async (page) => {
    // Select "码率压缩" from the action filter (first .filterRow select)
    const filterSelects = await page.$$('.filterRow select');
    if (filterSelects.length > 0) {
      await filterSelects[0].selectOption('transcode');
      await page.waitForTimeout(1200);
    }
  },
  blurSelectors: ['.mediaManageTitle'],
});

// ──────────────────────────────────────────────
// Screenshot 4: Task Monitor — completed only (standard width)
// ──────────────────────────────────────────────
await shot(stdContext, '/tasks', '04-task-monitor.png', {
  waitFn: async (page) => {
    await page.waitForTimeout(2500);
  },
  preActions: async (page) => {
    // Filter to completed tasks only
    // Status filter is the first <select> on the page, type filter is second
    const selects = await page.$$('select');
    if (selects.length >= 1) {
      await selects[0].selectOption('done');
      await page.waitForTimeout(1500);
    }
  },
  // Blur movie names in the task table (first td > span in each row)
  blurSelectors: ['table tbody td:first-child span'],
});

// ──────────────────────────────────────────────
// Screenshot 5: Transcode Config (standard width)
// ──────────────────────────────────────────────
await shot(stdContext, '/transcode', '05-transcode-config.png', {
  waitFn: async (page) => {
    await page.waitForTimeout(2000);
  },
  blurSelectors: [],
});

console.log('All screenshots captured.');
await browser.close();
