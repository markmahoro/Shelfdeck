'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const CAPABILITY = 'libra.intake.material.verify@1';
const CONTROL_REASON = 'candidate_control_scope_unavailable';
const SNAPSHOT_SCHEMA = 'helix://contracts/types/MaterialControlProjectionSnapshot/v1';
const MATERIAL_SCHEMA = 'helix://contracts/types/IntakeMaterialVerification/v1';
const EVIDENCE_SCHEMA = 'helix://contracts/capabilities/libra.intake.material.verify/v1/evidence';
const RESULT_SCHEMA = 'helix://contracts/capabilities/libra.intake.material.verify/v1/result';
const SHA256 = /^[a-f0-9]{64}$/;
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
function fail(code) { throw Object.assign(new Error(code), { code }); }
function bounded(value, bytes) { if (Buffer.byteLength(canonicalJson(value)) > bytes) fail('P8_INTAKE_CONTROL_VALUE_TOO_LARGE'); }
function intakeProcessId(snapshot) { return canonicalDigest({ schema:'libra.intake-decision-id@1', offerId:snapshot.offer.offerId }); }

function buildIntakeControlReadHandle(snapshot) {
  const materialKeys = snapshot.primaryMaterialDeliveries.map(item => item.materialKey).sort(compare);
  if (materialKeys.length < 1 || materialKeys.length > 1024 || new Set(materialKeys).size !== materialKeys.length ||
      materialKeys.some(key => !SHA256.test(key)) || !SHA256.test(snapshot.deliverySnapshotDigest)) fail('P8_INTAKE_CONTROL_SCOPE_INVALID');
  const scope = { ownerDomain:'libra', processType:'libra_intake', processId:intakeProcessId(snapshot),
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest, materialKeys:Object.freeze(materialKeys),
    accessScope:'current_control_projection_read' };
  const scopeDigest = canonicalDigest({ schema:'libra.intake-control-read-scope@1', ...scope });
  const handle = Object.freeze({ handleId:canonicalDigest({ schema:'libra.intake-control-read-handle-id@1', scopeDigest }), ...scope, scopeDigest });
  bounded(handle, 128*1024);
  return handle;
}

function assertIntakeControlReadHandle(handle, snapshot, ownerScope) {
  if (!handle || !ownerScope || ownerScope.domain !== 'libra' || ownerScope.processType !== 'libra_intake' ||
      ownerScope.processId !== intakeProcessId(snapshot) || canonicalJson(handle) !== canonicalJson(buildIntakeControlReadHandle(snapshot))) {
    fail('P8_INTAKE_CONTROL_HANDLE_INVALID');
  }
}

function assertControlProjection(value) {
  if (!value || !SHA256.test(value.materialKey) || !SHA256.test(value.evidenceDigest) || !SHA256.test(value.projectionDigest)) {
    fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
  }
  let fields = ['materialKey','resultKind','evidenceDigest','projectionDigest'];
  if (value.resultKind === 'unavailable') {
    if (!['control_row_invalid','control_query_unavailable'].includes(value.failureCode)) fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
    fields.push('failureCode');
  } else if (value.resultKind === 'available') {
    if (!Number.isSafeInteger(value.controlRevision) || value.controlRevision < 0) fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
    fields.push('controlRevision','controlState','regionProjection');
    if (value.controlState === 'controlled') {
      const regions = { procurement:'procurement', libra:'production', arca:'finished_goods' };
      if (value.controlRevision < 1 || !regions[value.ownerDomain] || value.regionProjection !== regions[value.ownerDomain] ||
          typeof value.ownerScopeType !== 'string' || !value.ownerScopeType || typeof value.ownerScopeId !== 'string' || !value.ownerScopeId) {
        fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
      }
      fields.push('ownerDomain','ownerScopeType','ownerScopeId');
    } else if (value.controlState !== 'uncontrolled' || value.regionProjection !== 'uncontrolled') fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
  } else fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
  if (Object.keys(value).sort().join('|') !== fields.sort().join('|') ||
      value.evidenceDigest !== canonicalDigest({ schema:'foundation.material-control-evidence@1',
        ...without(value, 'regionProjection','evidenceDigest','projectionDigest') }) ||
      value.projectionDigest !== canonicalDigest(without(value, 'projectionDigest'))) fail('P8_INTAKE_CONTROL_PROJECTION_INVALID');
  bounded(value, 4096);
}

function controlObservationDigest(handle, capturedAtMs, projections) {
  return canonicalDigest({ schema:'libra.intake-control-observation@1', readHandleScopeDigest:handle.scopeDigest, capturedAtMs, projections });
}
function controlMatches(snapshot, projection) {
  const member = snapshot.primaryMaterialDeliveries.find(item => item.materialKey === projection.materialKey);
  return Boolean(member && projection.resultKind === 'available' && projection.controlState === 'controlled' &&
    projection.ownerDomain === 'procurement' && projection.ownerScopeType === 'material_field' &&
    projection.ownerScopeId === snapshot.candidatePackage.materialFieldContextRef.fieldId &&
    projection.controlRevision === member.admittedControlRevision && projection.projectionDigest === member.admittedControlProjectionDigest);
}

function assertIntakeControlObservation(handle, observation) {
  if (!observation || !Number.isSafeInteger(observation.capturedAtMs) || observation.capturedAtMs < 0 ||
      !Array.isArray(observation.projections) || observation.projections.length !== handle.materialKeys.length ||
      Object.keys(observation).sort().join('|') !== 'capturedAtMs|observationDigest|projections' ||
      observation.observationDigest !== controlObservationDigest(handle, observation.capturedAtMs, observation.projections)) {
    fail('P8_INTAKE_CONTROL_OBSERVATION_INVALID');
  }
  bounded(observation, 1024*1024);
  observation.projections.forEach((item, index) => {
    assertControlProjection(item);
    if (item.materialKey !== handle.materialKeys[index]) fail('P8_INTAKE_CONTROL_SCOPE_INVALID');
  });
  if (observation.projections.some(item => item.resultKind === 'unavailable')) fail('P8_INTAKE_CONTROL_QUERY_UNAVAILABLE');
}

function verifyIntakeControlObservation(snapshot, handle, observation) {
  assertIntakeControlObservation(handle, observation);
  const witness = observation.projections.find(item => !controlMatches(snapshot, item)) || null;
  return Object.freeze({ controlObservationDigest:observation.observationDigest, controlCapturedAtMs:observation.capturedAtMs,
    controlScopeStatus:witness ? 'mismatched' : 'matched', mismatchedControlMaterialKey:witness?.materialKey || null, witness });
}

function assertMaterialControlResult(snapshot, result, evidence) {
  if (!result || result.schemaRef !== MATERIAL_SCHEMA || result.candidateDeliverySnapshotDigest !== snapshot.deliverySnapshotDigest ||
      result.basisDigest !== snapshot.deliverySnapshotDigest || result.candidatePackageId !== snapshot.candidatePackage.candidatePackageId ||
      result.packageDigest !== snapshot.candidatePackage.packageDigest || !SHA256.test(result.controlObservationDigest) ||
      !Number.isSafeInteger(result.controlCapturedAtMs) || result.controlCapturedAtMs < 0 || !Array.isArray(result.reasonCodes)) {
    fail('P8_INTAKE_CONTROL_RESULT_INVALID');
  }
  if (result.controlScopeStatus === 'matched') {
    if (result.mismatchedControlMaterialKey !== null || result.reasonCodes.includes(CONTROL_REASON)) fail('P8_INTAKE_CONTROL_RESULT_INVALID');
    if (!evidence || evidence.producerRef !== CAPABILITY ||
        evidence.payloadDigest !== canonicalDigest(result) || evidence.basisDigest !== snapshot.deliverySnapshotDigest) {
      fail('P8_INTAKE_CONTROL_EVIDENCE_INVALID');
    }
    return;
  }
  if (result.controlScopeStatus !== 'mismatched' || result.result !== 'failed' || !result.reasonCodes.includes(CONTROL_REASON) ||
      !SHA256.test(result.mismatchedControlMaterialKey)) fail('P8_INTAKE_CONTROL_RESULT_INVALID');
  assertControlProjection(evidence);
  if (evidence.resultKind !== 'available' || evidence.materialKey !== result.mismatchedControlMaterialKey ||
      !snapshot.primaryMaterialDeliveries.some(item => item.materialKey === evidence.materialKey) || controlMatches(snapshot, evidence)) {
    fail('P8_INTAKE_CONTROL_EVIDENCE_INVALID');
  }
}

function intakeControlEvidenceRef(snapshot, materialBinding, evidenceWorkId) {
  assertMaterialControlResult(snapshot, materialBinding?.result, materialBinding?.evidence);
  if (materialBinding.result.controlScopeStatus === 'matched') return null;
  if (materialBinding.workId !== evidenceWorkId || materialBinding.capabilityRef !== CAPABILITY ||
      materialBinding.outcomeKind !== 'succeeded' || materialBinding.state !== 'succeeded' ||
      materialBinding.resultSchemaRef !== RESULT_SCHEMA || materialBinding.evidenceSchemaRef !== EVIDENCE_SCHEMA ||
      typeof materialBinding.resultId !== 'string' || !materialBinding.resultId ||
      materialBinding.resultDigest !== canonicalDigest(materialBinding.result) || materialBinding.evidenceDigest !== canonicalDigest(materialBinding.evidence)) {
    fail('P8_INTAKE_CONTROL_EVIDENCE_BINDING_INVALID');
  }
  return Object.freeze({ evidenceSchemaRef:SNAPSHOT_SCHEMA, evidenceId:materialBinding.resultId, evidenceDigest:materialBinding.evidenceDigest });
}

module.exports = Object.freeze({ CAPABILITY, CONTROL_REASON, SNAPSHOT_SCHEMA, MATERIAL_SCHEMA, EVIDENCE_SCHEMA, RESULT_SCHEMA,
  buildIntakeControlReadHandle, assertIntakeControlReadHandle, assertControlProjection, controlObservationDigest,
  controlMatches, assertIntakeControlObservation, verifyIntakeControlObservation, assertMaterialControlResult, intakeControlEvidenceRef });
