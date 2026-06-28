'use strict';

const { ProxyAgent } = require('undici');

const DEFAULT_TIMEOUT_MS = 12000;
const proxyAgents = new Map();

function cleanText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
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

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...requestOptions(options),
      headers: options.headers || {},
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
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
  return pages.map((page) => {
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
  const query = `
    query ShelfDeckSearchPerformer($term: String!) {
      searchPerformer(term: $term) {
        id
        name
        disambiguation
        images { url width height }
      }
    }
  `;
  const headers = {};
  if (endpoint.apiKey) {
    headers.ApiKey = endpoint.apiKey;
    headers.authorization = `Bearer ${endpoint.apiKey}`;
  }
  const json = await fetchGraphql(endpoint.url, query, { term: name }, { ...options, headers });
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
  const sourceJobs = [
    ['stashbox', () => searchStashBox(q, western, perSource, searchOptions)],
    ['metadataapi', () => searchMetadataApi(q, western, perSource, searchOptions)],
    ['tmdb', () => searchTmdb(q, western, perSource, searchOptions)],
    ['wikimedia', () => searchWikimedia(q, perSource, searchOptions)],
  ];
  const results = await Promise.all(sourceJobs.map(async ([source, run]) => {
    try {
      return await run();
    } catch (e) {
      errors.push({ source, message: e.message });
      return [];
    }
  }));
  const rows = results.flat();
  const candidates = uniqByUrl(rows).slice(0, perSource * 3);
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
      wikimedia: 'enabled',
    },
  };
}

module.exports = { searchActorImages };
