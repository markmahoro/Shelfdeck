'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('../contracts/canonical-json');
const { fetchJson, fetchBytes } = require('./h1-provider-adapters');

const STASH_QUERY = 'query ShelfDeckPeopleImages($term: String!) { searchPerformers(term: $term, limit: 10) { performers { id name aliases images { id url width height } } } }';
const COMMONS_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const IMAGE_LIMIT = 10 * 1024 * 1024;

function fail(code, message, details) { throw Object.assign(new Error(message), { code, details }); }
function imageUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('PEOPLE_IMAGE_SOURCE_INVALID', '图片来源返回了无效地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 4096) {
    fail('PEOPLE_IMAGE_SOURCE_INVALID', '图片来源必须使用 HTTPS 地址。');
  }
  return url.href;
}
function bounded(value, max = 512) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function dimensions(image) { return Number.isSafeInteger(image.width) && image.width > 0 && Number.isSafeInteger(image.height) && image.height > 0; }
function init() { return { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ShelfDeck/1.0 (People reference image selection)', accept: 'application/json' } }; }

function createPeopleImageSearch(options) {
  if (typeof options?.fetchImpl !== 'function' || typeof options.readNetworkRoute !== 'function' ||
      typeof options.withStashBoxCredential !== 'function' || typeof options.readStashBoxConfiguration !== 'function' ||
      !Buffer.isBuffer(options.tokenKey) || options.tokenKey.length < 32) throw new TypeError('People image search requires configured Platform transports and a dedicated signing key.');
  const now = options.now || Date.now;
  const sign = payload => createHmac('sha256', options.tokenKey).update(payload).digest('base64url');

  function selection(candidate) {
    const payload = Buffer.from(canonicalJson({ schema: 'people.image-selection@1', ...candidate,
      networkRouteDigest: canonicalDigest(options.readNetworkRoute()), expiresAtMs: now() + 10 * 60000 })).toString('base64url');
    if (payload.length > 6000) fail('PEOPLE_IMAGE_SOURCE_INVALID', '来源图片资料超过选择凭证的大小限制。');
    const selectionToken = payload + '.' + sign(payload);
    return Object.freeze({ source: candidate.source, sourceObjectId: candidate.sourceObjectId, canonicalName: candidate.canonicalName,
      aliases: candidate.aliases, sourcePageUrl: candidate.sourcePageUrl, attribution: candidate.attribution,
      width: candidate.width, height: candidate.height, selectionToken });
  }

  async function stashBox(name) {
    const configuration = options.readStashBoxConfiguration();
    if (!configuration) return { source: 'stashbox', state: 'unconfigured', items: [] };
    const result = await options.withStashBoxCredential(configuration.configRevision, async credential => {
      const request = init(); request.method = 'POST';
      request.headers = { ...request.headers, 'Content-Type': 'application/json', ApiKey: credential.toString('utf8') };
      request.body = JSON.stringify({ query: STASH_QUERY, variables: { term: name } });
      return fetchJson(options.fetchImpl, configuration.endpoint, request, 512 * 1024);
    });
    if (result.errors?.length || !Array.isArray(result.data?.searchPerformers?.performers) || result.data.searchPerformers.performers.length > 10) {
      fail('PEOPLE_IMAGE_SOURCE_INVALID', 'StashBox 未返回有效的人物图片结果。');
    }
    const current = options.readStashBoxConfiguration();
    if (!current || current.configRevision !== configuration.configRevision) fail('PEOPLE_IMAGE_SOURCE_CHANGED', 'StashBox 配置已变化，请重新搜索。');
    const items = [];
    for (const person of result.data.searchPerformers.performers) {
      if (!bounded(person.id, 256) || !bounded(person.name) || !Array.isArray(person.aliases) || person.aliases.length > 128 ||
          person.aliases.some(alias => !bounded(alias)) || !Array.isArray(person.images) || person.images.length > 128) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'StashBox 人物资料格式无效。');
      for (const image of person.images.slice(0, 5)) {
        if (!bounded(image.id, 256) || !dimensions(image)) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'StashBox 图片资料格式无效。');
        items.push(selection({ source: 'stashbox', sourceObjectId: person.id + ':' + image.id, canonicalName: person.name,
          aliases: person.aliases, configRevision: configuration.configRevision, imageUrl: imageUrl(image.url),
          sourcePageUrl: configuration.endpoint.replace(/\/graphql\/?$/, '') + '/performers/' + encodeURIComponent(person.id),
          attribution: 'StashBox · ' + new URL(configuration.endpoint).hostname, width: image.width, height: image.height }));
      }
    }
    return { source: 'stashbox', state: items.length ? 'available' : 'empty', items };
  }

  async function commons(name) {
    const url = new URL(COMMONS_ENDPOINT);
    for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', generator: 'search',
      gsrsearch: name, gsrnamespace: '6', gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1200' })) url.searchParams.set(key, value);
    const result = await fetchJson(options.fetchImpl, url.href, init(), 512 * 1024);
    if (result.error || result.query && !Array.isArray(result.query.pages)) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'Wikimedia 未返回有效的图片结果。');
    const pages = result.query?.pages || [];
    if (pages.length > 10) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'Wikimedia 图片结果超过数量限制。');
    const items = [];
    for (const page of pages) {
      const image = page.imageinfo?.[0];
      if (!image || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mime)) continue;
      if (!Number.isSafeInteger(page.pageid) || !dimensions(image) || !bounded(page.title)) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'Wikimedia 图片资料格式无效。');
      const url = imageUrl(image.thumburl || image.url);
      if (new URL(url).hostname !== 'upload.wikimedia.org') fail('PEOPLE_IMAGE_SOURCE_INVALID', 'Wikimedia 图片地址不属于声明来源。');
      const license = image.extmetadata?.LicenseShortName?.value;
      items.push(selection({ source: 'wikimedia', sourceObjectId: String(page.pageid), canonicalName: name, aliases: [], configRevision: 1,
        imageUrl: url, sourcePageUrl: imageUrl(image.descriptionurl), attribution: 'Wikimedia Commons' + (bounded(license, 128) ? ' · ' + license : ''),
        width: image.thumbwidth || image.width, height: image.thumbheight || image.height }));
    }
    return { source: 'wikimedia', state: items.length ? 'available' : 'empty', items };
  }

  async function search(name) {
    if (!bounded(name, 200) || !name.trim()) fail('PEOPLE_IMAGE_SEARCH_INPUT_INVALID', '请输入演员姓名。');
    const outcomes = await Promise.allSettled([stashBox(name.trim()), commons(name.trim())]);
    return Object.freeze({ sources: Object.freeze(outcomes.map((outcome, index) => outcome.status === 'fulfilled' ? outcome.value :
      { source: index === 0 ? 'stashbox' : 'wikimedia', state: 'failed', items: [], error: {
        code: ['PEOPLE_IMAGE_SOURCE_INVALID', 'PEOPLE_IMAGE_SOURCE_CHANGED'].includes(outcome.reason?.code) ? outcome.reason.code : 'PEOPLE_IMAGE_SOURCE_UNAVAILABLE',
        message: index === 0 ? 'StashBox 搜索失败，请检查连接配置后重试。' : 'Wikimedia 搜索失败，请稍后重试。' } })) });
  }

  function verifySelection(token) {
    if (typeof token !== 'string' || token.length > 32768) fail('PEOPLE_IMAGE_SELECTION_INVALID', '请选择搜索结果中的图片。');
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) ||
        !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(sign(parts[0])))) fail('PEOPLE_IMAGE_SELECTION_INVALID', '图片选择凭证无效。');
    let value;
    try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { fail('PEOPLE_IMAGE_SELECTION_INVALID', '图片选择凭证无效。'); }
    if (value.schema !== 'people.image-selection@1' || !['stashbox', 'wikimedia'].includes(value.source) ||
        !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= now() || value.networkRouteDigest !== canonicalDigest(options.readNetworkRoute()) ||
        value.source === 'stashbox' && options.readStashBoxConfiguration()?.configRevision !== value.configRevision) {
      fail('PEOPLE_IMAGE_SELECTION_STALE', '图片选择已过期或来源配置已变化，请重新搜索。');
    }
    return value;
  }

  async function readSelectedImage(token) {
    const selected = verifySelection(token);
    const request = init(); request.headers.accept = 'image/jpeg,image/png,image/webp';
    const result = await fetchBytes(options.fetchImpl, imageUrl(selected.imageUrl), request, IMAGE_LIMIT);
    verifySelection(token);
    const mediaType = result.contentType.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) fail('PEOPLE_IMAGE_SOURCE_INVALID', '来源没有返回可用图片。');
    return Object.freeze({ bytes: result.bytes, mediaType, provenance: Object.freeze({ source: selected.source,
      sourceObjectId: selected.sourceObjectId, sourcePageUrl: selected.sourcePageUrl, attribution: selected.attribution,
      selectedAtMs: now(), configRevision: selected.configRevision }) });
  }

  return Object.freeze({ search, readSelectedImage });
}

module.exports = Object.freeze({ createPeopleImageSearch, STASH_QUERY });
