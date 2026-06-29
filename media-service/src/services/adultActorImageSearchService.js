'use strict';

const { ProxyAgent } = require('undici');

const DEFAULT_TIMEOUT_MS = 12000;
const proxyAgents = new Map();

function cleanText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nameTokens(value) {
  return normalizeForMatch(value).split(/\s+/).filter((x) => x.length > 1);
}

function candidateMatchesName(title, query) {
  const tokens = nameTokens(query);
  if (!tokens.length) return false;
  const haystackTokens = new Set(nameTokens(title));
  return tokens.every((token) => haystackTokens.has(token));
}

function queryVariants(name) {
  const cleaned = cleanText(name);
  const variants = [
    cleaned,
    cleaned.replace(/\([^)]*\)/g, ' '),
    cleaned.replace(/\[[^\]]*\]/g, ' '),
    cleaned.replace(/["'`´’‘]/g, ''),
    cleaned.replace(/[._-]+/g, ' '),
  ].map(cleanText).filter(Boolean);
  const seen = new Set();
  return variants.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function uniqByUrl(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const url = String(row && row.imageUrl || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(row);
  }
  return out;
}

async function searchVariants(name, run, limit) {
  const rows = [];
  for (const variant of queryVariants(name)) {
    const found = await run(variant);
    for (const row of found || []) rows.push({ ...row, matchedQuery: variant });
    if (uniqByUrl(rows).length >= limit) break;
  }
  return rows;
}

function sourceRank(source) {
  const s = String(source || '').toLowerCase();
  if (s.startsWith('stashbox:')) return 0;
  if (s === 'metadataapi') return 1;
  if (s === 'tmdb') return 2;
  if (s === 'wikidata') return 3;
  if (s === 'wikipedia') return 4;
  if (s === 'wikimedia') return 5;
  return 9;
}

function imageQualityScore(row) {
  const width = Number(row && row.width) || 0;
  const height = Number(row && row.height) || 0;
  if (!width || !height) return 10;
  const area = width * height;
  const portraitBias = height >= width ? 0 : 8;
  const sizePenalty = area >= 600 * 600 ? 0 : area >= 300 * 300 ? 5 : 15;
  return portraitBias + sizePenalty;
}

function candidateRank(row, query) {
  const q = normalizeForMatch(query);
  const title = normalizeForMatch(row.title);
  const exact = title && q && title === q;
  const contains = title && q && (title.includes(q) || q.includes(title));
  return {
    score: (exact ? 0 : 100) + (contains ? 0 : 20) + sourceRank(row.source) + imageQualityScore(row),
    exact,
    contains,
  };
}

function qualityReasons(row, query, rank) {
  const reasons = [];
  const source = String(row.source || '');
  if (source.startsWith('stashbox:')) reasons.push('adult_source');
  else if (source === 'metadataapi' || source === 'tmdb') reasons.push('metadata_source');
  else reasons.push('public_fallback');
  if (rank.exact) reasons.push('name_exact');
  else if (rank.contains) reasons.push('name_contains');
  if (row.sourceId) reasons.push('source_id');
  if (Number(row.width) && Number(row.height)) {
    reasons.push(Number(row.height) >= Number(row.width) ? 'portrait_image' : 'landscape_image');
  }
  return reasons;
}

function rankCandidates(rows, query) {
  return rows.map((row, index) => {
    const rank = candidateRank(row, query);
    return { row, index, rank };
  }).sort((a, b) => a.rank.score - b.rank.score || a.index - b.index).map((x) => ({
    ...x.row,
    rankScore: x.rank.score,
    qualityReasons: qualityReasons(x.row, query, x.rank),
  }));
}

function hasStrongAdultMatch(candidates, query) {
  const q = normalizeForMatch(query);
  return candidates.some((row) => {
    const source = String(row.source || '').toLowerCase();
    if (!(source.startsWith('stashbox:') || source === 'metadataapi' || source === 'tmdb')) return false;
    return normalizeForMatch(row.title) === q && row.imageUrl;
  });
}

async function runSourceJobs(sourceJobs, errors) {
  const results = await Promise.all(sourceJobs.map(async ([source, run]) => {
    try {
      return await run();
    } catch (e) {
      errors.push({ source, message: e.message });
      return [];
    }
  }));
  return results.flat();
}

function proxyAgentFor(proxyServer) {
  const value = String(proxyServer || '').trim();
  if (!value) return undefined;
  if (!proxyAgents.has(value)) proxyAgents.set(value, new ProxyAgent(value));
  return proxyAgents.get(value);
}

function requestOptions(options = {}) {
  const dispatcher = proxyAgentFor(options.proxyServer);
  return dispatcher ? { dispatcher } : {};
}

function commonsFileUrl(fileName, width = 600) {
  const clean = String(fileName || '').replace(/ /g, '_');
  return clean ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(clean)}?width=${width}` : '';
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...requestOptions(options),
        headers: {
          'user-agent': 'ShelfDeck/1.0 (local actor image search)',
          'api-user-agent': 'ShelfDeck/1.0',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429 && attempt === 0) {
        const retryAfter = Math.min(3000, Math.max(1000, Number(res.headers && res.headers.get && res.headers.get('retry-after')) * 1000 || 1000));
        await new Promise((resolve) => setTimeout(resolve, retryAfter));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('fetch failed');
}

async function fetchGraphql(url, query, variables, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...requestOptions(options),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Array.isArray(json.errors) && json.errors.length) {
      throw new Error(json.errors[0].message || 'GraphQL error');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikimedia(name, limit, options = {}) {
  const q = encodeURIComponent(`${name} portrait`);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${q}&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=600&format=json&origin=*`;
  const json = await fetchJson(url, options);
  const pages = json && json.query && json.query.pages ? Object.values(json.query.pages) : [];
  return pages.filter((page) => candidateMatchesName(page.title || '', name)).map((page) => {
    const info = page.imageinfo && page.imageinfo[0] || {};
    const meta = info.extmetadata || {};
    return {
      source: 'wikimedia',
      sourceId: String(page.pageid || ''),
      title: cleanText(page.title || name).replace(/^File:/i, ''),
      pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`,
      imageUrl: info.thumburl || info.url || '',
      originalUrl: info.url || info.thumburl || '',
      width: Number(info.width) || 0,
      height: Number(info.height) || 0,
      license: cleanText(meta.LicenseShortName && meta.LicenseShortName.value || ''),
    };
  }).filter((x) => x.imageUrl);
}

async function searchWikipedia(name, limit, options = {}) {
  const qs = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: name,
    gsrlimit: String(limit),
    prop: 'pageimages|info',
    piprop: 'thumbnail|original',
    pithumbsize: '600',
    inprop: 'url',
    format: 'json',
    origin: '*',
  });
  const json = await fetchJson(`https://en.wikipedia.org/w/api.php?${qs.toString()}`, options);
  const pages = json && json.query && json.query.pages ? Object.values(json.query.pages) : [];
  return pages.filter((page) => candidateMatchesName(page.title || '', name)).map((page) => {
    const thumb = page.thumbnail || {};
    const original = page.original || {};
    return {
      source: 'wikipedia',
      sourceId: String(page.pageid || ''),
      title: cleanText(page.title || name),
      pageUrl: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title || '').replace(/ /g, '_'))}`,
      imageUrl: thumb.source || original.source || '',
      originalUrl: original.source || thumb.source || '',
      width: Number(thumb.width || original.width) || 0,
      height: Number(thumb.height || original.height) || 0,
      license: '',
    };
  }).filter((x) => x.imageUrl);
}

async function searchWikidata(name, limit, options = {}) {
  const searchQs = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    limit: String(limit),
    format: 'json',
    origin: '*',
  });
  const search = await fetchJson(`https://www.wikidata.org/w/api.php?${searchQs.toString()}`, options);
  const ids = (Array.isArray(search.search) ? search.search : [])
    .filter((row) => candidateMatchesName(row.label || '', name))
    .map((row) => row.id)
    .filter(Boolean)
    .slice(0, limit);
  if (!ids.length) return [];
  const entityQs = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'claims|labels|sitelinks',
    languages: 'en',
    format: 'json',
    origin: '*',
  });
  const entityJson = await fetchJson(`https://www.wikidata.org/w/api.php?${entityQs.toString()}`, options);
  const entities = entityJson && entityJson.entities ? Object.values(entityJson.entities) : [];
  return entities.map((entity) => {
    const label = cleanText(entity.labels && entity.labels.en && entity.labels.en.value || name);
    const imageClaim = entity.claims && Array.isArray(entity.claims.P18) && entity.claims.P18[0];
    const fileName = imageClaim && imageClaim.mainsnak && imageClaim.mainsnak.datavalue && imageClaim.mainsnak.datavalue.value;
    const title = entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
    const imageUrl = commonsFileUrl(fileName, 600);
    return {
      source: 'wikidata',
      sourceId: String(entity.id || ''),
      title: label,
      pageUrl: title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}` : `https://www.wikidata.org/wiki/${entity.id}`,
      imageUrl,
      originalUrl: commonsFileUrl(fileName, 1600),
      width: 0,
      height: 0,
      license: '',
    };
  }).filter((x) => x.imageUrl);
}

async function searchPublicKnowledgeImages(name, limit, options = {}) {
  const rows = [];
  const minimumUseful = Math.min(3, Math.max(1, limit));
  const sources = [
    ['wikidata', () => searchWikidata(name, limit, options)],
    ['wikipedia', () => searchWikipedia(name, limit, options)],
    ['wikimedia', () => searchWikimedia(name, limit, options)],
  ];
  for (const [source, run] of sources) {
    try {
      rows.push(...await run());
      if (uniqByUrl(rows).length >= minimumUseful) break;
    } catch (e) {
      if (Array.isArray(options.errors)) {
        options.errors.push({ source, message: e.message });
      }
    }
  }
  return rows;
}

async function searchTmdb(name, cfg, limit, options = {}) {
  const key = String(cfg.tmdbApiKey || cfg.tmdbReadAccessToken || '').trim();
  if (!key) return [];
  const headers = {};
  const qs = new URLSearchParams({ query: name, include_adult: 'true', language: 'en-US', page: '1' });
  if (key.startsWith('eyJ')) {
    headers.authorization = `Bearer ${key}`;
  } else {
    qs.set('api_key', key);
  }
  const json = await fetchJson(`https://api.themoviedb.org/3/search/person?${qs.toString()}`, { ...options, headers });
  const people = Array.isArray(json.results) ? json.results.slice(0, limit) : [];
  return people.map((p) => ({
    source: 'tmdb',
    sourceId: String(p.id || ''),
    title: cleanText(p.name || name),
    pageUrl: p.id ? `https://www.themoviedb.org/person/${p.id}` : '',
    imageUrl: p.profile_path ? `https://image.tmdb.org/t/p/w500${p.profile_path}` : '',
    originalUrl: p.profile_path ? `https://image.tmdb.org/t/p/original${p.profile_path}` : '',
    width: 0,
    height: 0,
    license: '',
  })).filter((x) => x.imageUrl);
}

function normalizeTpdbRows(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.performers)) return json.performers;
  if (json.data && Array.isArray(json.data.performers)) return json.data.performers;
  if (json.data && json.data.findPerformers && Array.isArray(json.data.findPerformers.performers)) {
    return json.data.findPerformers.performers;
  }
  return [];
}

async function searchMetadataApi(name, cfg, limit, options = {}) {
  const base = String(cfg.metadataApiBaseUrl || 'https://api.metadataapi.net').replace(/\/+$/, '');
  const key = String(cfg.metadataApiKey || cfg.tpdbApiKey || '').trim();
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  const url = `${base}/performers?q=${encodeURIComponent(name)}`;
  const json = await fetchJson(url, { ...options, headers });
  return normalizeTpdbRows(json).slice(0, limit).map((p) => {
    const image = p.image || p.image_url || p.imageUrl || p.image_path || p.avatar || p.thumbnail || '';
    return {
      source: 'metadataapi',
      sourceId: String(p.id || p.uuid || p.slug || ''),
      title: cleanText(p.name || p.title || name),
      pageUrl: p.url || p.site || '',
      imageUrl: image,
      originalUrl: image,
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
      license: '',
    };
  }).filter((x) => x.imageUrl);
}

function parseStashBoxEndpoints(cfg) {
  const list = Array.isArray(cfg.stashBoxGraphqlEndpoints) ? cfg.stashBoxGraphqlEndpoints : [];
  const normalized = list.map((row) => ({
    name: cleanText(row.name || row.label || 'stashbox') || 'stashbox',
    url: String(row.url || row.apiUrl || row.graphqlUrl || '').trim(),
    apiKey: String(row.apiKey || row.key || '').trim(),
  })).filter((row) => row.url);
  const singleUrl = String(cfg.stashBoxGraphqlUrl || cfg.tpdbGraphqlUrl || '').trim();
  if (singleUrl) {
    normalized.unshift({
      name: cleanText(cfg.stashBoxGraphqlName || 'tpdb') || 'tpdb',
      url: singleUrl,
      apiKey: String(cfg.stashBoxApiKey || cfg.tpdbApiKey || '').trim(),
    });
  }
  if (!normalized.length) {
    normalized.push({
      name: 'tpdb',
      url: 'https://api.theporndb.net/graphql',
      apiKey: String(cfg.stashBoxApiKey || cfg.tpdbApiKey || '').trim(),
    });
  }
  return normalized;
}

function stashBoxImageForPerformer(p) {
  if (!p || typeof p !== 'object') return '';
  const direct = p.image || p.image_url || p.imageUrl || p.avatar || p.thumbnail || p.profileImage || '';
  if (direct) return direct;
  const images = Array.isArray(p.images) ? p.images : [];
  const first = images.find((img) => img && (img.url || img.imageUrl || img.path));
  return first ? (first.url || first.imageUrl || first.path || '') : '';
}

function normalizeStashBoxPerformers(json) {
  const data = json && json.data || {};
  if (Array.isArray(data.searchPerformer)) return data.searchPerformer;
  if (Array.isArray(data.searchPerformers)) return data.searchPerformers;
  if (data.findPerformers && Array.isArray(data.findPerformers.performers)) return data.findPerformers.performers;
  if (data.performers && Array.isArray(data.performers.performers)) return data.performers.performers;
  if (Array.isArray(data.performers)) return data.performers;
  return [];
}

async function searchStashBoxEndpoint(endpoint, name, limit, options = {}) {
  const searchQuery = `
    query ShelfDeckSearchPerformer($term: String!) {
      searchPerformer(term: $term) {
        id
        name
        disambiguation
        images { url width height }
      }
    }
  `;
  const findQuery = `
    query ShelfDeckFindPerformers($term: String!, $limit: Int!) {
      findPerformers(
        performer_filter: { name: { value: $term, modifier: INCLUDES } }
        filter: { per_page: $limit }
      ) {
        performers {
          id
          name
          disambiguation
          image
          images { url width height }
        }
      }
    }
  `;
  const headers = {};
  if (endpoint.apiKey) {
    headers.ApiKey = endpoint.apiKey;
    headers.authorization = `Bearer ${endpoint.apiKey}`;
  }
  let json;
  try {
    json = await fetchGraphql(endpoint.url, searchQuery, { term: name }, { ...options, headers });
  } catch (e) {
    json = await fetchGraphql(endpoint.url, findQuery, { term: name, limit }, { ...options, headers });
  }
  return normalizeStashBoxPerformers(json).slice(0, limit).map((p) => {
    const image = stashBoxImageForPerformer(p);
    const firstImage = Array.isArray(p.images) ? p.images.find((img) => img && (img.url || img.imageUrl || img.path)) : null;
    return {
      source: `stashbox:${endpoint.name}`,
      sourceId: String(p.id || p.uuid || p.slug || ''),
      title: cleanText(p.name || p.title || name),
      pageUrl: p.url || p.site || '',
      imageUrl: image,
      originalUrl: image,
      width: Number(firstImage && firstImage.width) || Number(p.width) || 0,
      height: Number(firstImage && firstImage.height) || Number(p.height) || 0,
      license: '',
    };
  }).filter((x) => x.imageUrl);
}

async function searchStashBox(name, cfg, limit, options = {}) {
  const endpoints = parseStashBoxEndpoints(cfg);
  const rows = await Promise.all(endpoints.map(async (endpoint) => {
    try {
      return await searchStashBoxEndpoint(endpoint, name, limit, options);
    } catch (e) {
      if (Array.isArray(options.errors)) {
        options.errors.push({ source: `stashbox:${endpoint.name}`, message: e.message });
      }
      return [];
    }
  }));
  return rows.flat();
}

function actorImageProxyServer(config, western) {
  const adultLibrary = (config && config.adultLibrary) || {};
  const jav = adultLibrary.japaneseJav || {};
  return String(western.actorImageProxyServer || jav.proxyServer || '').trim();
}

function noCandidatesMessage(errors, proxyUsed) {
  if (errors.length) {
    const sources = errors.slice(0, 3).map((x) => `${x.source}: ${x.message}`).join('; ');
    return `未找到候选头像。${proxyUsed ? '已使用代理。' : '未配置代理。'}搜索源失败：${sources}`;
  }
  return `未找到候选头像。${proxyUsed ? '已使用代理，但搜索源没有返回图片。' : '未配置代理，且搜索源没有返回图片。'}可以换关键词或粘贴手动图片 URL。`;
}

async function searchActorImages({ name, config, limit = 8 }) {
  const q = cleanText(name);
  if (!q) throw new Error('name is required');
  const western = (config.adultLibrary && config.adultLibrary.western) || {};
  const perSource = Math.max(3, Math.min(Number(limit) || 8, 20));
  const errors = [];
  const proxyServer = actorImageProxyServer(config, western);
  const searchOptions = { proxyServer, errors };
  const stashBoxJobs = [
    ['stashbox', () => searchVariants(q, (variant) => searchStashBox(variant, western, perSource, searchOptions), perSource)],
  ];
  const adultFallbackJobs = [
    ['metadataapi', () => searchVariants(q, (variant) => searchMetadataApi(variant, western, perSource, searchOptions), perSource)],
    ['tmdb', () => searchVariants(q, (variant) => searchTmdb(variant, western, perSource, searchOptions), perSource)],
  ];
  const publicFallbackJobs = [
    ['public', () => searchVariants(q, (variant) => searchPublicKnowledgeImages(variant, perSource, searchOptions), perSource)],
  ];

  let rows = await runSourceJobs(stashBoxJobs, errors);
  let publicFallback = 'skipped';
  let adultFallback = 'skipped';
  let candidates = rankCandidates(uniqByUrl(rows), q);

  if (!hasStrongAdultMatch(candidates, q)) {
    adultFallback = 'searched';
    rows = rows.concat(await runSourceJobs(adultFallbackJobs, errors));
    candidates = rankCandidates(uniqByUrl(rows), q);
  }

  if (!hasStrongAdultMatch(candidates, q) && candidates.length < perSource) {
    publicFallback = 'searched';
    rows = rows.concat(await runSourceJobs(publicFallbackJobs, errors));
    candidates = rankCandidates(uniqByUrl(rows), q);
  }

  candidates = rankCandidates(uniqByUrl(rows), q).slice(0, perSource * 3);
  return {
    query: q,
    candidates,
    errors,
    proxyUsed: !!proxyServer,
    message: candidates.length ? '' : noCandidatesMessage(errors, !!proxyServer),
    sources: {
      stashbox: parseStashBoxEndpoints(western).map((x) => ({ name: x.name, url: x.url, configured: !!x.apiKey })),
      metadataapi: 'optional adult performer metadata source',
      tmdb: western.tmdbApiKey || western.tmdbReadAccessToken ? 'enabled' : 'not_configured',
      wikidata: 'enabled',
      wikipedia: 'enabled',
      wikimedia: 'enabled',
    },
    diagnostics: {
      adultFallback,
      publicFallback,
    },
  };
}

module.exports = { searchActorImages };
