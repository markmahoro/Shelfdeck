'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');

const INTEGRATION_ID = 'network-main';
const CONTRACT = 'platform.network-policy.configure@1';
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function normalizeProxyServer(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 2048) fail('PLATFORM_NETWORK_PROXY_INVALID', 'Proxy must be an HTTP or HTTPS origin.');
  let url;
  try { url = new URL(value.trim()); } catch { fail('PLATFORM_NETWORK_PROXY_INVALID', 'Proxy must be an HTTP or HTTPS origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    fail('PLATFORM_NETWORK_PROXY_INVALID', 'Proxy must be an HTTP or HTTPS origin without credentials or a path.');
  return url.origin;
}

function createNetworkPolicy(options) {
  const { repository, receiptRepository } = options;
  function current() {
    const row = repository.find(INTEGRATION_ID, null)?.integration;
    if (!row) return null;
    if (!Number.isSafeInteger(row.configRevision) || row.configRevision < 1 ||
        Object.keys(row.config).sort().join(',') !== 'configRevision,lastCommand,proxyServer,schemaVersion' ||
        !row.config.lastCommand || !/^[a-f0-9]{64}$/.test(row.config.lastCommand.requestDigest) ||
        row.integrationType !== 'network_policy' || row.state !== 'active' ||
        row.configSchemaRef !== 'helix://platform/network-policy/v1' || row.config.schemaVersion !== 1 ||
        row.config.configRevision !== row.configRevision || canonicalDigest(row.config) !== row.configDigest ||
        normalizeProxyServer(row.config.proxyServer) !== row.config.proxyServer)
      fail('PLATFORM_NETWORK_POLICY_CORRUPT', 'Network policy is invalid.');
    return row;
  }
  function get() {
    const row = current();
    return Object.freeze({ kind: 'network', supported: true, configured: Boolean(row), state: row ? 'active' : 'unconfigured',
      configRevision: row?.configRevision || 0, endpoint: null, configDigest: row?.configDigest || null,
      capabilityCodes: [], lastTestSummary: null, landingBinding: null, settings: { proxyServer: row?.config.proxyServer || '' } });
  }
  function route() {
    const proxyServer = get().settings.proxyServer;
    return Object.freeze({ mode: proxyServer ? 'http_proxy' : 'direct', proxyEndpoint: proxyServer || null });
  }
  function configure(kind, body) {
    if (kind !== 'network' || !body || Object.keys(body).sort().join(',') !== 'expectedConfigRevision,idempotencyKey,kind,settings' ||
        body.kind !== kind || !Number.isSafeInteger(body.expectedConfigRevision) || body.expectedConfigRevision < 0 ||
        typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(body.idempotencyKey) ||
        !body.settings || Object.keys(body.settings).join(',') !== 'proxyServer')
      fail('PLATFORM_NETWORK_COMMAND_INVALID', 'Network policy command is invalid.');
    const proxyServer = normalizeProxyServer(body.settings.proxyServer), requestDigest = canonicalDigest(body);
    const key = { commandContract: CONTRACT, idempotencyKey: body.idempotencyKey };
    const prior = receiptRepository.read(key);
    if (prior) {
      if (prior.requestDigest !== requestDigest) fail('PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT', 'Network policy key was reused.');
      return prior.result;
    }
    const row = current();
    const last = row?.config.lastCommand;
    if (last?.idempotencyKey === body.idempotencyKey) {
      if (last.requestDigest !== requestDigest) fail('PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT', 'Network policy key was reused.');
    } else {
      if ((row?.configRevision || 0) !== body.expectedConfigRevision)
        fail('PLATFORM_INTEGRATION_CAS_CONFLICT', 'Network policy changed; reload before saving.');
      const revision = body.expectedConfigRevision + 1;
      const config = { schemaVersion: 1, configRevision: revision, proxyServer,
        lastCommand: { idempotencyKey: body.idempotencyKey, requestDigest } };
      repository.commit({ expectedRevision: body.expectedConfigRevision, secret: null,
        integration: { integration_id: INTEGRATION_ID, integration_type: 'network_policy', endpoint: 'system://network',
          config_revision: revision, config_schema_ref: 'helix://platform/network-policy/v1', config_json: canonicalJson(config),
          config_digest: canonicalDigest(config), state: 'active', updated_at_ms: (options.now || Date.now)() } });
    }
    const result = get();
    receiptRepository.commit({ ...key, requestDigest, integrationId: INTEGRATION_ID, commandKind: 'configure', result });
    return result;
  }
  return Object.freeze({ get, route, configure });
}

module.exports = Object.freeze({ createNetworkPolicy, normalizeProxyServer });
