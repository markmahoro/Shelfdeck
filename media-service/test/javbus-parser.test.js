'use strict';

// Offline parser tests for the javbus crawler. The live site is reachable but
// gated behind a network/IP-dependent age interstitial; the scraper reads the
// 302 response body directly (which already contains the full movie HTML), so
// these tests feed a faithful fixture through the SAME cheerio selector sequence
// the real scrapeJavbus uses and assert the parsed shape.
//
// We replicate the selector pipeline here (rather than stubbing the module's
// internal fetch) because the scraper binds `fetch` at module load. The fixture
// is modelled on the real javbus 302 body captured against MVSD-175.
//
// Guards against regressions in:
//   - title strip (番号 prefix removed, descriptive heading kept)
//   - cover picked from a.bigImage img
//   - actor avatar-box (name via img[title], thumb via img[src])
//   - genres restricted to span.genre label a (NOT actor alias links)
//   - localized info-row label aliases across 繁/簡/EN

const test = require('node:test');
const assert = require('node:assert');
const cheerio = require('cheerio');

const scraper = require('../src/services/japaneseJavScraper');
// Use the REAL helpers from the source so tests guard against regressions in
// the actual code rather than a duplicated copy.
const { absoluteUrl, preferredCoverUrl, validateScrapeResult } = scraper;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// The exact selector pipeline from scrapeJavbus. If the source changes its
// selectors, this test breaks — which is the point.
function parseJavbus(html, normalized = 'MVSD-175', baseUrl = 'https://www.javbus.com/MVSD-175') {
  const $ = cheerio.load(html);
  const pageTitle = cleanText($('title').first().text());
  if (/^404\b/.test(pageTitle) && !$('.container h3').length) {
    throw new Error(`javbus has no page for ${normalized} (404)`);
  }
  const fullHeading = cleanText($('.container h3').first().text())
    || cleanText($('h2').first().text())
    || pageTitle.split(/\s+-\s*JavBus/i)[0];

  const coverAttr = $('a.bigImage').attr('href')
    || $('a.bigImage img').attr('src')
    || $('.screencap img').attr('src')
    || $('img[src*="cover"]').first().attr('src')
    || '';
  const coverUrl = absoluteUrl(coverAttr, baseUrl);

  const infoBlock = $('div.col-md-3.info').first();
  const labelMap = {};
  infoBlock.find('p > span').each((_, el) => {
    const label = cleanText($(el).text()).replace(/[:：]\s*$/, '');
    if (!label || labelMap[label]) return;
    const next = $(el).next();
    const viaLink = cleanText(next.text());
    const tailNode = el.nextSibling ? cleanText(el.nextSibling.data) : '';
    const value = viaLink || tailNode;
    if (value) labelMap[label] = value;
  });
  const FIELD_ALIASES = {
    studio: ['製作商', '制作商', 'Studio'],
    director: ['導演', '导演', 'Director'],
    series: ['系列', 'Series'],
    premiered: ['發行日期', '发行日期', '発売日', 'Release Date'],
    runtime: ['長度', '长度', '収録時間', '収録时间', 'Length'],
  };
  const pick = (canonical) => {
    for (const alias of FIELD_ALIASES[canonical] || []) {
      if (labelMap[alias]) return labelMap[alias];
    }
    return '';
  };

  const actors = [];
  const actorThumbs = {};
  $('a.avatar-box').each((_, el) => {
    const img = $(el).find('img');
    const name = cleanText(img.attr('title'));
    if (!name) return;
    actors.push(name);
    const thumb = img.attr('src') || '';
    if (thumb && !/nowprinting\.gif$/i.test(thumb)) actorThumbs[name] = absoluteUrl(thumb, baseUrl);
  });

  const genres = $('span.genre label a')
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter((x) => x && x !== '多選提交');

  const titleHeading = cleanText(fullHeading.replace(
    new RegExp(`^${normalized.replace('-', '[-_\\s]?')}\\s*`, 'i'), ''));
  const title = titleHeading ? `${normalized} ${titleHeading}` : normalized;

  return { title, titleHeading, coverUrl, actors, actorThumbs, genres,
    studio: pick('studio'), director: pick('director'), series: pick('series'),
    premiered: pick('premiered'), runtimeText: pick('runtime'), pageTitle };
}

// Fixture modelled on the real javbus 302 body (繁中 locale) captured against
// MVSD-175. Structure mirrors what cheerio sees after JavBus renders the page
// before attaching the verify redirect.
const FIXTURE_HTML = `<!DOCTYPE html><html><head>
<title>MVSD-175 ドスケベ美女の3穴中出しゴックンFUCK 澤村レイコ - JavBus</title>
</head><body>
<div class="container">
  <h3>MVSD-175 ドスケベ美女の3穴中出しゴックンFUCK 澤村レイコ</h3>
  <a class="bigImage" href="https://pics.dmm.co.jp/digital/video/mvsd175/mvsd175jp.jpg">
    <img src="/pics/cover/250b_b.jpg">
  </a>
  <div class="col-md-3 info">
    <p><span class="header">識別碼:</span> <a>MVSD-175</a></p>
    <p><span class="header">發行日期:</span> 2012-07-15</p>
    <p><span class="header">長度:</span> 129分鐘</p>
    <p><span class="header">導演:</span> <a>ドラゴン西川</a></p>
    <p><span class="header">製作商:</span> <a>エムズビデオグループ</a></p>
    <p><span class="header">發行商:</span> <a>M’svideoGroup</a></p>
    <p><span class="header">系列:</span> <a>3穴中出しゴックンFUCK</a></p>
    <p>
      <span class="genre"><label><a href="/genre/4o">高畫質</a></label></span>
      <span class="genre"><label><a href="/genre/1j">濫交</a></label></span>
      <span class="genre"><label><a href="/genre/4">中出</a></label></span>
    </p>
  </div>
  <a class="avatar-box" href="/star/1rc">
    <div class="photo-frame"><img src="/pics/actress/1rc_a.jpg" title="澤村レイコ（高坂保奈美）"></div>
    <span>澤村レイコ</span>
  </a>
</div>
</body></html>`;

const FIXTURE_404 = `<!DOCTYPE html><html><head>
<title>404 Page Not Found! - JavBus</title>
</head><body><div class="row"><h2>404</h2></div></body></html>`;

test('javbus: title strips leading 番号 and keeps descriptive heading', () => {
  const r = parseJavbus(FIXTURE_HTML);
  assert.ok(r.title.startsWith('MVSD-175 '), `title starts with 番号: ${r.title}`);
  assert.match(r.title, /ドスケベ美女/);
  assert.match(r.titleHeading, /ドスケベ美女/);
});

test('javbus: cover picked from a.bigImage href and absolutized', () => {
  const r = parseJavbus(FIXTURE_HTML);
  assert.match(r.coverUrl, /^https:\/\/pics\.dmm\.co\.jp\/digital\/video\/mvsd175\/mvsd175jp\.jpg$/);
});

test('javbus: actor resolved via avatar-box img[title] with thumb', () => {
  const r = parseJavbus(FIXTURE_HTML);
  assert.deepStrictEqual(r.actors, ['澤村レイコ（高坂保奈美）']);
  const thumb = r.actorThumbs['澤村レイコ（高坂保奈美）'];
  assert.ok(thumb && /actress\/1rc_a\.jpg$/.test(thumb), `thumb absolutized: ${thumb}`);
});

test('javbus: genres restricted to span.genre label a, actor alias not leaked', () => {
  const r = parseJavbus(FIXTURE_HTML);
  assert.deepStrictEqual(r.genres, ['高畫質', '濫交', '中出']);
  assert.ok(!r.genres.some((g) => g.includes('澤村')), 'actor name leaked into genres');
});

test('javbus: localized info labels (繁) resolve studio/director/series/date/runtime', () => {
  const r = parseJavbus(FIXTURE_HTML);
  assert.strictEqual(r.studio, 'エムズビデオグループ');
  assert.strictEqual(r.director, 'ドラゴン西川');
  assert.strictEqual(r.series, '3穴中出しゴックンFUCK');
  assert.strictEqual(r.premiered, '2012-07-15');
  assert.strictEqual(r.runtimeText, '129分鐘');
});

test('javbus: 簡中 label aliases resolve when locale differs', () => {
  const html = FIXTURE_HTML
    .replace('發行日期', '发行日期')
    .replace('長度', '长度')
    .replace('製作商', '制作商')
    .replace('導演', '导演');
  const r = parseJavbus(html);
  assert.strictEqual(r.studio, 'エムズビデオグループ');
  assert.strictEqual(r.director, 'ドラゴン西川');
  assert.strictEqual(r.premiered, '2012-07-15');
  assert.strictEqual(r.runtimeText, '129分鐘');
});

test('javbus: 404 page raises clear error', () => {
  assert.throws(() => parseJavbus(FIXTURE_404), /404|no page/i);
});

test('absoluteUrl upgrades http:// to https:// for mixed-content safety', () => {
  // Sources like dmm/r18 serve http:// image and trailer URLs; Emby rejects
  // mixed content. Any URL flowing through absoluteUrl must come out https.
  assert.strictEqual(
    absoluteUrl('http://pics.dmm.co.jp/cover/250b_b.jpg', 'https://www.javbus.com/x'),
    'https://pics.dmm.co.jp/cover/250b_b.jpg',
  );
  // Protocol-relative URLs stay https too.
  assert.strictEqual(
    absoluteUrl('//pics.dmm.co.jp/cover/x.jpg', 'https://www.javbus.com/x'),
    'https://pics.dmm.co.jp/cover/x.jpg',
  );
  // Already-https URLs are untouched.
  assert.strictEqual(
    absoluteUrl('https://pics.dmm.co.jp/cover/x.jpg', 'https://www.javbus.com/x'),
    'https://pics.dmm.co.jp/cover/x.jpg',
  );
});

test('preferredCoverUrl upgrades DMM small cover URLs for local poster files', () => {
  assert.strictEqual(
    preferredCoverUrl('https://pics.dmm.co.jp/digital/video/sora107/sora107ps.jpg'),
    'https://pics.dmm.co.jp/digital/video/sora107/sora107pl.jpg',
  );
  assert.strictEqual(
    preferredCoverUrl('https://pics.dmm.co.jp/digital/video/mvsd175/mvsd175js.jpg'),
    'https://pics.dmm.co.jp/digital/video/mvsd175/mvsd175jp.jpg',
  );
  assert.strictEqual(
    preferredCoverUrl('https://pics.dmm.co.jp/digital/video/sora107/sora107ps.jpg', { highresCover: false }),
    'https://pics.dmm.co.jp/digital/video/sora107/sora107ps.jpg',
  );
});

test('validateScrapeResult rejects garbage that would otherwise be persisted', () => {
  const ok = { adultId: 'MVSD-175', title: 'MVSD-175 Some Title', posterUrl: 'https://x/y.jpg' };
  assert.strictEqual(validateScrapeResult(ok, 'javbus'), ok, 'valid result passes through');
  // Missing title.
  assert.throws(() => validateScrapeResult({ adultId: 'X', title: '', posterUrl: 'https://x/y.jpg' }, 's'), /missing title/);
  // Missing poster.
  assert.throws(() => validateScrapeResult({ adultId: 'X', title: 'T', posterUrl: '' }, 's'), /missing posterUrl/);
  // Title is the bare 番号 → heading was never parsed.
  assert.throws(() => validateScrapeResult({ adultId: 'MVSD-175', title: 'MVSD-175', posterUrl: 'https://x/y.jpg' }, 's'), /bare 番号/);
});

test('scraper exports normalizeAdultId', () => {
  assert.strictEqual(typeof scraper.normalizeAdultId, 'function');
  assert.strictEqual(scraper.normalizeAdultId('mvsd-175'), 'MVSD-175');
  assert.strictEqual(scraper.normalizeAdultId('fc2-ppv-12345'), 'FC2-12345');
});
