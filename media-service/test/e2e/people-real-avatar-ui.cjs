'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../web/node_modules/playwright');
const AxeBuilder = require('../../web/node_modules/@axe-core/playwright').default;

const ALLOWED_ROOT = path.resolve('F:\\shelfdeck_test_zone\\runs');

function runRoot() {
  const resolved = path.resolve(process.env.SHELFDECK_PEOPLE_REAL_ROOT || '');
  const relative = path.relative(ALLOWED_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('SHELFDECK_PEOPLE_REAL_ROOT must be inside the F: qualification runs root.');
  }
  return resolved;
}

async function capture(browser, options) {
  const context = await browser.newContext({ viewport: options.viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push({ status:response.status(), url:response.url() });
    }
  });
  try {
    await page.goto(options.baseUrl + '/people', { waitUntil:'networkidle' });
    await page.getByLabel('管理凭据').fill(options.adminApiKey);
    await page.getByRole('button', { name:'进入管理台' }).click();
    await page.getByRole('heading', { name:'人物', exact:true }).waitFor();
    await page.getByLabel('已登记人物名录').waitFor();
    const cards = page.locator('.people-card');
    assert.equal(await cards.count(), 23);
    await page.getByText('没有待确认的人', { exact:true }).waitFor();
    for (let index = 0; index < await cards.count(); index += 1) {
      await cards.nth(index).scrollIntoViewIfNeeded();
    }
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.people-avatar')]
        .every((item) => item.getAttribute('data-state') !== 'loading'), null,
    { timeout:30_000 });
    const avatarStates = await page.locator('.people-avatar').evaluateAll((items) =>
      items.reduce((counts, item) => {
        const state = item.getAttribute('data-state') || 'unknown';
        counts[state] = (counts[state] || 0) + 1;
        return counts;
      }, {}));
    assert.deepEqual(avatarStates, { loaded:21, fallback:2 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockingViolations = accessibility.violations.filter((item) =>
      item.impact === 'serious' || item.impact === 'critical');
    assert.deepEqual(blockingViolations.map((item) => item.id), []);
    await page.screenshot({ path:options.screenshotPath, fullPage:true });
    const unexpectedResponses = failedResponses.filter((item) =>
      !(item.status === 401 && item.url.includes('/v1/admin/')) &&
      !(item.status === 404 && item.url.includes('/avatar')) &&
      !(item.status === 404 && item.url.endsWith('/favicon.ico')));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpectedResponses, []);
    return Object.freeze({
      viewport: options.viewport,
      registeredPeople: await cards.count(),
      avatarStates,
      expectedFallbackResponses: failedResponses.filter((item) =>
        item.status === 404 && item.url.includes('/avatar')).length,
      seriousOrCriticalAxeViolations: 0,
      screenshotPath: options.screenshotPath,
    });
  } finally {
    await context.close();
  }
}

async function main() {
  const root = runRoot();
  const privateRuntime = JSON.parse(fs.readFileSync(
    path.join(root, 'private-runtime.json'), 'utf8'));
  const playwrightRoot = path.join(root, 'playwright');
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(playwrightRoot, { recursive:true });
  fs.mkdirSync(evidenceRoot, { recursive:true });
  const baseUrl = 'http://127.0.0.1:' +
    String(process.env.SHELFDECK_PEOPLE_REAL_PORT || '18183');
  const browser = await chromium.launch({ headless:true });
  let desktop;
  let narrow;
  try {
    desktop = await capture(browser, {
      baseUrl,
      adminApiKey: privateRuntime.adminApiKey,
      viewport: { width:1440, height:1000 },
      screenshotPath: path.join(playwrightRoot, 'people-real-desktop.png'),
    });
    narrow = await capture(browser, {
      baseUrl,
      adminApiKey: privateRuntime.adminApiKey,
      viewport: { width:390, height:844 },
      screenshotPath: path.join(playwrightRoot, 'people-real-narrow.png'),
    });
  } finally {
    await browser.close();
  }
  const facts = Object.freeze({
    schema:'shelfdeck.people-real-avatar-ui@1',
    result:'PASS',
    movie:'放·逐 (2006)',
    desktop,
    narrow,
  });
  fs.writeFileSync(path.join(evidenceRoot, 'people-real-avatar-ui-facts.json'),
    JSON.stringify(facts, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    result:facts.result,
    registeredPeople:desktop.registeredPeople,
    loadedAvatars:desktop.avatarStates.loaded,
    fallbackAvatars:desktop.avatarStates.fallback,
    axeSeriousOrCritical:0,
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
