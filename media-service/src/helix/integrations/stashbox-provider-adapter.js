'use strict';

const { canonicalDigest } = require('../contracts/canonical-json');
const { fetchJson } = require('./h1-provider-adapters');

function createStashBoxProviderAdapter(options) {
  const { runtime, fetchImpl } = options;
  if (!runtime || runtime.profile.kind !== 'stashbox' || typeof fetchImpl !== 'function') throw new TypeError('StashBox requires its Platform runtime and global network transport.');
  const now = options.now || Date.now;
  function configuration() {
    const snapshot = runtime.readCurrent();
    return snapshot?.integration.state === 'active' ? Object.freeze({ endpoint: snapshot.integration.endpoint, configRevision: snapshot.integration.configRevision }) : null;
  }
  async function withCredential(expectedRevision, consumer) {
    const snapshot = runtime.readCurrent();
    if (!snapshot || snapshot.integration.state !== 'active' || snapshot.integration.configRevision !== expectedRevision) {
      throw Object.assign(new Error('StashBox 配置已变化或未启用。'), { code: 'PLATFORM_INTEGRATION_REVISION_MISMATCH' });
    }
    const lease = runtime.secretLeaseResolverPort.resolve({ secretRef: snapshot.secret.secretRef, secretKind: snapshot.secret.secretKind,
      ownerScopeType: 'integration', ownerScopeId: snapshot.integration.integrationId, expectedRevision: snapshot.secret.revision,
      purpose: 'shared.integration.search@1', ttlMs: 20000 });
    return runtime.broker.consumeAsync(lease, consumer);
  }
  return Object.freeze({ configuration, withCredential,
    normalizedEndpoint: value => runtime.profile.normalizeEndpoint(value),
    async testCandidate(candidate) {
      const endpoint = runtime.profile.normalizeEndpoint(candidate.endpoint);
      const result = await fetchJson(fetchImpl, endpoint, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(candidate.timeoutMs),
        headers: { 'Content-Type': 'application/json', ApiKey: candidate.secretBytes.toString('utf8') }, body: JSON.stringify({ query: '{ me { id } }' }) }, 64 * 1024);
      if (result.errors?.length || typeof result.data?.me?.id !== 'string' || !result.data.me.id || result.data.me.id.length > 256) {
        throw Object.assign(new Error('StashBox 未通过账户连接验证。'), { code: 'PLATFORM_INTEGRATION_RESPONSE_INVALID' });
      }
      return Object.freeze({ checkedAtMs: now(), endpointDigest: canonicalDigest({ endpoint }), observationDigest: canonicalDigest(result),
        identityNamespace: 'stashbox_user', identityProviderKey: result.data.me.id });
    },
  });
}

module.exports = Object.freeze({ createStashBoxProviderAdapter });
