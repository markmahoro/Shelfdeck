'use strict';

// A historical registration is checked against its own immutable commitments,
// not against whichever model pack or matching policy is installed today.
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { operationIdentityFromDigest, SYSTEM, SCHEMA, ORIGIN } = require('./us-adult-catalogue-registration');
const COMMAND = 'people.catalogue-register-person@1';
function fail() { throw Object.assign(new Error('The retained catalogue registration evidence is incomplete or changed.'), { code: 'PEOPLE_RESET_CATALOGUE_EVIDENCE_INVALID' }); }
function document(row, prefix, selfCommitted = false) {
  let value;
  try { value = JSON.parse(row[prefix + '_json']); } catch { fail(); }
  if (canonicalJson(value) !== row[prefix + '_json'] || (selfCommitted ? value.decisionDigest : canonicalDigest(value)) !== row[prefix + '_digest']) fail();
  return value;
}
function selfDigest(value, key) {
  if (!value || typeof value !== 'object') fail();
  const { [key]: digest, ...body } = value;
  if (canonicalDigest(body) !== digest) fail();
}
function verifyFreshResetCatalogueRegistration({ revision, origin: row, operation, referenceRevision, asset, face, receipt, audit, marker }) {
  if (!revision || !row || !operation || !referenceRevision || !asset || !face || !receipt || !audit || !marker) fail();
  const decision = document(row, 'decision', true), origin = document(row, 'origin'), input = document(row, 'catalogue_input'),
    resolution = document(row, 'name_resolution'), observation = document(row, 'observation'), provider = document(row, 'provider_observation');
  selfDigest(decision, 'decisionDigest'); selfDigest(resolution, 'resolutionDigest'); selfDigest(observation, 'observationDigest');
  selfDigest(provider, 'observationDigest');
  const reference = decision.initialReference, image = reference?.artifactHandle, embedding = reference?.faceEmbeddingSetHandle;
  selfDigest(reference, 'decisionDigest'); selfDigest(embedding, 'handleDigest');
  if (row.person_id !== decision.newPersonId || row.decision_id !== decision.decisionId || row.decision_schema_ref !== SCHEMA ||
      row.decision_digest !== decision.decisionDigest || row.origin_schema_ref !== ORIGIN || origin.schema !== ORIGIN ||
      canonicalJson(origin) !== canonicalJson(decision.catalogueOrigin) || row.operation_id !== decision.operationId ||
      row.catalogue_input_schema_ref !== input.schema || row.name_resolution_schema_ref !== resolution.schema ||
      row.observation_schema_ref !== observation.schema || row.provider_observation_schema_ref !== provider.schema ||
      origin.catalogueDecisionInputDigest !== row.catalogue_input_digest || origin.sourceObservationDigest !== row.observation_digest ||
      origin.nameResolutionDigest !== resolution.resolutionDigest || origin.libraryNamesDigest !== resolution.libraryNamesDigest ||
      origin.nameQueryDigest !== resolution.nameQueryDigest || origin.providerObservationDigest !== row.provider_observation_digest ||
      origin.assessmentDigest !== input.assessmentDigest || origin.identityKey !== input.winner?.identityKey || origin.uid !== input.winner?.uid ||
      origin.selectedName !== input.winner?.name || canonicalJson(origin.aliases) !== canonicalJson(input.winner?.aliases) ||
      origin.imageSourceProofDigest !== canonicalDigest(origin.imageSourceProof) ||
      input.observationHandle?.observationArtifactHandle?.digestHex !== row.observation_digest ||
      input.observationHandle?.observationDigest !== observation.observationDigest || observation.basisDigest !== input.catalogueBasisDigest ||
      resolution.kind !== 'not_found' || resolution.candidates?.length !== 0) fail();
  const identity = operationIdentityFromDigest({ inputDigest: row.catalogue_input_digest, nameResolutionDigest: resolution.resolutionDigest,
    imageSourceProofDigest: origin.imageSourceProofDigest });
  const expectedDecisionId = canonicalDigest({ schema: 'people.catalogue-registration-decision-id@1', operationId: identity.operationId,
    inputDigest: row.catalogue_input_digest, providerObservationDigest: row.provider_observation_digest, imageSourceProofDigest: identity.imageSourceProofDigest });
  if (identity.personId !== row.person_id || identity.operationId !== row.operation_id || expectedDecisionId !== row.decision_id ||
      revision.person_id !== row.person_id || revision.revision !== 1 || revision.origin_kind !== 'catalogue_auto' ||
      revision.origin_decision_id !== row.decision_id || revision.origin_decision_digest !== row.decision_digest ||
      revision.canonical_name !== decision.canonicalName || decision.canonicalName !== origin.selectedName) fail();
  let payload, result, receiptResult;
  try { payload = JSON.parse(operation.payload_json); result = JSON.parse(operation.result_json); receiptResult = JSON.parse(receipt.result_ref_json); } catch { fail(); }
  if (canonicalJson(payload) !== operation.payload_json || canonicalDigest(payload) !== operation.payload_digest ||
      operation.request_digest !== operation.payload_digest || operation.state !== 'completed' || operation.actor_id !== SYSTEM ||
      operation.operation_id !== row.operation_id || operation.person_id !== row.person_id || operation.idempotency_key !== row.operation_id ||
      operation.payload_schema_ref !== payload.schema || payload.operationId !== row.operation_id || payload.personId !== row.person_id ||
      payload.catalogueDecisionInputDigest !== row.catalogue_input_digest || payload.nameResolutionDigest !== resolution.resolutionDigest ||
      payload.imageSourceProofDigest !== origin.imageSourceProofDigest || payload.selectedImage?.digestHex !== reference.artifactDigest ||
      canonicalJson(result) !== operation.result_json || canonicalDigest(result) !== operation.result_digest ||
      canonicalJson(result) !== canonicalJson({ personId: row.person_id, personRevision: 1, referenceRevision: 1 }) ||
      operation.result_schema_ref !== 'people.image-operation-result@1' || operation.failure_code !== null) fail();
  const model = payload.faceModelRef;
  selfDigest(model, 'digest');
  if (model.mode !== 'single_reference_face' || model.modelId !== 'insightface-buffalo_l@1' ||
      model.outputContractDigest !== canonicalDigest({ schema: 'shared.buffalo-feature-output@1', dimension: 512, normalization: 'unit_l2' }) ||
      reference.modelRef !== model.digest || reference.personId !== row.person_id || reference.actorId !== SYSTEM ||
      reference.artifactDigest !== image?.digestHex || embedding?.dimension !== 512 || embedding?.detectedFaceCount !== 1 ||
      embedding?.vectorCount !== 1 || embedding?.faceModelRefDigest !== model.digest || embedding?.sourceArtifactSetDigest !== reference.artifactDigest ||
      referenceRevision.person_id !== row.person_id || referenceRevision.revision !== 1 || referenceRevision.operation_kind !== 'add_image' ||
      referenceRevision.reference_asset_id !== reference.referenceAssetId || referenceRevision.reference_face_id !== reference.referenceFaceId ||
      referenceRevision.decision_digest !== reference.decisionDigest || asset.person_id !== row.person_id ||
      asset.reference_asset_id !== reference.referenceAssetId || asset.artifact_handle_id !== image.artifactHandleId ||
      asset.artifact_digest !== image.digestHex || face.person_id !== row.person_id || face.reference_face_id !== reference.referenceFaceId ||
      face.reference_asset_id !== asset.reference_asset_id || face.embedding_handle_id !== embedding.artifactHandleId ||
      face.embedding_digest !== embedding.embeddingDigest || face.model_ref !== model.digest) fail();
  const receiptId = 'people-catalogue-registration-' + row.decision_id;
  if (receipt.command_receipt_id !== receiptId || receipt.owner_domain !== 'people' || receipt.command_contract !== COMMAND ||
      receipt.caller_scope !== SYSTEM || receipt.idempotency_key !== row.decision_id || receipt.request_digest !== row.decision_digest ||
      receipt.target_type !== 'person' || receipt.target_id !== row.person_id || canonicalJson(receiptResult) !== receipt.result_ref_json ||
      canonicalDigest(receiptResult) !== receipt.result_digest || receiptResult.personId !== row.person_id ||
      audit.audit_id !== 'people-catalogue-audit-' + row.decision_id || audit.owner_domain !== 'people' || audit.actor_type !== 'system' ||
      audit.actor_id !== SYSTEM || audit.action !== 'people.person.catalogue_register' || audit.scope_type !== 'person' ||
      audit.scope_id !== row.person_id || audit.evidence_digest !== row.decision_digest || marker.commit_marker !== receiptId ||
      marker.owner_domain !== 'people' || marker.scope_type !== 'person' || marker.scope_id !== row.person_id ||
      marker.commit_digest !== canonicalDigest({ commandContract: COMMAND, decisionDigest: row.decision_digest, scopeId: row.person_id })) fail();
  return Object.freeze({ personId: row.person_id, decisionId: row.decision_id, digest: canonicalDigest({ revision, origin: row, operation,
    referenceRevision, asset, face, receipt, audit, marker }) });
}
module.exports = Object.freeze({ verifyFreshResetCatalogueRegistration });
