'use strict';

const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const CONTRACT = 'shelfdeck.fresh-formation-reset@1';
const SHA = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function freeze(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
}
function digestRecord(record, field, schemaRef) {
  if (!record || record.schemaRef !== schemaRef) fail('RESET_PREFLIGHT_EVIDENCE_INVALID');
  const { [field]: digest, ...body } = record;
  if (!SHA.test(digest || '') || canonicalDigest(body) !== digest) fail('RESET_PREFLIGHT_EVIDENCE_INVALID');
  return digest;
}
function budgetRequirements(volumeBudget) {
  if (!Array.isArray(volumeBudget?.volumes) || canonicalDigest(volumeBudget.volumes) !== volumeBudget.digest)
    fail('RESET_PREFLIGHT_BUDGET_INVALID');
  const requirements = volumeBudget.volumes.map(volume => {
    if (!volume || ![volume.requiredBytes, volume.availableBytes, volume.reserveBytes].every(value => typeof value === 'string' && /^\d+$/.test(value)) ||
        typeof volume.device !== 'string' || !Array.isArray(volume.allocations) ||
        volume.allocations.some(item => !item || typeof item.directory !== 'string' || typeof item.purpose !== 'string' ||
          typeof item.bytes !== 'string' || !/^\d+$/.test(item.bytes))) fail('RESET_PREFLIGHT_BUDGET_INVALID');
    const required = volume.allocations.reduce((sum, item) => sum + BigInt(item.bytes), BigInt(volume.reserveBytes));
    if (required !== BigInt(volume.requiredBytes) || volume.sufficient !== (BigInt(volume.availableBytes) >= required))
      fail('RESET_PREFLIGHT_BUDGET_INVALID');
    return { device: volume.device, requiredBytes: volume.requiredBytes, reserveBytes: volume.reserveBytes,
      allocations: volume.allocations.map(item => ({ ...item })) };
  }).sort((a,b) => a.device.localeCompare(b.device));
  if (!requirements.length || new Set(requirements.map(row => row.device)).size !== requirements.length ||
      volumeBudget.ready !== volumeBudget.volumes.every(volume => volume.sufficient)) fail('RESET_PREFLIGHT_BUDGET_INVALID');
  return requirements;
}

// The public confirmation binds exact logical scope and volume requirements.
// Available free bytes are sampled again before writing, not part of identity:
// unrelated disk activity may change availability without changing this plan.
function buildResetPreflight({ runtimeRevision, copy, policy, storage, storageManifest, backupPlanDigest, volumeBudget, protectedSummary }) {
  if (!Number.isSafeInteger(runtimeRevision) || runtimeRevision < 0 || !SHA.test(backupPlanDigest || '') ||
      copy?.schemaRef !== 'formation-reset-copy@1' || !Array.isArray(copy.tables) ||
      !policy?.tables || !protectedSummary || !Array.isArray(storage?.roots) || !Array.isArray(storage?.protectedDirectories) ||
      !Array.isArray(volumeBudget?.volumes)) fail('RESET_PREFLIGHT_INPUT_INVALID');
  const sourceSnapshotDigest = digestRecord(copy.sourceSnapshot, 'digest', 'formation-reset-source-snapshot@1');
  const storageManifestDigest = digestRecord(storageManifest, 'digest', 'formation-reset-storage@1');
  const counts = copy.tables.map(row => {
    if (typeof row.table !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.table) ||
        ![row.before, row.retained, row.removed].every(value => Number.isSafeInteger(value) && value >= 0) ||
        row.before !== row.retained + row.removed) fail('RESET_PREFLIGHT_COUNTS_INVALID');
    return { table: row.table, retained: row.retained, removed: row.removed };
  }).sort((a,b) => a.table.localeCompare(b.table));
  if (new Set(counts.map(row => row.table)).size !== counts.length) fail('RESET_PREFLIGHT_COUNTS_INVALID');
  const requirements = budgetRequirements(volumeBudget);
  const basis = { contractVersion: CONTRACT, runtimeRevision, sourceSnapshotDigest,
    retentionPolicyDigest: canonicalDigest(policy), targetSchemaDigest: copy.schemaTransition?.targetSchemaDigest || null,
    storageManifestDigest, storageBoundaryDigest: canonicalDigest(storage), storage, backupPlanDigest, counts, expectedReleasedBytes: storageManifest.bytes,
    protectedSummary, volumeRequirements: requirements };
  // Clone before freezing: the Operator's input evidence is not frozen as a
  // side effect, and callers cannot mutate nested returned counts/protections.
  return freeze(JSON.parse(canonicalJson({ ...basis, previewDigest: canonicalDigest(basis),
    ready: volumeBudget.ready, blockers: volumeBudget.ready ? [] : [{ code: 'RESET_OPERATOR_SPACE_INSUFFICIENT' }], volumeBudget })));
}

function assertResetPreflight(record) {
  if (!record || typeof record !== 'object') fail('RESET_PREFLIGHT_EVIDENCE_INVALID');
  const { previewDigest, ready, blockers, volumeBudget, ...basis } = record;
  if (basis.contractVersion !== CONTRACT || !SHA.test(previewDigest || '') || canonicalDigest(basis) !== previewDigest ||
      ready !== true || !Array.isArray(blockers) || blockers.length) fail('RESET_PREFLIGHT_NOT_APPROVED');
  if (canonicalDigest(basis.storage) !== basis.storageBoundaryDigest) fail('RESET_PREFLIGHT_EVIDENCE_INVALID');
  if (canonicalDigest(budgetRequirements(volumeBudget)) !== canonicalDigest(basis.volumeRequirements))
    fail('RESET_PREFLIGHT_BUDGET_INVALID');
  if (!volumeBudget.ready) fail('RESET_OPERATOR_SPACE_INSUFFICIENT');
  return basis;
}

function assertResetPreflightApplicable(approved, current) {
  assertResetPreflight(approved);
  // Recompute from actual new evidence rather than accepting the old free-space
  // sample or a client-supplied ready flag.
  assertResetPreflight(current);
  if (approved.previewDigest !== current.previewDigest) fail('RUNTIME_RESET_PREVIEW_STALE');
  return current;
}

function assertPreflightCapacityNow(approved) {
  const basis = assertResetPreflight(approved);
  const reserves = new Set(basis.volumeRequirements.map(row => row.reserveBytes));
  if (reserves.size !== 1) fail('RESET_PREFLIGHT_BUDGET_INVALID');
  const budget = require('./formation-reset-storage').buildStorageBudget({
    allocations: basis.volumeRequirements.flatMap(row => row.allocations.map(item => ({ ...item, bytes: BigInt(item.bytes) }))),
    reserveBytes: BigInt([...reserves][0]),
  });
  if (canonicalDigest(budgetRequirements(budget)) !== canonicalDigest(basis.volumeRequirements)) fail('RUNTIME_RESET_PREVIEW_STALE');
  if (!budget.ready) fail('RESET_OPERATOR_SPACE_INSUFFICIENT');
  return budget;
}

function assertColdCopyMatchesPreflight(approved, { copy, policy, storage, storageManifest }) {
  const basis = assertResetPreflight(approved);
  const counts = copy.tables.map(row => ({ table: row.table, retained: row.retained, removed: row.removed }))
    .sort((a,b) => a.table.localeCompare(b.table));
  if (basis.sourceSnapshotDigest !== digestRecord(copy.sourceSnapshot, 'digest', 'formation-reset-source-snapshot@1') ||
      basis.retentionPolicyDigest !== canonicalDigest(policy) || basis.storageBoundaryDigest !== canonicalDigest(storage) ||
      basis.storageManifestDigest !== digestRecord(storageManifest, 'digest', 'formation-reset-storage@1') ||
      basis.targetSchemaDigest !== (copy.schemaTransition?.targetSchemaDigest || null) ||
      canonicalDigest(basis.counts) !== canonicalDigest(counts)) fail('RUNTIME_RESET_PREVIEW_STALE');
}

function buildCapacityBlockedPreflight({ runtimeRevision, backupPlanDigest, storage, volumeBudget }) {
  if (!Number.isSafeInteger(runtimeRevision) || runtimeRevision < 0 || !SHA.test(backupPlanDigest || '') ||
      !Array.isArray(storage?.roots) || !Array.isArray(storage?.protectedDirectories)) fail('RESET_PREFLIGHT_INPUT_INVALID');
  const requirements = budgetRequirements(volumeBudget);
  if (volumeBudget.ready) fail('RESET_PREFLIGHT_BUDGET_INVALID');
  const basis = { contractVersion: CONTRACT, runtimeRevision, backupPlanDigest, storageBoundaryDigest: canonicalDigest(storage),
    counts: null, protectedSummary: null, expectedReleasedBytes: null, selectionStatus: 'not_evaluated', volumeRequirements: requirements };
  return freeze(JSON.parse(canonicalJson({ ...basis, previewDigest: canonicalDigest(basis), ready: false,
    blockers: [{ code: 'RESET_OPERATOR_SPACE_INSUFFICIENT' }], volumeBudget })));
}

module.exports = Object.freeze({ buildResetPreflight, assertResetPreflight, assertResetPreflightApplicable,
  assertColdCopyMatchesPreflight, buildCapacityBlockedPreflight, assertPreflightCapacityNow });
