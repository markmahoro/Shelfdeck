'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildSeriesPresentationBasis } = require('../../../contracts/series-presentation-basis');
function fail(code) { throw Object.assign(new Error(code), { code }); }

// Arca names the exact immutable metadata basis used by a retained shared
// version. Libra verifies its own Observation before exporting provenance
// dependencies. A matching show, title or latest Result is not sufficient.
function describeFreshResetMetadataRetention({ metadataBases, observations }) {
  const dependencies = [];
  for (const reference of metadataBases) {
    const matches = observations.filter(row => row.result?.evidenceId === reference.basis.metadataEvidenceId &&
      row.result?.payloadDigest === reference.basis.metadataObservationDigest);
    if (!matches.length) fail('LIBRA_RESET_SHARED_METADATA_MISSING');
    for (const row of matches) {
      const value = row.result, { payloadDigest, ...payload } = value;
      if (row.ownerDomain !== 'libra' || row.processType !== 'libra_run' || row.workKind !== 'product_metadata_observation' ||
          row.capabilityRef !== 'libra.product_metadata.fetch@1' || row.outcomeKind !== 'succeeded' ||
          row.resultSchemaRef !== 'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result' ||
          value.schemaRef !== 'helix://contracts/types/MetadataObservation/v1' || value.schemaVersion !== 1 ||
          value.producerRef !== row.capabilityRef || canonicalDigest(value) !== row.resultDigest ||
          canonicalDigest(payload) !== payloadDigest || !row.processId || !row.resultId ||
          canonicalJson(buildSeriesPresentationBasis(value)) !== canonicalJson(reference.basis))
        fail('LIBRA_RESET_SHARED_METADATA_CHANGED');
      dependencies.push({ buildId: reference.buildId, libraRunId: row.processId, resultId: row.resultId,
        resultDigest: row.resultDigest, evidenceId: value.evidenceId, observationDigest: payloadDigest });
    }
  }
  dependencies.sort((a, b) => a.buildId.localeCompare(b.buildId) || a.resultId.localeCompare(b.resultId));
  const body = { schemaRef: 'libra.fresh-reset-metadata-retention@1', dependencies };
  return Object.freeze({ ...body, digest: canonicalDigest(body) });
}

module.exports = Object.freeze({ describeFreshResetMetadataRetention });
