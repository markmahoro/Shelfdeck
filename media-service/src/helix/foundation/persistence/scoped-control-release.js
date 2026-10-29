'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('./owner-repository');
const { createMaterialControlParticipant, controlScopeDigest, projectMaterialControlRow } = require('./material-control');

const COLUMNS = ['material_key', 'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm', 'fingerprint_version',
  'content_fingerprint', 'owner_domain', 'owner_scope_type', 'owner_scope_id', 'control_revision', 'state'];
const identityKey = scope => JSON.stringify([scope.ownerDomain, scope.scopeType, scope.scopeId]);
const canonicalRow = row => {
  if (!row || !['1', '1.0', 1, 1n].includes(row.fingerprint_version) || ['size_bytes', 'control_revision'].some(column =>
    !['number', 'bigint'].includes(typeof row[column]) || !Number.isSafeInteger(Number(row[column])) ||
    Number(row[column]) < (column === 'size_bytes' ? 0 : 1)))
    fail('SCOPED_CONTROL_RELEASE_INVALID', 'Physical size and Control revisions must be explicit safe integers.');
  return Object.fromEntries(COLUMNS.map(column => [column,
    ['size_bytes', 'control_revision'].includes(column) ? Number(row[column]) : row[column] == null ? null : String(row[column])]));
};
const sortedRows = rows => rows.map(canonicalRow).sort((a, b) => a.material_key.localeCompare(b.material_key));
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// The business Owner supplies the authorized scopes and immutable command
// evidence. Foundation only proves the complete current set and appends the
// ordinary release revisions; it never chooses a business disposition.
function createScopedControlRelease(options, request) {
  const { ownerDomain, processType, processId, scopes, evidenceDigest, commitMarker, receiptSchemaRef } = request;
  if (!Array.isArray(request.expectedRows))
    fail('SCOPED_CONTROL_RELEASE_INVALID', 'An explicit frozen Control set is required.');
  const rows = sortedRows(request.expectedRows || []);
  if (!Array.isArray(scopes) || scopes.length > 1000 || scopes.some(scope => scope.ownerDomain !== ownerDomain || !scope.scopeType || !scope.scopeId) ||
      rows.length > 1024 || new Set(rows.map(row => row.material_key)).size !== rows.length)
    fail('SCOPED_CONTROL_RELEASE_INVALID', 'An exact bounded Owner scope and unique Control set are required.');
  const scopeKeys = new Set(scopes.map(identityKey));
  if (scopeKeys.size !== scopes.length || rows.some(row => row.state !== 'controlled' || !scopeKeys.has(identityKey({
    ownerDomain: row.owner_domain, scopeType: row.owner_scope_type, scopeId: row.owner_scope_id }))))
    fail('SCOPED_CONTROL_RELEASE_FOREIGN_OWNER', 'A release cannot claim another current Owner or an unselected scope.');
  const expectedDigest = canonicalDigest(rows);
  const repository = createRepositoryDefinition({ repositoryId: 'scoped_control_release_guard', owner: 'material-control-authority', readOnly: true,
    schemaManifest: options.schemaManifest, statements: {
      scope: { kind: 'select-all', tableId: 'fx_material_controls', columns: COLUMNS,
        keyColumns: ['owner_domain', 'owner_scope_type', 'owner_scope_id'], safeIntegers: true },
    } });
  const validationParticipant = { participantId: 'scoped_control_release_guard', owner: 'material-control-authority', boundBusinessOwner: ownerDomain,
    repositories: [repository], execute(context) {
      const repo = context.repository(repository.repositoryId);
      const current = sortedRows(scopes.flatMap(scope => repo.invoke('scope', {
        owner_domain: scope.ownerDomain, owner_scope_type: scope.scopeType, owner_scope_id: scope.scopeId,
      })).filter(row => row.state === 'controlled'));
      if (canonicalDigest(current) !== expectedDigest)
        fail('SCOPED_CONTROL_RELEASE_STALE', 'Current Control no longer exactly matches the frozen release set.');
      return expectedDigest;
    } };
  if (!rows.length) return Object.freeze({ validationParticipant, controlParticipant: null, count: 0, scopeDigest: controlScopeDigest([]) });
  const changes = rows.map(row => ({ action: 'release', identity: {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion: 2,
    materialKey: row.material_key, mountScopeId: row.mount_scope_id, inode: row.inode, sizeBytes: row.size_bytes,
    fingerprintAlgorithm: row.fingerprint_algorithm, fingerprintVersion: Number(row.fingerprint_version), contentFingerprint: row.content_fingerprint,
  }, expectedRevision: row.control_revision, expectedProjectionDigest: projectMaterialControlRow(row.material_key, row).projectionDigest,
  fromScope: { ownerDomain, scopeType: row.owner_scope_type, scopeId: row.owner_scope_id }, toScope: null }));
  const scopeDigest = controlScopeDigest(changes);
  const handle = { schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1', schemaVersion: 1,
    handleId: commitMarker, ownerDomain, processType, processId, operationKind: 'release',
    basisRef: { objectType: processType, objectId: processId, revision: 1, digest: evidenceDigest },
    basisDigest: evidenceDigest, canonicalFactSetDigest: evidenceDigest, bindingSetDigest: expectedDigest,
    controlScopeDigest: scopeDigest, expectedControlRevisions: rows.map(row => ({ materialKey: row.material_key, revision: row.control_revision })),
    eventFenceDigest: evidenceDigest, receiptContract: { receiptSchemaRef, controlRevisionSetSchemaRef: 'foundation.scoped-control-release-set@1' } };
  return Object.freeze({ validationParticipant,
    controlParticipant: createMaterialControlParticipant({ schemaManifest: options.schemaManifest, handle, changes, commitMarker }),
    count: rows.length, scopeDigest });
}

module.exports = Object.freeze({ createScopedControlRelease });
