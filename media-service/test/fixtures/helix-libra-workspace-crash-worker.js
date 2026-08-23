'use strict';

const fs = require('node:fs');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCleanServiceHost } = require('../../src/clean-service-host');

function routingHandle() {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:'scenario-tmdb-routing-handle', integrationId:'scenario-tmdb', integrationType:'tmdb',
    configRevision:1, secretRef:'scenario-tmdb-secret', allowedOperation:'libra.routing.fact.observe@1',
    expiresAtMs:Number.MAX_SAFE_INTEGER };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productHandle(intent, operationId, artifactKind = null) {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:canonicalDigest({ schema:'scenario-product-handle@1', operationId, artifactKind }),
    integrationId:intent.integrationId, integrationType:'tmdb', configRevision:intent.configRevision,
    secretRef:'scenario-tmdb-secret', allowedOperation:operationId, expiresAtMs:4_102_444_800_000 };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productOptions() {
  return Object.freeze({
    routingIntegrationHandleResolver:() => routingHandle(),
    routingProviderObservation:async ({ intent }) => Object.freeze([Object.freeze({
      providerKey:'990001', title:intent.candidateDisplayTitle, originalTitle:intent.candidateDisplayTitle,
      releaseYear:intent.candidateYear || 2008, regionCodes:Object.freeze(['US']), genreCodes:Object.freeze(['18']),
    })]),
    productIntegrationHandleResolver:({ intent, operationId, artifactKind }) =>
      productHandle(intent, operationId, artifactKind || null),
    currentProductIntegrationHandleResolver:({ providerKind, operationId, artifactKind }) =>
      productHandle({ integrationId:providerKind + '-main', configRevision:1 }, operationId, artifactKind || null),
    productProviderMetadataFetch:async ({ metadataFetchIntent:intent }) => Object.freeze({
      providerKind:'tmdb', integrationId:intent.integrationId, configRevision:intent.configRevision,
      descriptiveEntries:Object.freeze([
        { key:'director', value:'Scenario Director' }, { key:'genre', value:'Drama' },
        { key:'plot', value:'Libra Handoff B recovery evidence' }, { key:'title', value:'Scenario Movie' },
        { key:'tmdb_movie_id', value:intent.resolvedProviderIdentity.providerKey },
        { key:'year_or_release_date', value:2008 },
      ]),
      providerIdentities:Object.freeze([intent.resolvedProviderIdentity]),
      peopleHints:Object.freeze([]),
    }),
    productProviderArtifactFetch:async ({ artifactKind, resolvedProviderIdentity, integrationHandle }) => Object.freeze({
      resultKind:'acquired', bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'), artifactKind,
      integrationId:integrationHandle.integrationId, configRevision:integrationHandle.configRevision,
      mediaType:'image/jpeg', resolvedProviderIdentity,
    }),
  });
}

function holdAtBoundary(config, boundary, payload) {
  fs.writeFileSync(config.signalPath, JSON.stringify({ boundary, payload }), 'utf8');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600_000);
}

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const options = {
    dataDir:config.dataDir,
    adminDistDir:config.adminDistDir,
    secretRoot:config.secretRoot,
    libraWorkspaceRoot:config.libraWorkspaceRoot,
    ...productOptions(),
    onExecutionRuntimeError(error) {
      fs.writeFileSync(config.errorPath, JSON.stringify({ code:error?.code || null, message:error?.message || String(error) }), 'utf8');
    },
  };
  if (config.mode === 'after_physical') options.workspaceAfterMediaPhysicalEffect = (payload) =>
    holdAtBoundary(config, 'after_physical', payload);
  if (config.mode === 'after_media_commit') options.workspaceAfterMediaEffectCommit = (payload) =>
    holdAtBoundary(config, 'after_media_commit', payload);
  const host = await createCleanServiceHost(options);
  process.on('SIGTERM', async () => { await host.close(); process.exit(0); });
  setInterval(() => {}, 60_000);
}

main().catch((error) => {
  try {
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    fs.writeFileSync(config.errorPath, JSON.stringify({ code:error?.code || null, message:error?.message || String(error),
      details:error?.details || null, stack:error?.stack }), 'utf8');
  } catch {}
  process.exitCode = 1;
});
