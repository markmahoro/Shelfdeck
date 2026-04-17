const https = require('https');

const REC = { 很差: 1, 较差: 2, 还行: 3, 推荐: 4, 力荐: 5 };

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
            Accept: 'application/rss+xml, text/xml, */*',
            Referer: 'https://www.douban.com/',
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => {
            d += c;
          });
          res.on('end', () => resolve(d));
        },
      )
      .on('error', reject);
  });
}

function extractTag(block, tag) {
  const c = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'));
  if (c) return c[1].trim();
  const p = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return p ? p[1].trim() : '';
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

(async () => {
  const base = 'https://www.douban.com/feed/people/markmahoro/interests';
  const out = [];
  const seenG = new Set();
  let start = 0;
  let stagnant = 0;

  while (out.length < 50 && start <= 500) {
    const xml = await get(`${base}?start=${start}`);
    const blocks = parseItems(xml);
    if (!blocks.length) break;

    let addedThisPage = 0;
    for (const b of blocks) {
      const guid = (b.match(/<guid[^>]*>([^<]+)<\/guid>/i) || [])[1]?.trim() || '';
      if (guid && seenG.has(guid)) continue;
      if (guid) seenG.add(guid);

      const title = extractTag(b, 'title');
      const link = extractTag(b, 'link').replace(/\/$/, '');
      const desc = extractTag(b, 'description');

      if (!/^看过/.test(title)) continue;
      if (!/^https?:\/\/movie\.douban\.com\/subject\/\d+\/?$/i.test(link)) continue;

      const rm = desc.match(/推荐:\s*([^<]+?)\s*<\/p>/i);
      if (!rm) continue;
      const word = rm[1].trim();
      const stars = REC[word];
      if (!stars) continue;

      const name = title.replace(/^看过/, '').trim();
      out.push({ name, stars });
      addedThisPage += 1;
      if (out.length >= 50) break;
    }

    if (addedThisPage === 0) stagnant += 1;
    else stagnant = 0;
    if (stagnant >= 3) break;

    start += 10;
  }

  out.slice(0, 50).forEach((r, i) => {
    process.stdout.write(`${i + 1}. ${r.name} — ${r.stars}星\n`);
  });
  process.stderr.write(`\n(parsed看过+电影+有评分: ${out.length} 条, RSS start尝试到 ${start})\n`);
})().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
