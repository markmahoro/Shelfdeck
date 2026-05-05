import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });

// ── Verify Media Page: blur + wide viewport ──
{
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:18080/media', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-manage-item-id]', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Apply blur (same as capture script)
  await page.$$eval('.mediaManageTitle', els => els.forEach(el => {
    el.style.filter = 'blur(7px)';
  }));
  await page.waitForTimeout(300);

  // Verify blur applied
  const blurCount = await page.$$eval('.mediaManageTitle',
    els => els.filter(el => el.style.filter.includes('blur')).length
  );
  console.log(`Media: ${blurCount} titles blurred`);

  // Check if "码率压缩" button text is visible
  const btnTexts = await page.$$eval('button', els => els.map(e => e.textContent?.trim()).filter(Boolean));
  const hasTranscodeBtn = btnTexts.some(t => t === '码率压缩');
  console.log(`Media: "码率压缩" button visible: ${hasTranscodeBtn}`);

  // Apply transcode filter
  const filterSelects = await page.$$('.filterRow select');
  if (filterSelects.length > 0) {
    await filterSelects[0].selectOption('transcode');
    await page.waitForTimeout(1200);
  }

  // Re-check blur and button after filter
  const blurCount2 = await page.$$eval('.mediaManageTitle',
    els => els.filter(el => el.style.filter.includes('blur')).length
  );
  const btnTexts2 = await page.$$eval('button', els => els.map(e => e.textContent?.trim()).filter(Boolean));
  const hasTranscodeBtn2 = btnTexts2.some(t => t === '码率压缩');
  console.log(`Media (filtered): ${blurCount2} titles blurred, "码率压缩" visible: ${hasTranscodeBtn2}`);

  await page.close();
  await ctx.close();
}

// ── Verify Tasks Page: filter + blur ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:18080/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Apply status filter to completed
  const selects = await page.$$('select');
  if (selects.length >= 1) {
    await selects[0].selectOption('done');
    await page.waitForTimeout(1500);
  }

  // Check the selected value
  const statusVal = await selects[0].inputValue();
  console.log(`Tasks: status filter value = "${statusVal}"`);

  // Apply blur
  await page.$$eval('table tbody td:first-child span', els => els.forEach(el => {
    el.style.filter = 'blur(7px)';
  }));
  await page.waitForTimeout(300);

  const blurCount = await page.$$eval('table tbody td:first-child span',
    els => els.filter(el => el.style.filter.includes('blur')).length
  );
  console.log(`Tasks: ${blurCount} movie names blurred`);

  // Check that only completed tasks are showing
  const statusTexts = await page.$$eval('table tbody tr td:nth-child(3)',
    els => els.map(e => e.textContent?.trim()).filter(Boolean)
  );
  const uniqueStatuses = [...new Set(statusTexts)];
  console.log(`Tasks: visible statuses = [${uniqueStatuses.join(', ')}]`);

  await page.close();
  await ctx.close();
}

await browser.close();
console.log('Verification complete.');
