'use strict';

const path = require('path');
const cheerio = require('cheerio');
const { fetch, ProxyAgent } = require('undici');

const running = new Map();

const DEFAULT_CRAWLERS = ['jav321', 'javbus'];
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRY = 2;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 ShelfDeck/1.0';

function normalizeAdultId(value) {
  const s = String(value || '').normalize('NFKC').toUpperCase();
  const fc2 = s.match(/\bFC2(?:[-_\s]?PPV)?[-_\s]?(\d{3,})\b/);
  if (fc2) return `FC2-${fc2[1]}`;
  const m = s.match(/\b([A-Z]{2,10})[-_\s]?(\d{2,6})\b/);
  return m ? `${m[1]}-${m[2]}` : s;
}

function resolveConfig(config, subLib) {
  const global = ((config.adultLibrary || {}).japaneseJav || {});
  const local = subLib.japaneseJav || {};
  return {
    ...global,
    ...local,
    crawlerSelection: {
      ...(global.crawlerSelection || {}),
      ...(local.crawlerSelection || {}),
    },
  };
}

function timeoutMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value || '').trim();
  const iso = s.match(/^PT(\d+(?:\.\d+)?)S$/i);
  if (iso) return Math.max(1000, Math.round(Number(iso[1]) * 1000));
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(1000, n) : DEFAULT_TIMEOUT_MS;
}

function dispatcherFor(proxyServer) {
  if (!proxyServer) return undefined;
  return new ProxyAgent(proxyServer);
}

async function fetchText(url, options, scraperConfig, taskId) {
  const retry = Number.isFinite(Number(scraperConfig.retry)) ? Number(scraperConfig.retry) : DEFAULT_RETRY;
  let lastError = null;
  for (let attempt = 0; attempt <= retry; attempt += 1) {
    const controller = new AbortController();
    if (taskId) running.set(taskId, controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs(scraperConfig.timeout));
    try {
      const res = await fetch(url, {
        ...options,
        redirect: (options && options.redirect) || 'follow',
        dispatcher: dispatcherFor(scraperConfig.proxyServer),
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'ja,en;q=0.8,zh-CN;q=0.7',
          ...(options && options.headers ? options.headers : {}),
        },
      });
      const text = await res.text();
      // In manual-redirect mode a 3xx is an expected outcome (e.g. JavBus age
      // interstitial redirect) that the caller inspects via headers — don't
      // treat it as an error.
      const manual = (options && options.redirect) === 'manual';
      if (!res.ok && !(manual && res.status >= 300 && res.status < 400)) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return { text, finalUrl: res.url, status: res.status, headers: res.headers };
    } catch (e) {
      lastError = e;
      if (controller.signal.aborted) throw e;
      if (attempt < retry) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
      if (taskId && running.get(taskId) === controller) running.delete(taskId);
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

async function fetchBinary(url, scraperConfig, taskId) {
  const controller = new AbortController();
  if (taskId) running.set(taskId, controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs(scraperConfig.timeout));
  let originReferer = '';
  try { originReferer = `${new URL(url).origin}/`; } catch (_) {}
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      dispatcher: dispatcherFor(scraperConfig.proxyServer),
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ja,en;q=0.8,zh-CN;q=0.7',
        'referer': scraperConfig.imageReferer || scraperConfig.referer || originReferer,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || '',
      finalUrl: res.url,
    };
  } finally {
    clearTimeout(timeout);
    if (taskId && running.get(taskId) === controller) running.delete(taskId);
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitList(value) {
  return cleanText(value)
    .split(/[、]+/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

function fieldFromText(text, label, nextLabels) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stop = nextLabels.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`${escaped}\\s*:?\\s*([\\s\\S]*?)(?=${stop ? `(?:${stop})\\s*:?` : '$'})`, 'u');
  const m = text.match(re);
  return cleanText(m && m[1]);
}

function absoluteUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  try {
    const resolved = new URL(url, baseUrl).toString();
    // Force https: many sources (dmm/r18/javbus) still serve http:// image and
    // trailer URLs, which Emby/Jellyfin reject as mixed content. These CDNs all
    // support https, so upgrade unconditionally.
    return resolved.replace(/^http:\/\//, 'https://');
  } catch (_) {
    return url.startsWith('http://') ? url.replace(/^http:\/\//, 'https://') : url;
  }
}

function highresDmmCover(url) {
  if (!url) return '';
  return url
    .replace(/ps\.jpg($|\?)/i, 'pl.jpg$1')
    .replace(/js\.jpg($|\?)/i, 'jp.jpg$1');
}

// Minimum viable metadata gate. A crawler that returns no title or no cover has
// almost certainly parsed the wrong page (an interstitial, a 404 stub, a login
// wall); better to reject and let the dispatcher fall through to the next
// source than to persist garbage into library.json. A title equal to the bare
// 番号 means the descriptive heading was never extracted — also reject.
function validateScrapeResult(result, sourceName) {
  if (!result || typeof result !== 'object') {
    throw new Error(`${sourceName}: scrape produced no result`);
  }
  const problems = [];
  if (!result.title) problems.push('missing title');
  else if (result.title === result.adultId) problems.push('title is bare 番号 (heading not parsed)');
  if (!result.posterUrl) problems.push('missing posterUrl');
  if (problems.length) {
    throw new Error(`${sourceName} returned incomplete metadata: ${problems.join(', ')}`);
  }
  return result;
}

function parsePlot($) {
  const candidates = $('.panel-body > .row, .panel-body .col-md-12')
    .map((_, el) => cleanText($(el).text()))
    .get();
  return candidates.find((text) =>
    text.length >= 40 &&
    !text.includes('adsby') &&
    !text.includes('videojs') &&
    !text.includes('Download') &&
    !text.includes('出演者:') &&
    !text.includes('メーカー:')
  ) || '';
}

async function scrapeJav321({ adultId, scraperConfig, taskId }) {
  const normalized = normalizeAdultId(adultId);
  const body = new URLSearchParams({ sn: normalized });
  const { text, finalUrl } = await fetchText('https://www.jav321.com/search', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }, scraperConfig, taskId);

  if (!/\/video\//i.test(finalUrl)) {
    throw new Error('jav321 did not return a detail page');
  }

  const $ = cheerio.load(text);
  const heading = cleanText($('h3').first().text()) || cleanText($('title').text());
  const idPattern = normalized.replace('-', '[-_\\s]?');
  const rawTitle = cleanText(heading.replace(new RegExp(`\\s+${idPattern}[\\s\\S]*$`, 'i'), ''));
  const title = rawTitle ? `${normalized} ${rawTitle}` : normalized;
  const panelText = cleanText($('.panel-body .row').first().text());
  const plot = parsePlot($);
  const labels = ['出演者', 'メーカー', 'ジャンル', '品番', '配信開始日', '収録時間', 'お気に入り登録数', '平均評価', 'シリーズ'];
  const infoRow = $('.panel-body > .row').first();
  const actors = infoRow.find('a[href^="/star/"]').map((_, el) => cleanText($(el).text())).get();
  const actorThumbs = {};
  const actorImage = absoluteUrl($('.panel-body img.img-responsive').eq(1).attr('src') || '', finalUrl);
  if (actors.length === 1 && actorImage) actorThumbs[actors[0]] = actorImage;
  const studio = cleanText(infoRow.find('a[href^="/company/"]').first().text()) || fieldFromText(panelText, 'メーカー', labels.slice(2));
  const genres = infoRow.find('a[href^="/genre/"]').map((_, el) => cleanText($(el).text())).get();
  const censor = genres.find((g) => ['有码', '无码', '無碼', '無修正'].includes(g)) || '';
  const premiered = fieldFromText(panelText, '配信開始日', labels.slice(5));
  const runtimeText = fieldFromText(panelText, '収録時間', labels.slice(6));
  const rating = fieldFromText(panelText, '平均評価', labels.slice(8));
  const series = fieldFromText(panelText, 'シリーズ', []);
  const runtimeMinutes = Number((runtimeText.match(/\d+/) || [])[0] || 0);
  const cid = path.basename(new URL(finalUrl).pathname);
  const coverSmall = absoluteUrl($('img.img-responsive').first().attr('src') || $('img').first().attr('src') || '', finalUrl);
  const posterUrl = coverSmall;
  const fanartUrl = scraperConfig.highresCover === false ? coverSmall : (highresDmmCover(coverSmall) || coverSmall);
  const trailerUrl = absoluteUrl($('video source').first().attr('src') || '', finalUrl);

  if (!title || !posterUrl) throw new Error('jav321 returned incomplete metadata');

  return validateScrapeResult({
    source: 'jav321',
    sourceUrl: finalUrl,
    adultId: normalized,
    cid,
    title,
    originalTitle: rawTitle,
    plot,
    studio,
    director: '',
    actors,
    actorThumbs,
    genres,
    tags: censor ? [...new Set([censor, ...genres])] : genres,
    censor,
    rating,
    premiered,
    runtimeMinutes,
    series,
    posterUrl,
    fanartUrl,
    trailerUrl,
    country: '日本',
  }, 'jav321');
}

// Fallback crawler: javbus. Uses the friendly URL https://www.javbus.com/{ID},
// which resolves directly to the movie detail page (or a 404). Metadata is
// spread across <a class="box"> headings and the info <p> lines; cover/poster
// share the big preview image. Mirrors the scrapeJav321 result shape so callers
// are agnostic to source.
async function scrapeJavbus({ adultId, scraperConfig, taskId }) {
  const normalized = normalizeAdultId(adultId);
  const idForUrl = encodeURIComponent(normalized);
  const movieUrl = `https://www.javbus.com/${idForUrl}`;

  // JavBus gates the detail page behind an age interstitial and 302s to
  // /doc/driver-verify. Crucially though, the FULL movie HTML is already in the
  // 302 response body (JavBus renders the page, then attaches the verify
  // redirect). So we use redirect:'manual' and parse that 302 body directly —
  // no cookie/age dance needed, which also works from datacenter IPs where the
  // verify cookie is never accepted. Mirrors the approach in Yuukiy/JavSP.
  const resp = await fetchText(movieUrl, { redirect: 'manual' }, scraperConfig, taskId);
  const { text, finalUrl } = resp;
  const $ = cheerio.load(text);

  // JavBus returns a small 404 stub on miss. Detect via <title>.
  const pageTitle = cleanText($('title').first().text());
  if (/^404\b/.test(pageTitle) && !$('.container h3').length) {
    throw new Error(`javbus has no page for ${normalized} (404)`);
  }

  // Title lives in div.container > h3 as "<番号> <descriptive heading>".
  const fullHeading = cleanText($('.container h3').first().text())
    || cleanText($('h2').first().text())
    || pageTitle.split(/\s+-\s*JavBus/i)[0];
  if (!fullHeading) throw new Error('javbus did not return a detail page');

  // Cover is the big preview image, relative path.
  const coverAttr = $('a.bigImage img').attr('src')
    || $('.screencap img').attr('src')
    || $('img[src*="cover"]').first().attr('src')
    || '';
  const coverUrl = absoluteUrl(coverAttr, finalUrl);
  const posterUrl = coverUrl;
  const fanartUrl = scraperConfig.highresCover === false ? coverUrl : (highresDmmCover(coverUrl) || coverUrl);

  // The info block is div.col-md-3.info. Each row is <p><span>label:</span>
  // <a>value</a></p> (for link rows) or <p><span>label:</span> value</p>
  // (for tail-text rows like date/length). Walk the spans and pull either the
  // next sibling's text or the span's trailing tail text.
  const infoBlock = $('div.col-md-3.info').first();
  const labelMap = {};
  infoBlock.find('p > span').each((_, el) => {
    const label = cleanText($(el).text()).replace(/[:：]\s*$/, '');
    if (!label) return;
    if (labelMap[label]) return;
    const next = $(el).next();
    const viaLink = cleanText(next.text());
    // For tail-text rows (date/length) the value is the text node right after
    // the span inside the same <p>.
    const tailNode = el.nextSibling ? cleanText(el.nextSibling.data) : '';
    const value = viaLink || tailNode;
    if (value) labelMap[label] = value;
  });
  // Localized label aliases across 繁/簡/EN.
  const FIELD_ALIASES = {
    studio: ['製作商', '制作商', 'Studio'],
    publisher: ['發行商', '发行商', 'Label'],
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

  // Actors: avatar-box blocks carry the name in img[title] and thumb in img[src].
  const actors = [];
  const actorThumbs = {};
  $('a.avatar-box').each((_, el) => {
    const img = $(el).find('img');
    const name = cleanText(img.attr('title'));
    if (!name) return;
    actors.push(name);
    const thumb = img.attr('src') || '';
    if (thumb && !/nowprinting\.gif$/i.test(thumb)) {
      actorThumbs[name] = absoluteUrl(thumb, finalUrl);
    }
  });

  const studio = pick('studio');
  const director = pick('director');
  const series = pick('series');
  const premiered = pick('premiered');
  const runtimeText = pick('runtime');
  const runtimeMinutes = Number((runtimeText.match(/\d+/) || [])[0] || 0);

  // Genres are label links inside span.genre. Restrict to `label a` so we
  // don't pick up actor alias links that also happen to live under a
  // span.genre container elsewhere on the page.
  const genres = $('span.genre label a')
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter((x) => x && x !== '多選提交');
  const censor = genres.find((g) => ['有码', '无码', '無碼', '無修正'].includes(g)) || '';

  // Title: strip the leading 番号 (with optional separator) to get the
  // descriptive heading. The 番号 may appear as "MVSD-175" or "MVSD 175".
  const titleHeading = cleanText(fullHeading.replace(
    new RegExp(`^${normalized.replace('-', '[-_\\s]?')}\\s*`, 'i'), ''));
  const title = titleHeading ? `${normalized} ${titleHeading}` : normalized;
  if (!posterUrl) throw new Error('javbus returned incomplete metadata');

  return validateScrapeResult({
    source: 'javbus',
    sourceUrl: movieUrl,
    adultId: normalized,
    // javbus has no separate content-id (unlike jav321's dmm cid); leave empty
    // so the NFO writer skips the <uniqueid type="cid"> node rather than
    // duplicating the 番号 there.
    cid: '',
    title,
    originalTitle: titleHeading,
    plot: '',
    studio,
    director,
    actors,
    actorThumbs,
    genres,
    tags: censor ? [...new Set([censor, ...genres])] : genres,
    censor,
    rating: '',
    premiered,
    runtimeMinutes,
    series,
    posterUrl,
    fanartUrl,
    trailerUrl: '',
    country: '日本',
  }, 'javbus');
}

// Crawler registry — each entry maps a config name to its scrape function.
// New sources are added here; the dispatcher tries them in the configured order
// and falls through on failure. jav321 is primary, javbus is the fallback.
const CRAWLERS = {
  jav321: scrapeJav321,
  javbus: scrapeJavbus,
};

async function scrapeJapaneseJav({ taskId, subLib, adultId, onLog }) {
  const configStore = require('../configStore');
  const config = configStore.loadConfig();
  const scraperConfig = resolveConfig(config, subLib);
  const crawlers = scraperConfig.crawlers || (scraperConfig.crawlerSelection && scraperConfig.crawlerSelection.normal) || DEFAULT_CRAWLERS;
  const id = normalizeAdultId(adultId);
  const errors = [];

  for (const crawler of crawlers) {
    const fn = CRAWLERS[crawler];
    if (!fn) {
      onLog && onLog('warn', `Skipping unsupported crawler: ${crawler}`);
      continue;
    }
    try {
      onLog && onLog('info', `Trying japanese JAV crawler: ${crawler}`);
      const result = await fn({ adultId: id, scraperConfig, taskId });
      onLog && onLog('info', `Scraped ${id} from ${crawler}`);
      return result;
    } catch (e) {
      errors.push(`${crawler}: ${e.message}`);
      onLog && onLog('warn', `${crawler} failed: ${e.message}`);
    }
  }

  throw new Error(`No Japanese JAV crawler succeeded for ${id}: ${errors.join('; ')}`);
}

function abort(taskId) {
  const controller = running.get(taskId);
  if (!controller) return false;
  try { controller.abort(); } catch (_) {}
  running.delete(taskId);
  return true;
}

module.exports = {
  scrapeJapaneseJav,
  fetchBinary,
  abort,
  normalizeAdultId,
  // Exported for unit tests so they exercise the real helpers rather than
  // duplicated copies.
  absoluteUrl,
  validateScrapeResult,
};
