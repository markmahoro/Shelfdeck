'use strict';

const { canonicalDigest } = require('./canonical-json');

const JAV_SOURCE_TRANSPORTS = Object.freeze(Object.fromEntries(Object.entries({
  javdb: { endpoints: ['https://javdb.com'], assets: ['c0.jdbstatic.com'], charset: 'utf-8' },
  javmenu: { endpoints: ['https://javmenu.com', 'https://mrzyx.xyz'], assets: ['c0.jdbstatic.com', '666.9989641.xyz', 'pics.dmm.co.jp'], charset: 'utf-8' },
  fc2_official: { endpoints: ['https://adult.contents.fc2.com'], assets: ['contents-thumbnail2.fc2.com'], charset: 'utf-8' },
  heydouga_official: { endpoints: ['https://www.heydouga.com'], assets: ['image01-www.heydouga.com'], charset: 'utf-8' },
  caribbeancom_official: { endpoints: ['https://www.caribbeancom.com'], assets: ['www.caribbeancom.com'], charset: 'euc-jp' },
  avwiki: { endpoints: ['https://av-wiki.net'], assets: ['image.mgstage.com'], charset: 'utf-8' },
  dl_getchu: { endpoints: ['https://dl.getchu.com'], assets: ['dl.getchu.com'], charset: 'euc-jp' },
  gyutto: { endpoints: ['https://gyutto.com'], assets: ['gyutto.com', 'image.gyutto.com'], charset: 'euc-jp' },
}).map(([key, value]) => [key, Object.freeze({ ...value, endpoints: Object.freeze(value.endpoints), assets: Object.freeze(value.assets) })])));

function fail(message) { throw Object.assign(new TypeError(message), { code: 'JAV_SOURCE_PROFILE_INVALID' }); }
function normalizeJavNetworkRoute(value) {
  const route = value === undefined ? { mode: 'direct', proxyEndpoint: null } : value;
  if (!route || Object.getPrototypeOf(route) !== Object.prototype || Object.keys(route).sort().join(',') !== 'mode,proxyEndpoint' ||
      !['direct', 'http_proxy'].includes(route.mode) || (route.mode === 'direct' ? route.proxyEndpoint !== null : typeof route.proxyEndpoint !== 'string'))
    fail('JAV source network route must be explicit.');
  if (route.mode === 'http_proxy') {
    let proxy;
    try { proxy = new URL(route.proxyEndpoint); } catch { fail('JAV proxy endpoint is invalid.'); }
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname !== '/')
      fail('JAV proxy credentials require a separate Secret binding.');
  }
  return Object.freeze({ ...route });
}
function javSourceTransportProfile(siteRef, value, route) {
  if (typeof value !== 'string') fail('JAV source endpoint must be text.');
  const definition = JAV_SOURCE_TRANSPORTS[siteRef], endpoint = value.replace(/\/$/, '');
  if (!definition || !definition.endpoints.includes(endpoint)) fail('JAV source endpoint is not supported.');
  const networkRoute = normalizeJavNetworkRoute(route);
  return Object.freeze({ siteRef, endpoint, networkRoute, networkRouteDigest: canonicalDigest(networkRoute),
    endpointProfileDigest: canonicalDigest({ siteRef, endpoint, assetHosts: definition.assets, charset: definition.charset,
      pageByteLimit: 2 * 1024 * 1024, imageByteLimit: 16 * 1024 * 1024, maxRedirects: 4, maxPixels: 32 * 1024 * 1024 }) });
}
module.exports = Object.freeze({ JAV_SOURCE_TRANSPORTS, normalizeJavNetworkRoute, javSourceTransportProfile });
