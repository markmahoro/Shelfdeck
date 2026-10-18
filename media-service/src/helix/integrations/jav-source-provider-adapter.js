'use strict';

const { ExternalProviderObservationPort } = require('./index');
const { validateProductIntegrationHandle } = require('../platform/public/integration-adapter-support');
const { createJavSourceClient, JavSourceError } = require('./jav-source-client');

function createJavSourceProviderAdapter(options) {
  const runtime = options?.runtime, now = options?.now || Date.now;
  if (!runtime || typeof runtime.readCurrent !== 'function' || !runtime.profile?.siteRef)
    throw new TypeError('JAV source Provider requires its Platform runtime.');
  const siteRef = runtime.profile.siteRef;
  function current() {
    const snapshot = runtime.readCurrent();
    if (!snapshot || snapshot.integration.state !== 'active' || snapshot.integration.integrationType !== 'jav_source' ||
        snapshot.secret || snapshot.integration.config.secretRef !== null || snapshot.integration.config.credentialKind !== 'anonymous')
      throw new JavSourceError('PLATFORM_INTEGRATION_NOT_CONFIGURED', 'Anonymous JAV source is not configured.');
    return snapshot;
  }
  function client(snapshot, timeoutMs) {
    return createJavSourceClient({ siteRef, endpoint: snapshot.integration.endpoint,
      networkRoute: options.networkPolicy.route(), fetchImpl: options.fetchImpl, timeoutMs });
  }
  function fenced(handle, operationId, artifactKind, timeoutMs) {
    const snapshot = current(), source = client(snapshot, timeoutMs);
    if (!validateProductIntegrationHandle(handle, { integrationId: snapshot.integration.integrationId,
      integrationType: 'jav_source', configRevision: snapshot.integration.configRevision, secretRef: null,
      allowedOperation: operationId, artifactKind, siteRef, authMode: 'anonymous',
      endpointProfileDigest: source.endpointProfileDigest, networkRouteDigest: source.networkRouteDigest }, now()))
      throw new JavSourceError('P5_PROVIDER_HANDLE_DENIED', 'JAV source Handle is stale or does not bind the configured source.');
    return source;
  }
  const observationPort = ExternalProviderObservationPort({ async execute(request) {
    if (!['libra.product_identity.evidence.observe@1', 'libra.product_metadata.fetch@1', 'shared.integration.search@1','arca.jav_correction.source.verify@1'].includes(request?.operationId))
      throw new JavSourceError('P5_PROVIDER_INPUT_INVALID', 'JAV source observation operation is unsupported.');
    const source = fenced(request.integrationHandle, request.operationId, null, request.timeoutMs);
    const result = await source.observe(request.input);
    fenced(request.integrationHandle, request.operationId, null, request.timeoutMs);
    return result;
  } });
  async function prepareArtifact(request) {
    if (request?.operationId !== 'libra.product_artifact.acquire@1')
      throw new JavSourceError('P5_PROVIDER_INPUT_INVALID', 'JAV source artifact operation is unsupported.');
    return fenced(request.integrationHandle, request.operationId, request.input?.artifactKind, request.timeoutMs).prepareArtifact(request.input);
  }
  async function acquireCover(request) {
    if(!['libra.product_artifact.acquire@1','arca.jav_correction.assets.prepare@1','arca.jav_correction.source.verify@1'].includes(request?.operationId))
      throw new JavSourceError('P5_PROVIDER_INPUT_INVALID','JAV source cover acquisition operation is unsupported.');
    return fenced(request.integrationHandle,request.operationId,request.operationId==='arca.jav_correction.source.verify@1'?null:request.input?.artifactKind,request.timeoutMs).acquireCover(request.input);
  }
  async function acquireAftercareCover(request) {
    if(request?.operationId!=='arca.aftercare.binary_artifact.acquire@1'||!['poster','fanart'].includes(request.artifactKind))
      throw new JavSourceError('P5_PROVIDER_INPUT_INVALID','JAV Aftercare only acquires declared image artifacts.');
    const binding=require('../contracts/jav-selected-source').assertJavSelectedSource(request.javSelectedSource),
      source=fenced(request.integrationHandle,request.operationId,request.artifactKind,request.timeoutMs);
    if(binding.siteRef!==siteRef||['integrationId','authMode'].some(key=>binding[key]!==request.integrationHandle[key]))
      throw new JavSourceError('JAV_SOURCE_ARTIFACT_FENCE_DENIED','Aftercare source must retain its accepted site and integration.');
    const observed=await source.observe({queryAnchor:binding.queryAnchor,resourceKey:binding.resourceKey});
    if(observed.result!=='qualified'||observed.resourceKey!==binding.resourceKey||observed.cover.byteDigest!==binding.coverDigest||
      observed.descriptiveEntries.find(item=>item.key==='title')?.value!==binding.title||
      observed.resolvedProviderIdentity?.providerKey!==binding.queryAnchor.javCode)
      throw new JavSourceError('JAV_SOURCE_ARTIFACT_CHANGED','The accepted Aftercare source qualification changed.');
    const result=await source.acquireCover({queryAnchor:binding.queryAnchor,qualifiedObservation:observed,artifactKind:request.artifactKind});
    fenced(request.integrationHandle,request.operationId,request.artifactKind,request.timeoutMs);
    return result;
  }
  async function preview(request) {
    if(!['libra.product_identity.evidence.observe@1','shared.integration.search@1'].includes(request?.operationId))
      throw new JavSourceError('P5_PROVIDER_INPUT_INVALID','JAV preview requires its fenced identity observation operation.');
    const value=await fenced(request.integrationHandle,request.operationId,null,request.timeoutMs).observeWithCover(request.input);
    fenced(request.integrationHandle,request.operationId,null,request.timeoutMs);
    if(!value.coverBytes)return Object.freeze({observation:value});
    const image=await require('./jav-cover-renderer').renderJavPreviewCover(value.coverBytes,value.observation.cover.byteDigest);
    return Object.freeze({observation:value.observation,...image});
  }
  return Object.freeze({ observationPort, prepareArtifact, acquireCover, acquireAftercareCover, preview,
    normalizedEndpoint: value => runtime.profile.normalizeEndpoint(value),
    async testCandidate(candidate) {
      const source = createJavSourceClient({ siteRef, endpoint: runtime.profile.normalizeEndpoint(candidate.endpoint),
        networkRoute: options.networkPolicy.route(), fetchImpl: options.fetchImpl, timeoutMs: candidate.timeoutMs });
      const { buildJavQueryAnchor } = require('../contracts/jav-source-contracts');
      let observation;
      try { observation = await source.observe({ queryAnchor: buildJavQueryAnchor('jav_code', runtime.profile.probeCode) }); }
      catch (error) {
        const code = {
          JAV_SOURCE_UNAVAILABLE: 'PLATFORM_INTEGRATION_NETWORK_FAILED',
          JAV_SOURCE_TIMEOUT: 'PLATFORM_INTEGRATION_TIMEOUT',
          JAV_SOURCE_ACCESS_DENIED: 'PLATFORM_INTEGRATION_HTTP_FAILED',
          JAV_SOURCE_RESPONSE_INVALID: 'PLATFORM_INTEGRATION_RESPONSE_INVALID',
          JAV_SOURCE_RESPONSE_TOO_LARGE: 'PLATFORM_INTEGRATION_RESPONSE_BOUND',
          JAV_SOURCE_REDIRECT_DENIED: 'PLATFORM_INTEGRATION_RESPONSE_INVALID',
          JAV_SOURCE_URL_DENIED: 'PLATFORM_INTEGRATION_RESPONSE_INVALID',
          JAV_SOURCE_CHARSET_INVALID: 'PLATFORM_INTEGRATION_RESPONSE_INVALID',
        }[error.code];
        if (!code) throw error;
        throw new JavSourceError(code, 'JAV source connection test failed.', { siteRef, reasonCode: error.code, ...(error.details?.status ? { status: error.details.status } : {}), ...(error.details?.stage ? { stage: error.details.stage } : {}) });
      }
      if (observation.result !== 'qualified') throw new JavSourceError('PLATFORM_INTEGRATION_CONNECTION_TEST_FAILED', 'JAV source did not return a qualified sample.', { reasonCode: observation.result });
      const { canonicalDigest } = require('../contracts/canonical-json');
      return { result: 'passed', checkedAtMs: now(), endpointDigest: canonicalDigest({ endpoint: source.endpoint }),
        observationDigest: observation.observationDigest, identityNamespace: 'jav_code', identityProviderKey: runtime.profile.probeCode };
    },
  });
}

module.exports = Object.freeze({ createJavSourceProviderAdapter });
