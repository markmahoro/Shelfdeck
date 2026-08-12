'use strict';

const { buildMetadataObservation } = require('../model/product-fact-contracts');

const CAPABILITY = 'libra.product_metadata.fetch@1';
const RESULT_SCHEMA = 'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result';
const EVIDENCE_SCHEMA = 'helix://contracts/capabilities/libra.product_metadata.fetch/v1/evidence';

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
      const intent = context.namedInputs.metadataFetchIntent;
      const handle = context.namedInputs.physicalMaterialReadHandleOrIntegrationHandle;
      let source;
      if (intent.sourceKind === 'related_nfo') {
        const snapshot = typeof options.movieProductionReader.readRunSnapshot === 'function'
          ? options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
          : options.movieProductionReader.readRun(context.ownerScope.processId);
        const reference = snapshot?.relatedReferences?.find((item) => item.referenceId === intent.relatedReferenceId);
        if (!reference || reference.referenceDigest !== intent.relatedReferenceDigest ||
            reference.identity?.contentFingerprint !== intent.expectedChecksum ||
            canonicalDigest(handle.identity) !== canonicalDigest(reference.identity)) {
          throw new TypeError('Related NFO projection no longer matches the immutable Run input.');
        }
        const nfo = options.productProductionPort.readRelatedNfo({
          primaryMaterialKey: reference.primaryMaterialKey,
          reference,
        });
        source = Object.freeze({
          descriptiveEntries: nfo.entries,
          providerIdentities: Object.freeze([]),
          peopleHints: Object.freeze([]),
          artifactHints: Object.freeze([]),
        });
      } else if (intent.sourceKind === 'provider') {
        const provider = await options.productProductionPort.fetchProvider(intent, handle);
        source = Object.freeze({
          descriptiveEntries: provider.descriptiveEntries,
          providerIdentities: provider.providerIdentities,
          peopleHints: provider.peopleHints,
          artifactHints: Object.freeze([]),
        });
      } else {
        throw new TypeError('Product Metadata source kind is unsupported.');
      }
      return outcome(buildMetadataObservation({
        intent,
        descriptiveEntries: source.descriptiveEntries,
        providerIdentities: source.providerIdentities,
        peopleHints: source.peopleHints,
        artifactHints: source.artifactHints,
        observedAtMs: now(),
      }));
    },
    validateResult(_context, value) {
      if (!value?.result?.evidenceId || value.result.producerRef !== CAPABILITY) {
        throw new TypeError('Product Metadata Observation is absent.');
      }
    },
  });
  return Object.freeze({ [CAPABILITY]: port });
}

module.exports = Object.freeze({ CAPABILITY, createProductMetadataCapabilityPorts });
