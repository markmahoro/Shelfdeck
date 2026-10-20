'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('../contracts/canonical-json');
const { fetchJson, fetchBytes } = require('./h1-provider-adapters');

// TPDB exposes the array-returning field, which remains in the Stash-box schema.
const STASH_QUERY = 'query ShelfDeckPeopleImages($term: String!) { searchPerformer(term: $term, limit: 10) { id name aliases images { id url width height } } }';
const TPDB_ENDPOINT = 'https://api.theporndb.net/graphql';
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
    if (configuration.endpoint !== TPDB_ENDPOINT) fail('PEOPLE_IMAGE_SOURCE_CHANGED', '请重新配置 ThePornDB。');
    const result = await options.withStashBoxCredential(configuration.configRevision, async credential => {
      const request = init(); request.method = 'POST';
      request.headers = { ...request.headers, 'Content-Type': 'application/json', ApiKey: credential.toString('utf8') };
      request.body = JSON.stringify({ query: STASH_QUERY, variables: { term: name } });
      return fetchJson(options.fetchImpl, configuration.endpoint, request, 512 * 1024);
    });
    if (result.errors?.length || !Array.isArray(result.data?.searchPerformer) || result.data.searchPerformer.length > 10) {
      fail('PEOPLE_IMAGE_SOURCE_INVALID', 'ThePornDB 未返回有效的人物图片结果。');
    }
    const current = options.readStashBoxConfiguration();
    if (!current || current.configRevision !== configuration.configRevision) fail('PEOPLE_IMAGE_SOURCE_CHANGED', 'ThePornDB 配置已变化，请重新搜索。');
    const items = [];
    for (const person of result.data.searchPerformer) {
      if (!bounded(person.id, 256) || !bounded(person.name) || !Array.isArray(person.aliases) || person.aliases.length > 128 ||
          person.aliases.some(alias => !bounded(alias)) || !Array.isArray(person.images) || person.images.length > 128) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'ThePornDB 人物资料格式无效。');
      for (const image of person.images.slice(0, 5)) {
        if (!bounded(image.id, 256) || !dimensions(image)) fail('PEOPLE_IMAGE_SOURCE_INVALID', 'ThePornDB 图片资料格式无效。');
        items.push(selection({ source: 'stashbox', sourceObjectId: person.id + ':' + image.id, canonicalName: person.name,
          aliases: person.aliases, configRevision: configuration.configRevision, imageUrl: imageUrl(image.url),
          sourcePageUrl: configuration.endpoint.replace(/\/graphql\/?$/, '') + '/performers/' + encodeURIComponent(person.id),
          attribution: 'ThePornDB', width: image.width, height: image.height }));
      }
    }
    return { source: 'stashbox', state: items.length ? 'available' : 'empty', items };
  }

  async function search(name) {
    if (!bounded(name, 200) || !name.trim()) fail('PEOPLE_IMAGE_SEARCH_INPUT_INVALID', '请输入演员姓名。');
    let source;
    try { source = await stashBox(name.trim()); }
    catch (cause) { source = { source: 'stashbox', state: 'failed', items: [], error: {
      code: ['PEOPLE_IMAGE_SOURCE_INVALID', 'PEOPLE_IMAGE_SOURCE_CHANGED'].includes(cause?.code) ? cause.code : 'PEOPLE_IMAGE_SOURCE_UNAVAILABLE',
      message: 'ThePornDB 搜索失败，请检查连接配置后重试。' } }; }
    return Object.freeze({ sources: Object.freeze([source]) });
  }

  function verifySelection(token) {
    if (typeof token !== 'string' || token.length > 32768) fail('PEOPLE_IMAGE_SELECTION_INVALID', '请选择搜索结果中的图片。');
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) ||
        !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(sign(parts[0])))) fail('PEOPLE_IMAGE_SELECTION_INVALID', '图片选择凭证无效。');
    let value;
    try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { fail('PEOPLE_IMAGE_SELECTION_INVALID', '图片选择凭证无效。'); }
    if (value.schema !== 'people.image-selection@1' || value.source !== 'stashbox' ||
        !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= now() || value.networkRouteDigest !== canonicalDigest(options.readNetworkRoute()) ||
        options.readStashBoxConfiguration()?.configRevision !== value.configRevision ||
        options.readStashBoxConfiguration()?.endpoint !== TPDB_ENDPOINT) {
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
