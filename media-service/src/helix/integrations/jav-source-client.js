'use strict';

const { fetch, ProxyAgent } = require('undici');
const sharp = require('sharp');
const crypto = require('node:crypto');
const { canonicalDigest } = require('../contracts/canonical-json');
const { assertJavQueryAnchor, JAV_SITES_BY_CLASS } = require('../contracts/jav-source-contracts');
const { document, javDbCandidates, parseJavSourcePage } = require('./jav-source-pages');
const { JAV_SOURCE_TRANSPORTS: DEFINITIONS, javSourceTransportProfile } = require('../contracts/jav-source-profiles');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function freezeValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeValue(item)])));
  return value;
}

class JavSourceError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'JavSourceError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new JavSourceError(code, message, details); }
function safeUrl(value, allowedHosts) {
  if (typeof value !== 'string' || value.length > 4096) fail('JAV_SOURCE_URL_DENIED', 'JAV source URL exceeds its bound.');
  let url;
  try { url = new URL(value); } catch { fail('JAV_SOURCE_URL_DENIED', 'JAV source URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || !allowedHosts.has(url.hostname)) fail('JAV_SOURCE_URL_DENIED', 'JAV source URL is outside the frozen boundary.');
  return url;
}
function createJavSourceClient(options) {
  if (typeof options?.endpoint !== 'string') fail('JAV_SOURCE_PROFILE_INVALID', 'JAV source endpoint must be text.');
  const definition = DEFINITIONS[options?.siteRef], endpoint = options.endpoint.replace(/\/$/, '');
  if (!definition || !definition.endpoints.includes(endpoint)) fail('JAV_SOURCE_PROFILE_INVALID', 'JAV source endpoint is not supported.');
  const route = options.networkRoute === undefined ? { mode: 'direct', proxyEndpoint: null } : options.networkRoute;
  if (!route || Object.keys(route).sort().join(',') !== 'mode,proxyEndpoint' || !['direct', 'http_proxy'].includes(route.mode) ||
      (route.mode === 'direct' ? route.proxyEndpoint !== null : typeof route.proxyEndpoint !== 'string'))
    fail('JAV_SOURCE_PROFILE_INVALID', 'JAV source network route must be explicit.');
  if (route.mode === 'http_proxy') {
    let proxy;
    try { proxy = new URL(route.proxyEndpoint); } catch { fail('JAV_SOURCE_PROFILE_INVALID', 'JAV proxy endpoint is invalid.'); }
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname !== '/')
      fail('JAV_SOURCE_PROFILE_INVALID', 'JAV proxy credentials require a separate Secret binding.');
  }
  const siteRef = options.siteRef, requestFetch = options.fetchImpl || fetch;
  const pageHosts = new Set([new URL(endpoint).hostname]), assetHosts = new Set(definition.assets);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) fail('JAV_SOURCE_PROFILE_INVALID', 'JAV operation timeout is invalid.');
  const { endpointProfileDigest, networkRouteDigest } = javSourceTransportProfile(siteRef, endpoint, route);

  function pagePath(code) {
    if (siteRef === 'fc2_official') return '/article/' + code.slice(4) + '/';
    if (siteRef === 'heydouga_official') { const [, publisher, item] = code.split('-'); return '/moviepages/' + publisher + '/' + item + '/index.html'; }
    if (siteRef === 'caribbeancom_official') return '/moviepages/' + code + '/index.html';
    if (siteRef === 'avwiki') return '/' + code.toLowerCase() + '/';
    if (siteRef === 'dl_getchu' || siteRef === 'gyutto') return '/i/item' + code.split('-')[1];
    return '/' + code;
  }

  async function observe(value, keepCoverBytes = false) {
    const anchor = assertJavQueryAnchor(value?.queryAnchor);
    if (anchor.queryKind !== 'jav_code' || !JAV_SITES_BY_CLASS[anchor.codeClass].includes(siteRef))
      fail('JAV_SOURCE_QUERY_DENIED', 'JAV source cannot consume this query kind or number class.');
    if (Object.keys(value).some(key => !['queryAnchor', 'resourceKey', 'signal'].includes(key))) fail('JAV_SOURCE_QUERY_DENIED', 'JAV source input contains unsupported fields.');
    if (value.resourceKey !== undefined && (siteRef === 'javdb'
      ? !/^[A-Za-z0-9]{1,32}$/.test(value.resourceKey)
      : value.resourceKey !== anchor.javCode))
      fail('JAV_SOURCE_QUERY_DENIED', 'JAV source exact resource key is invalid.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort();
    value.signal?.addEventListener('abort', cancel, { once: true });
    if (value.signal?.aborted) controller.abort();
    const dispatcher = route.mode === 'http_proxy' ? new ProxyAgent(route.proxyEndpoint) : undefined;
    const pages = [];
    let stage = 'page';
    try {
      async function read(initialUrl, isImage = false) {
        const limit = isImage ? 16 * 1024 * 1024 : 2 * 1024 * 1024, hosts = isImage ? assetHosts : pageHosts;
        let target = safeUrl(initialUrl, hosts), response;
        for (let hop = 0; hop <= 4; hop++) {
          response = await requestFetch(target.toString(), { dispatcher, signal: controller.signal, redirect: 'manual', headers: {
            'user-agent': 'Mozilla/5.0', accept: isImage ? 'image/jpeg,image/png,image/webp' : 'text/html',
            ...(isImage ? { referer: endpoint } : {}),
          } });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location'); await response.body?.cancel();
          if (!location || hop === 4) fail('JAV_SOURCE_REDIRECT_DENIED', 'JAV source redirect exceeds its boundary.');
          target = safeUrl(new URL(location, target).toString(), hosts);
        }
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel(); fail('JAV_SOURCE_UNAVAILABLE', 'JAV source is temporarily unavailable.', { retryable: true, siteRef, status: response.status });
        }
        if (response.status === 404) { await response.body?.cancel(); return { absent: true, url: target.toString() }; }
        if (!response.ok) {
          await response.body?.cancel(); fail('JAV_SOURCE_ACCESS_DENIED', 'JAV source rejected the request.', { status: response.status, siteRef });
        }
        const contentType = response.headers.get('content-type') || '';
        if (isImage ? !/^image\/(jpeg|png|webp)(?:;|$)/i.test(contentType) : !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
          await response.body?.cancel(); fail('JAV_SOURCE_RESPONSE_INVALID', 'JAV source response media type is invalid.');
        }
        const advertised = Number(response.headers.get('content-length'));
        if (advertised > limit) { await response.body?.cancel(); fail('JAV_SOURCE_RESPONSE_TOO_LARGE', 'JAV source response exceeds its byte limit.'); }
        let length = 0; const pieces = [];
        for await (const piece of response.body) {
          length += piece.length;
          if (length > limit) { controller.abort(); fail('JAV_SOURCE_RESPONSE_TOO_LARGE', 'JAV source response exceeds its byte limit.'); }
          pieces.push(piece);
        }
        const bytes = Buffer.concat(pieces);
        return { bytes, url: target.toString(), contentType, digest: sha(bytes) };
      }
      function outcome(result, fields = {}) {
        const payload = { schema: 'integration.jav-source-observation@1', siteRef, endpointProfileDigest, networkRouteDigest,
          queryAnchorDigest: anchor.anchorDigest, result, pages: [...pages], ...fields };
        return freezeValue({ ...payload, observationDigest: canonicalDigest(payload) });
      }
      const code = anchor.javCode;
      let target = endpoint + pagePath(code), resourceKey = value.resourceKey;
      if (siteRef === 'javdb') {
        if (!resourceKey) {
          const url = new URL('/search', endpoint); url.searchParams.set('q', code); url.searchParams.set('f', 'all');
          const search = await read(url.toString());
          if (search.absent) return outcome('not_found');
          const parsed = document(search.bytes, search.contentType, definition.charset);
          pages.push({ resourceUrl: search.url, byteDigest: search.digest });
          if (/^\s*(Just a moment|Attention Required)/i.test(parsed.$('title').text())) return outcome('challenge_required');
          const found = javDbCandidates(parsed.$, code);
          if (found.result !== 'matched') return outcome(found.result, { candidates: found.resources.map(key => ({ siteRef, resourceKey: key, javCode: code })) });
          resourceKey = found.resources[0];
        }
        target = endpoint + '/v/' + resourceKey;
      }
      const response = await read(target);
      if (response.absent) return outcome('not_found');
      pages.push({ resourceUrl: response.url, byteDigest: response.digest });
      const page = document(response.bytes, response.contentType, definition.charset);
      if (/\/(?:users\/sign_in|login)(?:\/|$)/.test(new URL(response.url).pathname)) return outcome('login_required');
      if (/^\s*(Just a moment|Attention Required)/i.test(page.$('title').text())) return outcome('challenge_required');
      const record = parseJavSourcePage(siteRef, code, page, endpoint);
      if (siteRef === 'javdb' && (record.canonicalResourceUrl !== endpoint + '/v/' + resourceKey ||
          new URL(response.url).pathname !== '/v/' + resourceKey)) return outcome('identity_mismatch');
      if (!record.identityVerified) return outcome(record.observedCode ? 'identity_mismatch' : 'not_found');
      if (!record.title) return outcome('title_missing');
      if (!record.coverUrl) return outcome('cover_missing');
      stage = 'cover';
      const image = await read(record.coverUrl, true);
      if (image.absent) return outcome('cover_missing');
      let metadata;
      try {
        const decoder = sharp(image.bytes, { limitInputPixels: 32 * 1024 * 1024, failOn: 'warning' });
        metadata = await decoder.metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1)
          return outcome('cover_undecodable');
        const width = metadata.orientation >= 5 ? metadata.height : metadata.width;
        const height = metadata.orientation >= 5 ? metadata.width : metadata.height;
        if ((height * 50 < width * 71 ? Math.floor(height * 50 / 71) : Math.floor(width * 71 / 50)) < 1)
          return outcome('cover_undecodable');
        await decoder.raw().toBuffer();
      } catch { return outcome('cover_undecodable'); }
      if (controller.signal.aborted) fail('JAV_SOURCE_TIMEOUT', 'JAV source observation exceeded its deadline.', { retryable: true, siteRef });
      const identity = { provider: 'jav', namespace: 'jav_code', providerKey: code, seasonNumber: null };
      const identityAnchor = Object.freeze({ ...identity, identityAnchorDigest: canonicalDigest(identity) });
      const qualified = outcome('qualified', { resourceKey: resourceKey || code, resourceUrl: response.url, resolvedProviderIdentity: identityAnchor,
        descriptiveEntries: record.descriptiveEntries, peopleHints: record.peopleHints,
        cover: { locator: image.url, byteDigest: image.digest, byteCount: image.bytes.length,
          format: metadata.format, width: metadata.width, height: metadata.height } });
      return keepCoverBytes ? { observation: qualified, coverBytes: image.bytes } : qualified;
    } catch (error) {
      if (error instanceof JavSourceError) { error.details = { ...error.details, stage }; throw error; }
      if (error.code === 'JAV_SOURCE_CHARSET_INVALID') fail(error.code, 'JAV source response charset is invalid.', { retryable: false, siteRef });
      fail(controller.signal.aborted ? 'JAV_SOURCE_TIMEOUT' : 'JAV_SOURCE_UNAVAILABLE', 'JAV source observation did not complete.', { retryable: true, siteRef, stage });
    } finally {
      clearTimeout(timer); value.signal?.removeEventListener('abort', cancel); await dispatcher?.close();
    }
  }
  async function acquireCover(value) {
    const expected = value?.qualifiedObservation, kind = value?.artifactKind;
    if (!expected || expected.result !== 'qualified' || expected.siteRef !== siteRef ||
        expected.endpointProfileDigest !== endpointProfileDigest || expected.networkRouteDigest !== networkRouteDigest ||
        expected.observationDigest !== canonicalDigest(Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'observationDigest'))) ||
        !['poster', 'fanart'].includes(kind)) fail('JAV_SOURCE_ARTIFACT_FENCE_DENIED', 'JAV artifact must reference an exact qualified source.');
    const anchor = assertJavQueryAnchor(value.queryAnchor);
    if (expected.queryAnchorDigest !== anchor.anchorDigest) fail('JAV_SOURCE_ARTIFACT_FENCE_DENIED', 'JAV artifact query differs from its qualified source.');
    const fresh = await observe({ queryAnchor: anchor, ...(siteRef === 'javdb' ? { resourceKey: expected.resourceKey } : {}) }, true);
    if (!fresh.coverBytes || fresh.observation.resourceUrl !== expected.resourceUrl ||
        fresh.observation.cover.byteDigest !== expected.cover.byteDigest ||
        fresh.observation.descriptiveEntries.find(entry => entry.key === 'title')?.value !== expected.descriptiveEntries.find(entry => entry.key === 'title')?.value)
      fail('JAV_SOURCE_ARTIFACT_CHANGED', 'JAV source qualification changed before artifact acquisition.');
    return {coverBytes:fresh.coverBytes,observation:fresh.observation};
  }
  async function prepareArtifact(value) {
    const fresh=await acquireCover(value),expected=value.qualifiedObservation,kind=value.artifactKind;
    const normalized = await sharp(fresh.coverBytes, { limitInputPixels: 32 * 1024 * 1024 }).rotate().toBuffer();
    const dimensions = await sharp(normalized).metadata();
    const width = dimensions.width, height = dimensions.height;
    const cropWidth = height * 50 < width * 71 ? Math.floor(height * 50 / 71) : width;
    const cropHeight = height * 50 < width * 71 ? height : Math.floor(width * 71 / 50);
    const rectangle = { left: width - cropWidth, top: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
    if (cropWidth < 1 || cropHeight < 1) fail('JAV_SOURCE_ARTIFACT_INVALID', 'JAV cover cannot produce the required crop.');
    const pipeline = sharp(normalized);
    if (kind === 'poster') pipeline.extract(rectangle);
    const bytes = await pipeline.jpeg().toBuffer();
    const derivationEvidence = { sourceObservationDigest: expected.observationDigest, sourceByteDigest: expected.cover.byteDigest,
      kind, normalizedWidth: width, normalizedHeight: height, crop: kind === 'poster' ? rectangle : null,
      renderer: 'sharp', rendererVersion: sharp.versions.sharp, outputDigest: sha(bytes) };
    return { resultKind: 'prepared_artifact_bytes', bytes, contentType: 'image/jpeg', byteDigest: sha(bytes), derivationEvidence,
      derivationDigest: canonicalDigest(derivationEvidence) };
  }
  return Object.freeze({ siteRef, endpoint, endpointProfileDigest, networkRouteDigest,
    observe: value => observe(value), observeWithCover:value=>observe(value,true), acquireCover, prepareArtifact });
}

module.exports = Object.freeze({ JavSourceError, DEFINITIONS, createJavSourceClient });
