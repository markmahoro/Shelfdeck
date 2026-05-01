const fs = require('fs');
const path = require('path');
const https = require('https');

function dataRoot() {
  return (
    process.env.MEDIA_SERVICE_DATA_DIR ||
    process.env.CONTROL_PLANE_DATA_DIR ||
    path.join(__dirname, '..', '..', 'data')
  );
}

/** 电影「看过」列表每页条数（豆瓣 grid） */
const COLLECT_PAGE_STEP = 15;
/** 翻页间隔，降低被封风险 */
const PAGE_DELAY_MS = 800;
/** 全量同步时的安全上限（约 3000 部电影） */
const MAX_COLLECT_START = 15 * 2000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let stopRequested = false;

function sessionPath() {
  const root = dataRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(root, 'douban-session.json');
}

function readSessionFile() {
  try {
    const raw = fs.readFileSync(sessionPath(), 'utf8');
    const p = JSON.parse(raw);
    return {
      cookieHeader: typeof p.cookieHeader === 'string' ? p.cookieHeader : '',
      userId: typeof p.userId === 'string' ? p.userId.trim() : '',
      interestsRssUrl: typeof p.interestsRssUrl === 'string' ? p.interestsRssUrl.trim() : '',
    };
  } catch {
    return { cookieHeader: '', userId: '', interestsRssUrl: '' };
  }
}

/**
 * @param {string} urlOrEmpty
 */
function normalizeInterestsFeedBase(urlOrEmpty) {
  if (!urlOrEmpty) return '';
  let u = String(urlOrEmpty).split('#')[0].split('?')[0].trim().replace(/\/$/, '');
  if (!/\/interests$/i.test(u)) {
    if (/\/people\/[^/]+$/i.test(u)) u = `${u}/interests`;
    else u = `${u.replace(/\/$/, '')}/interests`;
  }
  if (!/^https:\/\/www\.douban\.com\/feed\/people\/[^/]+\/interests$/i.test(u)) return '';
  return u;
}

function saveSession(payload) {
  const cookieHeader = typeof payload.cookieHeader === 'string' ? payload.cookieHeader.trim() : '';
  let userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
  let interestsRssUrl = typeof payload.interestsRssUrl === 'string' ? payload.interestsRssUrl.trim() : '';

  if (interestsRssUrl) {
    interestsRssUrl = normalizeInterestsFeedBase(interestsRssUrl);
    if (!interestsRssUrl) {
      throw new Error('收藏 RSS 须形如 https://www.douban.com/feed/people/账号或ID/interests');
    }
    const m = interestsRssUrl.match(/\/people\/([^/]+)\/interests$/i);
    if (m && !userId) userId = m[1];
  }

  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('请填写豆瓣用户 ID（电影「看过」页 people/ 与 /collect 之间的那一段）。');
  }

  fs.writeFileSync(
    sessionPath(),
    JSON.stringify({ cookieHeader, userId, interestsRssUrl: interestsRssUrl || '' }, null, 0),
    'utf8',
  );
  return { cookieHeader, userId, interestsRssUrl: interestsRssUrl || '' };
}

function getSession() {
  return readSessionFile();
}

function requestStop() {
  stopRequested = true;
}

/**
 * @param {string} url
 * @param {Record<string, string>} extraHeaders
 */
function httpsGetText(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Accept-Encoding': 'identity',
          Referer: 'https://movie.douban.com/',
          ...extraHeaders,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          resolve(httpsGetText(next, extraHeaders));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
            reject(new Error(`豆瓣 HTTP ${res.statusCode}\n请求：${url}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(60_000, () => {
      req.destroy();
      reject(new Error('豆瓣请求超时'));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} html
 * @returns {{ subjectId: string, title: string, stars: number }[]}
 */
function parseCollectMovieGrid(html) {
  const rows = [];
  const chunks = html.split('<div class="item comment-item"');
  for (let i = 1; i < chunks.length; i += 1) {
    const block = chunks[i];
    const sidM = block.match(/movie\.douban\.com\/subject\/(\d+)\//i);
    if (!sidM) continue;
    const subjectId = sidM[1];
    const em = block.match(/<em>([\s\S]*?)<\/em>/i);
    if (!em) continue;
    const title = em[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) continue;
    const rm = block.match(/<span class="rating(\d+)-t"><\/span>/i);
    if (!rm) continue;
    const stars = Number.parseInt(rm[1], 10);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) continue;
    rows.push({ subjectId, title, stars });
  }
  return rows;
}

function collectListUrl(userId, start) {
  const q = new URLSearchParams({
    start: String(start),
    mode: 'grid',
    type: 'movie',
    sort: 'time',
    filter: 'all',
    tags_sort: 'count',
  });
  return `https://movie.douban.com/people/${encodeURIComponent(userId)}/collect?${q.toString()}`;
}

/**
 * @param {{ send?: (p: unknown) => void } | null} progressSink
 * @param {{ incremental?: boolean, existingEntries?: { subjectId: string, title: string, stars: number }[] }} [opts]
 */
async function fetchRatings(progressSink, opts = {}) {
  stopRequested = false;
  const session = readSessionFile();
  const userId = session.userId;
  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('无法抓取：请先在设置中保存有效的豆瓣用户 ID。');
  }

  const incremental = opts.incremental !== false;
  const existing = Array.isArray(opts.existingEntries) ? opts.existingEntries : [];

  const headers = {};
  if (session.cookieHeader) headers.Cookie = session.cookieHeader;

  /** @type {Map<string, { subjectId: string, title: string, stars: number }>} */
  const allBySubject = new Map();
  for (const e of existing) {
    if (!e || typeof e.subjectId !== 'string') continue;
    const sid = e.subjectId.trim();
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    const stars = typeof e.stars === 'number' ? e.stars : Number(e.stars);
    if (!sid || !title || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
    allBySubject.set(sid, { subjectId: sid, title, stars });
  }

  const initialCached = new Set(allBySubject.keys());

  let start = 0;
  let pageIndex = 0;

  const send = (payload) => {
    if (!progressSink || typeof progressSink.send !== 'function') return;
    try {
      progressSink.send(payload);
    } catch {
      /* ignore */
    }
  };

  while (!stopRequested && start <= MAX_COLLECT_START) {
    const url = collectListUrl(userId, start);
    let html;
    try {
      html = await httpsGetText(url, headers);
    } catch (e) {
      if (pageIndex === 0) throw e;
      break;
    }

    const pageItems = parseCollectMovieGrid(html);
    if (pageItems.length === 0) break;

    let pageAllWereCached = true;
    for (const item of pageItems) {
      if (!initialCached.has(item.subjectId)) pageAllWereCached = false;
      allBySubject.set(item.subjectId, item);
    }

    const allEntries = Array.from(allBySubject.values());
    send({
      pageIndex,
      start,
      pageSize: pageItems.length,
      allEntries,
      done: false,
      cancelled: false,
    });

    if (incremental && pageAllWereCached) break;
    /** 不足 15 条也可能是中间页（豆瓣会跳过已失效条目），不能当作末页 */

    start += COLLECT_PAGE_STEP;
    pageIndex += 1;
    await sleep(PAGE_DELAY_MS);
  }

  const allEntries = Array.from(allBySubject.values());
  send({
    pageIndex,
    start,
    pageSize: 0,
    allEntries,
    done: true,
    cancelled: stopRequested,
  });
  return { entries: allEntries, cancelled: stopRequested };
}

// ── Entries cache (for incremental sync) ────────────────────────────────────

function entriesCachePath() {
  return path.join(dataRoot(), 'douban-entries-cache.json');
}

function loadCachedEntries() {
  try {
    const raw = fs.readFileSync(entriesCachePath(), 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch { /* not found or corrupt */ }
  return [];
}

function saveCachedEntries(entries) {
  if (!Array.isArray(entries)) return;
  fs.writeFileSync(entriesCachePath(), JSON.stringify(entries), 'utf8');
}

module.exports = {
  saveSession,
  getSession,
  requestStop,
  fetchRatings,
  loadCachedEntries,
  saveCachedEntries,
  getHealth,
};

async function getHealth(config) {
  const subLibs = (config && config.subLibraries) || [];
  const doubanEnabledCount = subLibs.filter((sl) => sl.doubanEnabled).length;

  if (doubanEnabledCount === 0) {
    return { status: 'green', hasSession: false, doubanEnabledSubLibCount: 0 };
  }

  const session = getSession();
  const hasSession = !!(session && session.cookieHeader && session.userId);

  if (!hasSession) {
    return { status: 'red', hasSession: false, doubanEnabledSubLibCount: doubanEnabledCount };
  }

  // Verify actual connectivity to douban
  try {
    await new Promise((resolve, reject) => {
      const req = https.get('https://movie.douban.com', { timeout: 5000 }, (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        res.resume(); // drain response body
        resolve(ok);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    return { status: 'green', hasSession: true, doubanEnabledSubLibCount: doubanEnabledCount };
  } catch {
    return { status: 'red', hasSession: true, doubanEnabledSubLibCount: doubanEnabledCount, message: '豆瓣不可达（DNS/网络问题）' };
  }
}
