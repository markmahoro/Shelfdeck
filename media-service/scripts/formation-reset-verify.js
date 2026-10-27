'use strict';

const { createHash } = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createProductDeliveryReader } = require('../src/helix/domains/libra/persistence/product-delivery-reader');
const { createOnDeckStore } = require('../src/helix/domains/arca/persistence/on-deck-store');
const { describeFreshResetSeriesRetention } = require('../src/helix/domains/arca/public');
const { readResetOwnerSnapshotDatabase } = require('./formation-reset-owner-snapshot');
const { verifyRetainedControls } = require('./formation-reset-responsibilities');
const { verifyRetainedPeopleReferences } = require('./formation-reset-people-references');

function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }
function digestRows(rows) {
  const hash = createHash('sha256'); let count = 0;
  hash.update('[');
  for (const row of rows) {
    if (count) hash.update(',');
    const normalized = JSON.parse(JSON.stringify(row, (_key, value) =>
      typeof value === 'bigint' ? { sqliteInteger: value.toString() } : value));
    hash.update(canonicalJson(normalized)); count++;
  }
  hash.update(']');
  return { count, digest: hash.digest('hex') };
}
function exactRowDigest(rows) {
  return digestRows(rows).digest;
}

function verifySharedCollections(source, target) {
  const originalMetadata = readResetOwnerSnapshotDatabase(source).metadataRetention;
  const retainedMetadata = readResetOwnerSnapshotDatabase(target).metadataRetention;
  if (canonicalDigest(originalMetadata) !== canonicalDigest(retainedMetadata)) fail('RESET_VERIFY_SHARED_METADATA_CHANGED');
  const scopes = source.prepare('SELECT * FROM arca_series_presentation_scopes ORDER BY scope_id').all();
  const description = describeFreshResetSeriesRetention({ scopes,
    builds: source.prepare(`SELECT b.* FROM arca_series_presentation_builds b
      JOIN arca_series_presentation_scopes s ON s.active_build_id=b.build_id ORDER BY b.build_id`).all(),
    committedEntryIds: source.prepare('SELECT shelf_entry_id FROM arca_shelf_entries ORDER BY shelf_entry_id').all().map(row => row.shelf_entry_id) });
  const protectedIds = new Set(source.prepare('SELECT DISTINCT scope_id FROM arca_series_presentation_references').all().map(row => row.scope_id));
  for (const kept of description.preservedBuilders) protectedIds.add(kept.scopeId);
  const verified = [];
  for (const scopeId of [...protectedIds].sort()) {
    const before = scopes.find(row => row.scope_id === scopeId);
    const after = target.prepare('SELECT * FROM arca_series_presentation_scopes WHERE scope_id=?').get(scopeId);
    if (!before || !after) fail('RESET_VERIFY_SHARED_SCOPE_MISSING', { scopeId });
    const dropped = description.droppedHeads.find(row => row.scopeId === scopeId);
    const expected = { ...before };
    if (dropped) {
      expected.active_build_id = null; expected.state_revision++;
      expected.state_digest = canonicalDigest({ schema: 'arca.series-presentation-head@1', scopeId,
        revision: expected.state_revision, currentVersion: expected.current_version, activeBuildId: null,
        retirementScopeId: expected.retirement_scope_id ?? null });
      if (after.updated_at_ms < before.updated_at_ms) fail('RESET_VERIFY_SHARED_HEAD_CHANGED', { scopeId });
      expected.updated_at_ms = after.updated_at_ms;
    }
    if (canonicalDigest(expected) !== canonicalDigest(after)) fail('RESET_VERIFY_SHARED_HEAD_CHANGED', { scopeId });
    const query = 'SELECT * FROM arca_series_presentation_versions WHERE scope_id=? ORDER BY revision';
    const original = source.prepare(query).safeIntegers().all(scopeId), copied = target.prepare(query).safeIntegers().all(scopeId);
    if (exactRowDigest(original) !== exactRowDigest(copied)) fail('RESET_VERIFY_SHARED_VERSION_CHANGED', { scopeId });
    verified.push({ scopeId, versions: copied.length, headDigest: canonicalDigest(after), versionsDigest: exactRowDigest(copied) });
  }
  return { scopes: verified.length, digest: canonicalDigest(verified), descriptionDigest: description.digest,
    metadataDependencyCount: retainedMetadata.dependencies.length, metadataRetentionDigest: retainedMetadata.digest };
}
function readOnlyUnitOfWork(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_VERIFY_READONLY_REQUIRED');
  // Reuse Owner repositories and reconstruction rules on a fixed read-only
  // snapshot. The SQLite connection rejects writes even if a reader regresses.
  return createSqliteUnitOfWork({ kernel: { runPrimitive(operation) {
    return operation(Object.freeze({ commitTimeMs: 0, prepare: statement => database.prepare(statement) }));
  } } });
}

function verifyRetainedCollections({ Database, sourcePath, targetPath, schemaManifest, schemaDdl }) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let target;
  try {
    target = new Database(targetPath, { readonly: true, fileMustExist: true });
    source.exec('BEGIN'); target.exec('BEGIN');
    const integrity = verifyReadOnlySqliteSnapshot({ database: target, schemaManifest, schemaDdl });
    const controls = verifyRetainedControls(target);
    const peopleReferences = verifyRetainedPeopleReferences(source, target);
    // Collection identity, current and historical representation and file /
    // Person associations are all protected, not merely the two root counts.
    const roots = ['arca_shelf_entries', 'arca_ondeck_commit_receipts',
      'arca_canonical_identity_revisions', 'arca_deck_fact_revisions', 'arca_inventory_representations',
      'arca_inventory_materials', 'arca_inventory_product_facts', 'arca_inventory_person_relations',
      'arca_inventory_related_references', 'arca_series_presentation_references'];
    const protections = roots.map(table => {
      const columns = source.pragma('table_info(' + table + ')').filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
      const query = 'SELECT * FROM ' + table + ' ORDER BY ' + columns.join(',');
      // Compare the same canonical row-array bytes without materializing both
      // collection histories and their serialized strings in one V8 heap.
      const before = digestRows(source.prepare(query).safeIntegers().iterate());
      const after = digestRows(target.prepare(query).safeIntegers().iterate());
      if (before.count !== after.count || before.digest !== after.digest) fail('RESET_VERIFY_COLLECTION_CHANGED', { table });
      return { table, ...before };
    });
    const shared = verifySharedCollections(source, target);
    const packages = source.prepare(`SELECT DISTINCT p.on_deck_package_id,p.offer_id,p.package_revision,p.package_digest
      FROM arca_ondeck_commit_receipts c JOIN arca_ondeck_runs r ON r.on_deck_run_id=c.on_deck_run_id
      JOIN arca_ondeck_custodies k ON k.custody_id=r.custody_id
      LEFT JOIN libra_product_packages p ON p.on_deck_package_id=k.on_deck_package_id
      UNION SELECT DISTINCT p.on_deck_package_id,p.offer_id,p.package_revision,p.package_digest
      FROM arca_inventory_representations r LEFT JOIN libra_product_packages p ON p.on_deck_package_id=r.source_package_id
      UNION SELECT DISTINCT p.on_deck_package_id,p.offer_id,p.package_revision,p.package_digest
      FROM arca_inventory_product_facts f LEFT JOIN libra_product_packages p ON p.on_deck_package_id=f.source_package_id
      ORDER BY on_deck_package_id`).all();
    const beforeReader = createProductDeliveryReader({ schemaManifest, unitOfWork: readOnlyUnitOfWork(source) });
    const afterReader = createProductDeliveryReader({ schemaManifest, unitOfWork: readOnlyUnitOfWork(target) });
    const beforeArca = createOnDeckStore({ schemaManifest, unitOfWork: readOnlyUnitOfWork(source) });
    const afterArca = createOnDeckStore({ schemaManifest, unitOfWork: readOnlyUnitOfWork(target) });
    const arcaReferences = source.prepare(`SELECT k.on_deck_package_id,k.package_digest,k.custody_id,s.shelf_id
      FROM arca_ondeck_commit_receipts c JOIN arca_ondeck_runs r ON r.on_deck_run_id=c.on_deck_run_id
      JOIN arca_ondeck_custodies k ON k.custody_id=r.custody_id JOIN arca_shelf_entries s ON s.shelf_entry_id=c.shelf_entry_id
      ORDER BY c.receipt_id`).all();
    const ownership = [];
    for (const row of arcaReferences) {
      const query = { onDeckPackageId: row.on_deck_package_id, packageDigest: row.package_digest,
        custodyId: row.custody_id, shelfId: row.shelf_id };
      let before, after;
      try { before = beforeArca.readCommittedByPackage(query); }
      catch (error) { fail('RESET_VERIFY_SOURCE_COMMIT_UNREADABLE', { packageId: row.on_deck_package_id, causeCode: error.code }); }
      try { after = afterArca.readCommittedByPackage(query); }
      catch (error) { fail('RESET_VERIFY_TARGET_COMMIT_UNREADABLE', { packageId: row.on_deck_package_id, causeCode: error.code }); }
      if (!before || canonicalDigest(before) !== canonicalDigest(after)) fail('RESET_VERIFY_COMMIT_CHANGED');
      ownership.push(canonicalDigest(after));
    }
    const reconstructed = [];
    for (const row of packages) {
      if (!row.on_deck_package_id) fail('RESET_VERIFY_SOURCE_PACKAGE_MISSING');
      const query = { queryContract: 'libra.product-delivery@1', readPurpose: 'historical',
        offerId: row.offer_id, onDeckPackageId: row.on_deck_package_id,
        expectedPackageRevision: row.package_revision, expectedPackageDigest: row.package_digest };
      let before, after;
      try { before = beforeReader.readPackage(query); }
      catch (error) { fail('RESET_VERIFY_SOURCE_PACKAGE_UNREADABLE', { packageId: row.on_deck_package_id, causeCode: error.code }); }
      try { after = afterReader.readPackage(query); }
      catch (error) { fail('RESET_VERIFY_TARGET_PACKAGE_UNREADABLE', { packageId: row.on_deck_package_id, causeCode: error.code }); }
      if (before.resultKind !== 'found' || canonicalDigest(before) !== canonicalDigest(after))
        fail('RESET_VERIFY_PACKAGE_CHANGED', { packageId: row.on_deck_package_id });
      reconstructed.push({ packageId: row.on_deck_package_id, digest: canonicalDigest(after) });
    }
    return { schemaRef: 'formation-reset-collection-verification@1', integrity, controls, protections, shared, peopleReferences,
      reconstructedCommits: ownership.length, ownershipDigest: canonicalDigest(ownership),
      reconstructedPackages: reconstructed.length, packageReadDigest: canonicalDigest(reconstructed) };
  } finally {
    for (const database of [target, source]) {
      if (database?.inTransaction) database.exec('ROLLBACK');
      database?.close();
    }
  }
}

module.exports = Object.freeze({ verifyRetainedCollections, digestRows });
