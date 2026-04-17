const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

const PAGE_DELAY_MS = 1200;
const EXPECT_PAGE_SIZE = 15;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let stopRequested = false;

function sessionPath() {
  return path.join(app.getPath('userData'), 'douban-session.json');
}

function readSessionFile() {
  try {
    const raw = fs.readFileSync(sessionPath(), 'utf8');
    const p = JSON.parse(raw);
    return {
      cookieHeader: typeof p.cookieHeader === 'string' ? p.cookieHeader : '',
      userId: typeof p.userId === 'string' ? p.userId.trim() : '',
    };
  } catch {
    return { cookieHeader: '', userId: '' };
  }
}

function saveSession(payload) {
  const cookieHeader = typeof payload.cookieHeader === 'string' ? payload.cookieHeader.trim() : '';
  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
  /** 与豆瓣电影「看过」页 URL 一致：movie.douban.com/people/{id}/collect ，id 多为纯数字，亦可为账号路径段 */
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('豆瓣用户 ID 无效：请填写电影主页 movie.douban.com/people/ 与 /collect 之间的一段（多为纯数字）。');
  }
  fs.writeFileSync(sessionPath(), JSON.stringify({ cookieHeader, userId }, null, 0), 'utf8');
  return { cookieHeader, userId };
}

function getSession() {
  return readSessionFile();
}

function requestStop() {
  stopRequested = true;
}

function httpsGetText(url, headers) {
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
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          resolve(httpsGetText(next, headers));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
            const hint =
              res.statusCode === 404
                ? '（若为404：请确认用户 ID 与浏览器打开的「看过」页一致，路径应为 …/people/你的ID/collect）'
                : '';
            reject(new Error(`豆瓣 HTTP ${res.statusCode} ${hint}\n请求：${url}`));
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

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function hasCJK(s) {
  return /[\u3400-\u9FFF\u3007]/.test(String(s || ''));
}

function scoreTitleCandidate(t) {
  const s = String(t || '').trim();
  if (!s) return -1;
  let score = Math.min(s.length, 400);
  if (hasCJK(s)) score += 3000;
  return score;
}

/**
 * 同一 subject 在「看过」列表里常有多个 <a>（海报、标题行等），只取第一个常会落到纯英文或空（海报链里只有 <img>）。
 * 合并本块内该 id 下所有链接文本 + 所有 img alt，去重后把含中文的片段排在前面，便于阅读和与 Emby 中文片名对齐。
 */
function extractTitleForSubjectChunk(chunk, subjectId) {
  const esc = subjectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(
    `<a[^>]+href=["']https?:\\/\\/movie\\.douban\\.com\\/subject\\/${esc}\\/["'][^>]*>([\\s\\S]*?)<\\/a>`,
    'gi',
  );
  let bestLink = '';
  let bestScore = -1;
  let m;
  while ((m = linkRe.exec(chunk)) !== null) {
    const t = stripTags(m[1]).trim();
    const sc = scoreTitleCandidate(t);
    if (sc > bestScore) {
      bestScore = sc;
      bestLink = t;
    }
  }

  const alts = [];
  const altRe = /<img[^>]+alt=["']([^"']{1,400})["']/gi;
  while ((m = altRe.exec(chunk)) !== null) {
    const a = m[1].trim();
    if (a && !/^https?:\/\//i.test(a) && !/^data:/i.test(a)) alts.push(a);
  }

  const seenSeg = new Set();
  const ordered = [];
  const addPart = (raw) => {
    for (const seg of String(raw)
      .split(/\s*\/\s*/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (!seenSeg.has(seg)) {
        seenSeg.add(seg);
        ordered.push(seg);
      }
    }
  };
  for (const a of alts) addPart(a);
  if (bestLink) addPart(bestLink);

  ordered.sort((a, b) => {
    if (hasCJK(b) !== hasCJK(a)) return hasCJK(b) ? 1 : -1;
    return b.length - a.length;
  });

  return ordered.length > 0 ? ordered.join(' / ') : bestLink || alts[0] || '';
}

function parseStarsFromChunk(chunk) {
  const r1 = chunk.match(/rating(\d)-t/);
  if (r1) {
    const n = Number(r1[1]);
    if (n >= 1 && n <= 5) return n;
  }
  const r2 = chunk.match(/allstar(\d{2})/);
  if (r2) {
    const v = Number(r2[1]) / 10;
    if (v >= 1 && v <= 5) return Math.round(v);
 }
  return null;
}

function parseRatingsPage(html) {
  const norm = html.replace(/\/\/movie\.douban\.com/g, 'https://movie.douban.com');
  const entries = [];
  const seen = new Set();
  let pos = 0;
  while (pos < norm.length) {
    const idx = norm.indexOf('movie.douban.com/subject/', pos);
    if (idx === -1) break;
    const m = norm.slice(idx).match(/^movie\.douban\.com\/subject\/(\d+)/);
    if (!m) {
      pos = idx + 20;
      continue;
    }
    const subjectId = m[1];
    const nextIdx = norm.indexOf('movie.douban.com/subject/', idx + 30);
    let chunk = nextIdx === -1 ? norm.slice(idx) : norm.slice(idx, nextIdx);
    /** list 布局下星级偶发在条目链接之前，向前扩一段再解析 */
    if (parseStarsFromChunk(chunk) == null) {
      const back = Math.max(0, idx - 900);
      chunk = nextIdx === -1 ? norm.slice(back) : norm.slice(back, nextIdx);
    }

    const title = extractTitleForSubjectChunk(chunk, subjectId);
    const stars = parseStarsFromChunk(chunk);
    if (title && stars != null && !seen.has(subjectId)) {
      seen.add(subjectId);
      entries.push({ title, stars, subjectId });
    }
    pos = nextIdx === -1 ? norm.length : nextIdx;
  }
  return entries;
}

/**
 * @param {import('electron').WebContents} webContents
 */
async function fetchRatings(webContents) {
  stopRequested = false;
  const { cookieHeader, userId } = readSessionFile();
  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('请先在配置中心保存有效的豆瓣用户 ID（movie.douban.com/people/ 与 /collect 之间的一段）。');
  }
  if (!cookieHeader) {
    throw new Error('请先在配置中心保存豆瓣 Cookie。');
  }

  const allBySubject = new Map();
  let start = 0;
  let pageIndex = 0;

  const send = (payload) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('douban:fetchProgress', payload);
    }
  };

  while (!stopRequested) {
    /** 豆瓣已弃用 /ratings（404）；「看过」列表为 /collect */
    const url = `https://movie.douban.com/people/${encodeURIComponent(userId)}/collect?start=${start}&sort=time`;
    const body = await httpsGetText(url, { Cookie: cookieHeader });
    if (/sec\.douban\.com|验证码|登录豆瓣/i.test(body) && /accounts\.douban\.com/i.test(body)) {
      throw new Error('豆瓣返回登录/验证页：请检查 Cookie 是否过期或需重新登录后复制。');
    }
    const pageEntries = parseRatingsPage(body);
    for (const e of pageEntries) {
      allBySubject.set(e.subjectId, e);
    }
    const allEntries = Array.from(allBySubject.values());
    send({
      pageIndex,
      start,
      pageSize: pageEntries.length,
      allEntries,
      done: false,
      cancelled: false,
    });

    if (pageEntries.length === 0) break;
    if (pageEntries.length < EXPECT_PAGE_SIZE) break;

    start += EXPECT_PAGE_SIZE;
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

module.exports = {
  saveSession,
  getSession,
  requestStop,
  fetchRatings,
};
