'use strict';

const { isIP } = require('node:net');
const { fetch, Agent, ProxyAgent } = require('undici');

// All product Integrations share this transport. Provider-local dispatchers
// cannot override the Platform network policy. Loopback and private LAN
// services stay local; no provider-specific override is exposed.
function isLocalDestination(value) {
  const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!isIP(host)) return host === 'localhost' || host.endsWith('.localhost');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    /^(?:fc|fd)[0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}
function createNetworkFetch({ networkPolicy, fetchImpl = fetch, createProxy = value => new ProxyAgent(value), createDirect = () => new Agent() }) {
  let proxy = null, proxyEndpoint = null;
  const direct = createDirect();
  const retired = [];
  function request(url, init = {}) {
    const route = networkPolicy.route();
    let dispatcher = direct;
    if (route.mode === 'http_proxy' && !isLocalDestination(url)) {
      if (proxyEndpoint !== route.proxyEndpoint) {
        if (proxy) retired.push(proxy.close().catch(() => {}));
        proxy = createProxy(route.proxyEndpoint); proxyEndpoint = route.proxyEndpoint;
      }
      dispatcher = proxy;
    }
    return fetchImpl(url, { ...init, dispatcher });
  }
  request.close = async () => { await Promise.all([direct.close(), ...(proxy ? [proxy.close()] : []), ...retired]); };
  return request;
}

module.exports = Object.freeze({ createNetworkFetch, isLocalDestination });
