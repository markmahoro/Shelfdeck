/**
 * 离线统计：与 electron/doubanService.js 相同的 collect URL + parseCollectMovieGrid 逻辑，
 * 拉取全部分页并输出条数、诊断信息。不参与应用进程。
 *
 * 用法: DOUBAN_USER=你的ID node scripts/count-douban-collect-full.js
 * 可选: DOUBAN_COOKIE='...' （整段 Cookie，与 App 里一致）
 */
const https = require('https');

const USER = process.env.DOUBAN_USER || 'markmahoro';
const COOKIE = (process.env.DOUBAN_COOKIE || '').trim();
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS || 800);
const MAX_START = 15 * 2500;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': UA,
      Accept: 'text/html,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://movie.douban.com/',
    };
    if (COOKIE) headers.Cookie = COOKIE;

    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        resolve(httpsGetText(next));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(90_000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

/** 每条 item 块：是否有星标（任意 rating*-t） */
function diagnoseBlocks(html) {
  const chunks = html.split('<div class="item comment-item"');
  let withMovieSubject = 0;
  let withEm = 0;
  let withRatingT = 0;
  let withOtherRating = 0;
  for (let i = 1; i < chunks.length; i += 1) {
    const block = chunks[i];
    if (!/movie\.douban\.com\/subject\/\d+\//i.test(block)) continue;
    withMovieSubject += 1;
    if (!/<em>[\s\S]*?<\/em>/i.test(block)) continue;
    withEm += 1;
    if (/<span class="rating\d+-t"><\/span>/i.test(block)) withRatingT += 1;
    else if (/rating|allstar/i.test(block)) withOtherRating += 1;
  }
  return { withMovieSubject, withEm, withRatingT, withOtherRating, itemChunks: chunks.length - 1 };
}

function extractTitleCount(html) {
  const m = html.match(/<title>\s*[\s\S]*?看过的影视\((\d+)\)/);
  if (m) return { label: '看过的影视', n: Number(m[1], 10) };
  const m2 = html.match(/看过的影视\((\d+)\)/);
  if (m2) return { label: '看过的影视', n: Number(m2[1], 10) };
  return null;
}

(async () => {
  const byId = new Map();
  let start = 0;
  let page = 0;
  let lastFirstId = '';
  let stagnant = 0;
  let titleCount = null;
  const diagAccum = { droppedNoRating: 0, pages: 0 };

  while (start <= MAX_START) {
    const url = collectListUrl(USER, start);
    const html = await httpsGetText(url);
    if (page === 0) {
      titleCount = extractTitleCount(html);
    }
    const d = diagnoseBlocks(html);
    const items = parseCollectMovieGrid(html);
    diagAccum.pages += 1;

    if (items.length === 0 && d.itemChunks === 0) {
      process.stdout.write(`\n[start=${start}] 无 grid 条目，结束。\n`);
      break;
    }

    const dropped = d.withRatingT - items.length;
    if (dropped > 0) diagAccum.droppedNoRating += dropped;

    const firstId = items[0]?.subjectId || '';
    if (firstId && firstId === lastFirstId) {
      stagnant += 1;
      if (stagnant >= 2) {
        process.stderr.write(`\n警告: start=${start} 与上一页首条 subject重复，分页可能失效，停止。\n`);
        break;
      }
    } else {
      stagnant = 0;
      lastFirstId = firstId;
    }

    for (const it of items) {
      byId.set(it.subjectId, it);
    }

    process.stdout.write(
      `\r页 ${page + 1} start=${start} 本页解析 ${items.length} / item块电影链 ${d.withMovieSubject} 有星标块 ${d.withRatingT} 累计唯一 ${byId.size} `,
    );

    /** 单页少于 15 条仍可能是中间页，仅当解析 0 条时结束 */

    start += 15;
    page += 1;
    await sleep(PAGE_DELAY_MS);
  }

  process.stdout.write('\n\n');
  process.stdout.write(`用户: ${USER}${COOKIE ? '（已带 Cookie）' : '（无 Cookie）'}\n`);
  if (titleCount) process.stdout.write(`HTML 标题声明: ${titleCount.label} (${titleCount.n})\n`);
  process.stdout.write(`分页请求次数: ${diagAccum.pages}\n`);
  process.stdout.write(`解析得到唯一 subject 数（含星标）: ${byId.size}\n`);
  process.stdout.write(
    '说明: 与 App 一致，仅统计含 <span class="ratingN-t"> 的条目；未打星或结构不同的「看过」不会计入。\n',
  );
})().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
