'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');
const { JAV_SOURCE_TRANSPORTS: DEFINITIONS, normalizeJavNetworkRoute, javSourceTransportProfile } = require('../../contracts/jav-source-profiles');
const { buildProductIntegrationHandle } = require('../model/product-integration-handle');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function exact(value, fields, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || fields.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !fields.includes(key) && !optional.includes(key)))
    fail('PLATFORM_INTEGRATION_INPUT_INVALID', 'Anonymous JAV integration input has unsupported fields.');
}
function settings(value) {
  const result = value === undefined ? { networkRoute: { mode: 'direct', proxyEndpoint: null } } : value;
  exact(result, ['networkRoute']);
  return Object.freeze({ networkRoute: normalizeJavNetworkRoute(result.networkRoute) });
}
function validateAnonymousJavConfig(snapshot, profile) {
  const row = snapshot?.integration, config = row?.config;
  if (!row) return undefined;
  exact(config, ['schemaRef', 'schemaVersion', 'kind', 'endpoint', 'configRevision', 'secretRef', 'credentialKind',
    'capabilityCodes', 'lastTestSummary', 'lastCommand', 'settings']);
  const endpoint = profile.normalizeEndpoint(row.endpoint);
  if (snapshot.secret || row.integrationId !== profile.integrationId || row.integrationType !== 'jav_source' ||
      row.configSchemaRef !== profile.configSchemaRef || config.schemaRef !== profile.configSchemaRef || config.schemaVersion !== 1 ||
      config.kind !== profile.kind || config.endpoint !== endpoint || config.configRevision !== row.configRevision ||
      config.secretRef !== null || config.credentialKind !== 'anonymous' || row.configDigest !== canonicalDigest(config) ||
      !Number.isSafeInteger(row.configRevision) || row.configRevision < 1 || !['active', 'disabled'].includes(row.state) ||
      canonicalJson(config.capabilityCodes) !== canonicalJson(profile.capabilityCodes))
    fail('PLATFORM_INTEGRATION_CONFIG_CORRUPT', 'Anonymous JAV configuration identity or revision is invalid.');
  profile.normalizeSettings(config.settings);
  const summary = config.lastTestSummary;
  exact(summary, ['result', 'checkedAtMs', 'endpointDigest', 'observationDigest', 'identityNamespace', 'identityProviderKey']);
  if (summary?.result !== 'passed' || summary.endpointDigest !== canonicalDigest({ endpoint }) ||
      !/^[a-f0-9]{64}$/.test(summary.observationDigest || '') || summary.identityNamespace !== 'jav_code' ||
      typeof summary.identityProviderKey !== 'string' || summary.identityProviderKey.length > 256 ||
      !Number.isSafeInteger(summary.checkedAtMs) || summary.checkedAtMs < 0 || !Number.isSafeInteger(row.updatedAtMs) || row.updatedAtMs < 0)
    fail('PLATFORM_INTEGRATION_CONFIG_CORRUPT', 'Anonymous JAV connection proof is invalid.');
  const command = config.lastCommand;
  exact(command, ['commandKind', 'idempotencyKey', 'requestDigest', 'committedRevision']);
  if (!['configure', 'disconnect'].includes(command.commandKind) || command.committedRevision !== row.configRevision ||
      !/^[a-f0-9]{64}$/.test(command.requestDigest || '') || typeof command.idempotencyKey !== 'string' || !command.idempotencyKey)
    fail('PLATFORM_INTEGRATION_CONFIG_CORRUPT', 'Anonymous JAV command continuity is invalid.');
  return Object.freeze({ integration: row, secret: undefined });
}
function createAnonymousJavRuntime(options) {
  const profile = options.profile, now = options.now || Date.now;
  const readCurrent = () => validateAnonymousJavConfig(options.repository.find(profile.integrationId, null), profile);
  function current(input) {
    const row = readCurrent();
    if (!row || row.integration.state !== 'active') fail('PLATFORM_INTEGRATION_UNAVAILABLE', 'JAV source is not active.');
    if (input.integrationId !== profile.integrationId || input.configRevision !== row.integration.configRevision)
      fail('PLATFORM_INTEGRATION_REVISION_MISMATCH', 'JAV source configuration revision changed.');
    return row;
  }
  return Object.freeze({ profile, readCurrent, isActive: () => readCurrent()?.integration.state === 'active', isTmdbActive: () => false,
    integrationQueryPort: { query(input) {
      exact(input, ['integrationId', 'expectedConfigRevision']);
      const row = current({ ...input, configRevision: input.expectedConfigRevision }).integration;
      return { schemaRef: 'helix://contracts/ports/platform.integration.query/v1/output', schemaVersion: 1,
        integrationId: row.integrationId, integrationType: row.integrationType, endpoint: row.endpoint, configRevision: row.configRevision,
        configDigest: row.configDigest, state: row.state, secretRef: null, secretKind: null, secretRevision: null,
        settings: profile.normalizeSettings(row.config.settings) };
    } },
    integrationHandleResolverPort: { resolve(input) {
      exact(input, ['integrationId', 'integrationType', 'configRevision', 'allowedOperation', 'artifactKind']);
      const row = current(input).integration;
      if (input.integrationType !== 'jav_source' || !profile.allowedOperations.includes(input.allowedOperation) ||
          (input.allowedOperation==='arca.aftercare.binary_artifact.acquire@1'?!['poster','fanart'].includes(input.artifactKind):
            ['libra.product_artifact.acquire@1','arca.jav_correction.assets.prepare@1'].includes(input.allowedOperation) ? !['poster', 'fanart'].includes(input.artifactKind) : input.artifactKind !== null))
        fail('PLATFORM_INTEGRATION_HANDLE_DENIED', 'JAV source operation is not allowed.');
      const client = javSourceTransportProfile(profile.siteRef, row.endpoint, options.networkPolicy.route());
      return buildProductIntegrationHandle({ ...input, secretRef: null, siteRef: profile.siteRef, authMode: 'anonymous',
        endpointProfileDigest: client.endpointProfileDigest, networkRouteDigest: client.networkRouteDigest, expiresAtMs: now() + 60_000 });
    } },
    secretLeaseResolverPort: { resolve() { fail('PLATFORM_INTEGRATION_SECRET_DENIED', 'Anonymous JAV source has no Secret lease.'); } },
  });
}

function createAnonymousJavAdmin(options) {
  const profile = options.profile, now = options.now || Date.now, proofs = new Map(), tests = new Map();
  const current = () => validateAnonymousJavConfig(options.repository.find(profile.integrationId, null), profile);
  function publicValue(snapshot) {
    const row = snapshot?.integration;
    return { kind: profile.kind, supported: true, configured: row?.state === 'active', state: row?.state || 'unconfigured',
      configRevision: row?.configRevision || 0, endpoint: row?.endpoint || null, configDigest: row?.configDigest || null,
      capabilityCodes: [...profile.capabilityCodes], lastTestSummary: row?.config.lastTestSummary || null,
      settings: profile.normalizeSettings(row?.config.settings) };
  }
  const contract = commandKind => 'platform.integration.' + profile.kind + '.' + commandKind + '@1';
  function receipt(kind, key, digest, result) {
    return options.receiptRepository.commit({ commandKind: kind, commandContract: contract(kind), idempotencyKey: key,
      integrationId: profile.integrationId, requestDigest: digest, result });
  }
  function replay(kind, key, digest) {
    let old = options.receiptRepository.read({ commandContract: contract(kind), idempotencyKey: key });
    if (!old) {
      const head = current(), command = head?.integration.config.lastCommand;
      if (command) receipt(command.commandKind, command.idempotencyKey, command.requestDigest, publicValue(head));
      old = options.receiptRepository.read({ commandContract: contract(kind), idempotencyKey: key });
    }
    if (!old) return null;
    if (old.requestDigest !== digest) fail('PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT', 'JAV integration idempotency key was reused.');
    return old.result;
  }
  function target(kind, body, fields, optional = []) {
    exact(body, fields, optional);
    if (kind !== profile.kind || body.kind !== kind || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 256)
      fail('PLATFORM_INTEGRATION_TARGET_MISMATCH', 'JAV integration command target is invalid.');
  }
  function commitConfig(commandKind, body, config, state) {
    const prior = current();
    if ((prior?.integration.configRevision || 0) !== body.expectedConfigRevision)
      fail('PLATFORM_INTEGRATION_CAS_CONFLICT', 'JAV integration configuration revision changed.');
    const revision = body.expectedConfigRevision + 1, requestDigest = canonicalDigest({ commandKind, body });
    const value = { ...config, configRevision: revision,
      lastCommand: { commandKind, idempotencyKey: body.idempotencyKey, requestDigest, committedRevision: revision } };
    options.beforePlatformCommit?.({ commandKind, integrationId: profile.integrationId, idempotencyKey: body.idempotencyKey });
    const saved = options.repository.commit({ expectedRevision: body.expectedConfigRevision, secret: null, integration: {
      integration_id: profile.integrationId, integration_type: 'jav_source', endpoint: value.endpoint, config_revision: revision,
      config_schema_ref: profile.configSchemaRef, config_json: canonicalJson(value), config_digest: canonicalDigest(value), state, updated_at_ms: now(),
    } });
    options.afterPlatformCommit?.({ commandKind, integrationId: profile.integrationId, idempotencyKey: body.idempotencyKey });
    const result = publicValue(validateAnonymousJavConfig(saved, profile));
    receipt(commandKind, body.idempotencyKey, requestDigest, result);
    return result;
  }
  return Object.freeze({ profile,
    get(kind) { if (kind !== profile.kind) fail('PLATFORM_INTEGRATION_TARGET_MISMATCH', 'JAV integration target is invalid.'); return publicValue(current()); },
    async test(kind, body) {
      target(kind, body, ['kind', 'idempotencyKey', 'endpoint', 'credential'], ['settings', 'timeoutMs']);
      exact(body.credential, ['kind']);
      if (body.credential.kind !== 'anonymous') fail('PLATFORM_INTEGRATION_CREDENTIAL_INVALID', 'JAV public source requires anonymous authentication.');
      const endpoint = profile.normalizeEndpoint(body.endpoint), sourceSettings = profile.normalizeSettings({ networkRoute: options.networkPolicy.route() }), digest = canonicalDigest(body);
      const timeoutMs = body.timeoutMs ?? 30_000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
        fail('PLATFORM_INTEGRATION_TEST_TIMEOUT_INVALID', 'JAV connection test timeout is invalid.');
      const prior = tests.get(body.idempotencyKey);
      if (prior) { if (prior.digest !== digest) fail('PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT', 'JAV connection test key was reused.'); return prior.result; }
      for (const [key, proof] of proofs) if (proof.expiresAtMs < now()) proofs.delete(key);
      if (proofs.size >= 256 || tests.size >= 256) fail('PLATFORM_INTEGRATION_TEST_LIMIT', 'JAV connection test capacity is exhausted.');
      const summary = await options.adapter.testCandidate({ endpoint, settings: sourceSettings, timeoutMs });
      const connectionProofId = options.createId(), expiresAtMs = now() + 10 * 60_000;
      proofs.set(connectionProofId, { endpoint, settings: sourceSettings, summary, expiresAtMs });
      const result = { kind, result: 'passed', persisted: false, connectionProofId, expiresAtMs, capabilityCodes: [...profile.capabilityCodes], ...summary };
      tests.set(body.idempotencyKey, { digest, result });
      return result;
    },
    configure(kind, body) {
      target(kind, body, ['kind', 'idempotencyKey', 'expectedConfigRevision', 'connectionProofId']);
      const digest = canonicalDigest({ commandKind: 'configure', body }), old = replay('configure', body.idempotencyKey, digest);
      if (old) return old;
      if (!Number.isSafeInteger(body.expectedConfigRevision) || body.expectedConfigRevision < 0)
        fail('PLATFORM_INTEGRATION_CAS_CONFLICT', 'JAV integration expected revision is invalid.');
      const proof = proofs.get(body.connectionProofId);
      if (!proof || proof.expiresAtMs < now() || (canonicalDigest(proof.settings.networkRoute) !== canonicalDigest(options.networkPolicy.route()))) fail('PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID', 'JAV connection proof is missing or expired.');
      return commitConfig('configure', body, { schemaRef: profile.configSchemaRef, schemaVersion: 1, kind, endpoint: proof.endpoint,
        secretRef: null, credentialKind: 'anonymous', capabilityCodes: [...profile.capabilityCodes], lastTestSummary: proof.summary, settings: proof.settings }, 'active');
    },
    disconnect(kind, body) {
      target(kind, body, ['kind', 'idempotencyKey', 'expectedConfigRevision']);
      const digest = canonicalDigest({ commandKind: 'disconnect', body }), old = replay('disconnect', body.idempotencyKey, digest);
      if (old) return old;
      const prior = current();
      if (!prior || !Number.isSafeInteger(body.expectedConfigRevision) || body.expectedConfigRevision < 1)
        fail('PLATFORM_INTEGRATION_CAS_CONFLICT', 'JAV integration is not configured.');
      return commitConfig('disconnect', body, prior.integration.config, 'disabled');
    },
  });
}

const PROBE_CODES = Object.freeze({ javdb: 'IPX-177', javmenu: 'IPX-177', fc2_official: 'FC2-718323',
  heydouga_official: 'HEYDOUGA-4030-2113', caribbeancom_official: '082713-417', avwiki: '259LUXU-1022', dl_getchu: 'GETCHU-4052694', gyutto: 'GYUTTO-242158' });
function javSourceProfileDefinitions() {
  return Object.entries(DEFINITIONS).map(([siteRef, definition]) => ({ kind: 'jav-' + siteRef, integrationType: 'jav_source',
    siteRef, authMode: 'anonymous', probeCode: PROBE_CODES[siteRef], secretRef: null,
    capabilityCodes: Object.freeze(['identity', 'metadata', 'artifact']), acceptedSecretKinds: Object.freeze([]),
    credentialKindsBySecret: Object.freeze({}), identityNamespaces: Object.freeze(['jav_code']), artifactKinds: Object.freeze(['poster', 'fanart']),
    extraOperations: Object.freeze(['shared.integration.search@1', 'libra.product_identity.evidence.observe@1', 'libra.product_metadata.fetch@1', 'libra.product_artifact.acquire@1',
      'arca.jav_correction.source.verify@1','arca.jav_correction.assets.prepare@1','arca.aftercare.binary_artifact.acquire@1']),
    normalizeSettings: settings,
    normalizeEndpoint(value) {
      if (typeof value !== 'string') fail('PLATFORM_INTEGRATION_ENDPOINT_INVALID', 'JAV source endpoint must be text.');
      const endpoint = value.replace(/\/$/, '');
      if (!definition.endpoints.includes(endpoint)) fail('PLATFORM_INTEGRATION_ENDPOINT_INVALID', 'JAV source endpoint is not allowed.');
      return endpoint;
    },
  }));
}
module.exports = Object.freeze({ createAnonymousJavRuntime, createAnonymousJavAdmin, validateAnonymousJavConfig, javSourceProfileDefinitions });
