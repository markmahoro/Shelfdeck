'use strict';
const { failureDiagnostics } = require('../../../contracts/failure-diagnostics');

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildMetadataFetchIntent, buildMetadataObservation } = require('../model/product-fact-contracts');

const CAPABILITY = 'libra.product_metadata.fetch@1';
const RESULT_SCHEMA = 'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result';
const EVIDENCE_SCHEMA = 'helix://contracts/capabilities/libra.product_metadata.fetch/v1/evidence';

function physicalMaterialIdentityKey(identity) {
  if (!identity || identity.fingerprintAlgorithm !== 'middle-256k-sha256' ||
      identity.fingerprintVersion !== 1 || !Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 0) {
    return null;
  }
  return canonicalDigest({
    schema: 'physical-material-identity@2',
    mountScopeId: identity.mountScopeId,
    inode: identity.inode,
    sizeBytes: identity.sizeBytes,
    fingerprintAlgorithm: identity.fingerprintAlgorithm,
    fingerprintVersion: identity.fingerprintVersion,
    contentFingerprint: identity.contentFingerprint,
  });
}

function samePhysicalMaterialIdentity(left, right) {
  const leftKey = physicalMaterialIdentityKey(left);
  const rightKey = physicalMaterialIdentityKey(right);
  return Boolean(leftKey && left.materialKey === leftKey &&
    rightKey && right.materialKey === rightKey && leftKey === rightKey);
}

function requireNamed(context, names) {
  for (const name of names) {
    if (!context?.namedInputs || !Object.hasOwn(context.namedInputs, name)) {
      throw new TypeError('Product Metadata Capability input is absent: ' + name);
    }
  }
}

function outcome(result) {
  return Object.freeze({
    kind: 'succeeded',
    resultSchemaRef: RESULT_SCHEMA,
    result,
    evidenceSchemaRef: EVIDENCE_SCHEMA,
    evidence: Object.freeze({
      evidenceId: result.evidenceId,
      evidenceKind: 'metadata_observation',
      producerRef: CAPABILITY,
      basisDigest: result.basisDigest,
      payloadDigest: result.payloadDigest,
      observedAtMs: result.observedAtMs,
    }),
  });
}

function metadataFetchFailed(error) {
  const cause = (error?.details && typeof error.details.causeCode === 'string' && error.details.causeCode)
    || (typeof error?.code === 'string' ? error.code : '');
  const failureClass = cause === 'PLATFORM_INTEGRATION_TIMEOUT'
    ? 'timeout'
    : (cause === 'PLATFORM_INTEGRATION_NETWORK_FAILED' || cause === 'PLATFORM_INTEGRATION_HTTP_FAILED'
      ? 'integration' : null);
  if (!failureClass) throw error;
  return Object.freeze({
    kind: 'failed',
    failureClass,
    code: cause,
    message: String(error.message || 'Product metadata provider failed.'),
    retryDirective: 'contract_policy',
    evidence: Object.freeze({
      errorName: String(error.name || 'Error'),
      errorCode: cause,
      diagnostics: failureDiagnostics(error),
    }),
  });
}

function createProductMetadataCapabilityPorts(options) {
  if (!options?.productProductionPort ||
      typeof options.productProductionPort.readRelatedNfo !== 'function' ||
      typeof options.productProductionPort.fetchProvider !== 'function') {
    throw new TypeError('Product Metadata Capability requires the clean Product production port.');
  }
  const now = options.now || Date.now;
  const port = Object.freeze({
    validateInputs(context) {
      requireNamed(context, ['metadataFetchIntent', 'physicalMaterialReadHandleOrIntegrationHandle']);
    },
    async execute(context) {
      const intent = buildMetadataFetchIntent(context.namedInputs.metadataFetchIntent);
      let handle = context.namedInputs.physicalMaterialReadHandleOrIntegrationHandle;
      let source;
      try {
      if(intent.contentProfile==='jav')handle=require('../../../contracts/jav-source-qualification').resolveJavQualifiedHandle(
        handle,intent.javSelectedSource,CAPABILITY,options.resolveJavSourceHandle);
      const sourceAuthorizedAtMs=now();
      if (intent.episodeScope) {
        const snapshot = options.movieProductionReader.readRunSnapshot(context.ownerScope.processId);
        if (intent.libraRunId !== context.ownerScope.processId || snapshot?.spec?.contentProfile !== 'series' ||
            snapshot.run.executionBasisDigest !== intent.runExecutionBasisDigest ||
            !snapshot.spec.productScope.episodeKeys.includes(intent.episodeScope.episodeKey) ||
            !snapshot.episodeClaims.some(claim => claim.episodeKey === intent.episodeScope.episodeKey))
          throw new TypeError('Episode metadata is outside the frozen Run delivery scope.');
      }
      if (intent.sourceKind === 'related_nfo') {
        const snapshot = typeof options.movieProductionReader.readRunSnapshot === 'function'
          ? options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
          : options.movieProductionReader.readRun(context.ownerScope.processId);
        const reference = snapshot?.relatedReferences?.find((item) => item.referenceId === intent.relatedReferenceId);
        if (!reference || reference.referenceDigest !== intent.relatedReferenceDigest ||
            reference.identity?.contentFingerprint !== intent.expectedChecksum ||
            !samePhysicalMaterialIdentity(handle.identity, reference.identity)) {
          throw new TypeError('Related NFO projection no longer matches the immutable Run input.');
        }
        if(intent.episodeScope&&!snapshot.members.some(member=>member.materialKey===reference.primaryMaterialKey&&
            member.episodeClaims.some(claim=>claim.episodeKey===intent.episodeScope.episodeKey)))
          throw new TypeError('Related NFO association is outside the frozen Episode material scope.');
        const nfo = options.productProductionPort.readRelatedNfo({
          primaryMaterialKey: reference.primaryMaterialKey,
          reference,
        });
        const scopedNumbers = new Map(nfo.entries.map(item => [item.key, item.value]));
        const matchesScope = !intent.episodeScope ||
          (nfo.documentRoot === 'episodedetails' && Number(scopedNumbers.get('season_number')) === intent.episodeScope.seasonNumber &&
           Number(scopedNumbers.get('episode_number')) === intent.episodeScope.episodeNumber);
        const entries = nfo.entries.filter(item=>intent.contentProfile!=='series'||intent.episodeScope||
          nfo.documentRoot!=='episodedetails'||!['title','plot','release_date','year_or_release_date'].includes(item.key));
        source = Object.freeze({
          descriptiveEntries: matchesScope ? entries.map(item =>
            intent.episodeScope && ['season_number', 'episode_number'].includes(item.key)
              ? Object.freeze({ ...item, value:Number(item.value) }) : item) : [],
          sourceNfoSemantics:nfo.sourceNfoSemantics,sourceNfoSnapshotDigest:nfo.sourceNfoSnapshotDigest,
          providerIdentities: Object.freeze([]),
          peopleHints: Object.freeze(matchesScope ? (nfo.peopleHints || []) : []),
          artifactHints: Object.freeze([]),
        });
      } else if (intent.sourceKind === 'provider') {
        const provider = await options.productProductionPort.fetchProvider(intent, handle);
        const local=provider.seriesPresentationSource&&options.qualifySeriesLocalSource?.(options.movieProductionReader.readRunSnapshot(context.ownerScope.processId).candidatePackage?.seriesPresentationSourceRefs,provider.seriesPresentationSource.providerKey);
        source = Object.freeze({
          ...(local?{seriesQualifiedLocalSource:local}:{}),
          descriptiveEntries: provider.descriptiveEntries,
          providerIdentities: provider.providerIdentities,
          peopleHints: provider.peopleHints,
          artifactHints: Object.freeze([]),
          ...(provider.seriesPresentationSource?{seriesPresentationSource:provider.seriesPresentationSource}:{}),
        });
      } else {
        throw new TypeError('Product Metadata source kind is unsupported.');
      }
      return outcome(buildMetadataObservation({
        intent,
        ...(intent.contentProfile==='jav'?{sourceIntegrationHandle:handle,sourceAuthorizedAtMs}:{}),
        descriptiveEntries: source.descriptiveEntries,
        sourceNfoSemantics:source.sourceNfoSemantics || null,sourceNfoSnapshotDigest:source.sourceNfoSnapshotDigest || null,
        providerIdentities: source.providerIdentities,
        peopleHints: source.peopleHints,
        artifactHints: source.artifactHints,
        ...(source.seriesQualifiedLocalSource?{seriesQualifiedLocalSource:source.seriesQualifiedLocalSource}:{}),
        ...(source.seriesPresentationSource?{seriesPresentationSource:source.seriesPresentationSource}:{}),
        observedAtMs: now(),
      }));
      } catch (error) {
        return metadataFetchFailed(error);
      }
    },
    validateResult(_context, value) {
      if (!value?.result?.evidenceId || value.result.producerRef !== CAPABILITY) {
        throw new TypeError('Product Metadata Observation is absent.');
      }
    },
  });
  return Object.freeze({ [CAPABILITY]: port });
}

module.exports = Object.freeze({ CAPABILITY, createProductMetadataCapabilityPorts, metadataFetchFailed });
