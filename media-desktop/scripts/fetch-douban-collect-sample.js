const https = require('https');

const USER = process.env.DOUBAN_USER || 'markmahoro';
const TARGET = Math.min(500, Number(process.env.LIMIT || 50));

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
            Accept: 'text/html,*/*',
            Referer: 'https://movie.douban.com/',
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

function parseCollectPage(html) {
  const rows = [];
  const chunks = html.split('<div class="item comment-item"');
  for (let i = 1; i < chunks.length; i += 1) {
    const block = chunks[i];
    const em = block.match(/<em>([\s\S]*?)<\/em>/i);
    if (!em) continue;
    const rawTitle = em[1].replace(/<[^>]+>/g, '').trim();
    const name = rawTitle.split(/\s*\/\s*/)[0].trim();
    const rm = block.match(/<span class="rating(\d+)-t"><\/span>/i);
    if (!rm) continue;
    rows.push({ name, stars: Number.parseInt(rm[1], 10) });
  }
  return rows;
}

(async () => {
  const base = `https://movie.douban.com/people/${USER}/collect`;
  const out = [];
  const seen = new Set();

  for (let start = 0; out.length < TARGET; start += 15) {
    const url = `${base}?start=${start}&mode=grid&type=movie&sort=time&filter=all&tags_sort=count`;
    const html = await get(url);
    const page = parseCollectPage(html);
    if (!page.length) break;
    for (const r of page) {
      const k = `${r.name}\t${r.stars}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= TARGET) break;
    }
    if (page.length < 15) break;
  }

  out.slice(0, TARGET).forEach((r, i) => {
    process.stdout.write(`${i + 1}. ${r.name} — ${r.stars}星\n`);
  });
  process.stdout.write(
    `\n# 来源: movie.douban.com/people/${USER}/collect (type=movie 网格), 本页共 ${Math.min(out.length, TARGET)} 条\n`,
  );
})().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
