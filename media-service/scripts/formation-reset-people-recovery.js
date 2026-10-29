'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { fileDigest } = require('./formation-reset-generation');
const { digestResetSnapshot } = require('./formation-reset-snapshot-digest');
const { digestRows } = require('./formation-reset-verify');
const { verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { describePeopleReferenceRetention, assertPeopleReferenceArtifact, verifyRetainedPeopleReferences } = require('./formation-reset-people-references');
const { writeAtomic } = require('../src/clean-runtime-operations');
const SHA = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function closed(file) {
  for (const suffix of ['-wal', '-journal']) if (fs.existsSync(file + suffix) && fs.statSync(file + suffix).size)
    fail('PEOPLE_RECOVERY_DATABASE_NOT_COLD');
}
function syncDirectory(directory) {
  if (process.platform !== 'linux') return;
  const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function copy(source, target, digest) {
  if (fs.existsSync(target) || fileDigest(source) !== digest) fail('PEOPLE_RECOVERY_COPY_CHANGED');
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  const fd = fs.openSync(target, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fileDigest(target) !== digest) fail('PEOPLE_RECOVERY_COPY_CHANGED');
}
function physical(root, dependency, record) {
  if (!path.isAbsolute(root) || fs.lstatSync(root).isSymbolicLink() || fs.realpathSync.native(root) !== root)
    fail('PEOPLE_RECOVERY_PHYSICAL_REFERENCE_INVALID');
  const file = path.join(root, dependency.artifactHandleId), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== record.size_bytes ||
      fileDigest(file) !== record.digest_hex) fail('PEOPLE_RECOVERY_PHYSICAL_REFERENCE_INVALID');
}
function readOnly(Database, file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only=ON'); db.exec('BEGIN'); return db;
}
function release(db) { if (db?.inTransaction) db.exec('ROLLBACK'); db?.close(); }

// Correct only missing, still-required registration facts from the exact
// pre-Reset source. This never selects a new portrait, recomputes a feature,
// drops post-Resume work or overwrites an existing registration.
function preparePeopleReferenceRecovery({ Database, originalPrivatePath, currentPrivatePath, candidatePath,
  originalDigest, currentDigest, expectedCount, expectedHandlesDigest, expectedReferenceDigest,
  schemaManifest, schemaDdl, assertClosed, checkpoint = () => {} }) {
  if (typeof assertClosed !== 'function' || ![originalPrivatePath, currentPrivatePath, candidatePath].every(path.isAbsolute) ||
      new Set([originalPrivatePath, currentPrivatePath, candidatePath]).size !== 3 ||
      ![originalDigest, currentDigest, expectedHandlesDigest, expectedReferenceDigest].every(value => SHA.test(value || '')) ||
      !Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 4096) fail('PEOPLE_RECOVERY_INPUT_INVALID');
  assertClosed(); closed(originalPrivatePath); closed(currentPrivatePath);
  if (fileDigest(originalPrivatePath) !== originalDigest || fileDigest(currentPrivatePath) !== currentDigest)
    fail('PEOPLE_RECOVERY_SOURCE_CHANGED');
  const original = readOnly(Database, originalPrivatePath), current = readOnly(Database, currentPrivatePath);
  let records, dependencies, before, peopleRoot;
  try {
    const source = describePeopleReferenceRetention(original), selected = describePeopleReferenceRetention(current);
    if (source.digest !== selected.digest || selected.referenceDigest !== expectedReferenceDigest)
      fail('PEOPLE_RECOVERY_REFERENCE_CHANGED');
    const root = current.prepare("SELECT * FROM platform_workspace_roots WHERE root_id='service-people-reference-artifacts'").get();
    const oldRoot = original.prepare("SELECT * FROM platform_workspace_roots WHERE root_id='service-people-reference-artifacts'").get();
    if (!root || root.state !== 'active' || root.owner_scope !== 'platform-settings' || root.root_kind !== 'internal-artifact' ||
        root.resolved_root !== oldRoot?.resolved_root) fail('PEOPLE_RECOVERY_ROOT_CHANGED');
    peopleRoot = root.resolved_root;
    const find = current.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id=?');
    const old = original.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id=?');
    dependencies = []; records = [];
    for (const dependency of selected.artifacts) {
      const existing = find.get(dependency.artifactHandleId);
      if (existing) { assertPeopleReferenceArtifact(existing, dependency); continue; }
      if (dependency.artifactKind !== 'reference-embedding' || !dependency.active) fail('PEOPLE_RECOVERY_SCOPE_INVALID');
      const record = old.get(dependency.artifactHandleId);
      assertPeopleReferenceArtifact(record, dependency); physical(peopleRoot, dependency, record);
      dependencies.push(dependency); records.push(record);
    }
    if (records.length !== expectedCount || canonicalDigest(dependencies.map(row => row.artifactHandleId)) !== expectedHandlesDigest)
      fail('PEOPLE_RECOVERY_SCOPE_CHANGED');
    before = digestResetSnapshot(current);
  } finally { release(current); release(original); }
  assertClosed(); copy(currentPrivatePath, candidatePath, currentDigest); checkpoint('candidate_copied');
  const candidate = new Database(candidatePath);
  try {
    candidate.pragma('foreign_keys=ON'); candidate.pragma('synchronous=FULL');
    const columns = candidate.pragma('table_info(fx_artifact_registry)').map(row => row.name);
    if (columns.some(column => !/^[a-z_]+$/.test(column)) || records.some(record =>
      Object.keys(record).sort().join(',') !== [...columns].sort().join(','))) fail('PEOPLE_RECOVERY_SCHEMA_CHANGED');
    const insert = candidate.prepare('INSERT INTO fx_artifact_registry (' + columns.map(c => '"' + c + '"').join(',') +
      ') VALUES (' + columns.map(() => '?').join(',') + ')');
    candidate.transaction(() => { for (const record of records) insert.run(...columns.map(column => record[column])); })();
  } finally { candidate.close(); }
  checkpoint('dependencies_restored');
  const target = readOnly(Database, candidatePath), source = readOnly(Database, originalPrivatePath);
  let after, peopleReferences, integrity, readableImages = 0, readableEmbeddings = 0;
  try {
    integrity = verifyReadOnlySqliteSnapshot({ database: target, schemaManifest, schemaDdl });
    peopleReferences = verifyRetainedPeopleReferences(source, target);
    readableImages = peopleReferences.readableImages; readableEmbeddings = peopleReferences.readableEmbeddings;
    after = digestResetSnapshot(target);
    if (before.catalogDigest !== after.catalogDigest || before.tables.length !== after.tables.length)
      fail('PEOPLE_RECOVERY_OTHER_FACTS_CHANGED');
    for (const table of before.tables) {
      const actual = after.tables.find(row => row.table === table.table);
      if (table.table === 'fx_artifact_registry') {
        const ids = dependencies.map(row => row.artifactHandleId);
        const untouched = digestRows(target.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id NOT IN (' +
          ids.map(() => '?').join(',') + ') ORDER BY artifact_handle_id').safeIntegers().iterate(...ids));
        if (actual.count !== table.count + records.length || untouched.count !== table.count || untouched.digest !== table.digest)
          fail('PEOPLE_RECOVERY_OTHER_FACTS_CHANGED');
        for (const record of records) if (canonicalDigest(target.prepare('SELECT * FROM fx_artifact_registry WHERE artifact_handle_id=?')
          .get(record.artifact_handle_id)) !== canonicalDigest(record)) fail('PEOPLE_RECOVERY_RESTORED_FACT_CHANGED');
      } else if (canonicalDigest(actual) !== canonicalDigest(table)) fail('PEOPLE_RECOVERY_OTHER_FACTS_CHANGED');
    }
  } finally { release(source); release(target); }
  assertClosed(); closed(candidatePath);
  for (let index = 0; index < records.length; index++) physical(peopleRoot, dependencies[index], records[index]);
  const body = { schemaRef: 'people.preserved-reference-recovery@1', originalDigest, currentDigest, candidatePath,
    candidateDigest: fileDigest(candidatePath), expectedHandlesDigest, expectedReferenceDigest, recoveredCount: records.length,
    recoveredArtifactIds: dependencies.map(row => row.artifactHandleId), recoveredRowsDigest: canonicalDigest(records),
    beforeSnapshotDigest: before.digest, afterSnapshotDigest: after.digest, unchangedTables: before.tables.length - 1,
    peopleReferences, readableImages, readableEmbeddings, integrity };
  checkpoint('candidate_verified');
  return { ...body, proofDigest: canonicalDigest(body) };
}

// The deploy controller has removed the stopped business container. Its
// native lease and durable Stop proof remain required through publication.
// The original completed Reset marker/receipt stays immutable: this adds the
// missing dependencies within that generation, with a separate repair receipt.
function publishPeopleReferenceRecovery({ activePath, stagedPath, previousPath, journalPath, proof, assertClosed,
  checkpoint = () => {} }) {
  const { proofDigest, ...body } = proof;
  if (canonicalDigest(body) !== proofDigest || ![activePath, stagedPath, previousPath, journalPath].every(path.isAbsolute) ||
      path.dirname(activePath) !== path.dirname(stagedPath) || path.dirname(activePath) !== path.dirname(previousPath) ||
      new Set([activePath, stagedPath, previousPath, journalPath]).size !== 4 || typeof assertClosed !== 'function')
    fail('PEOPLE_RECOVERY_PUBLICATION_INVALID');
  assertClosed();
  const request = { schemaRef: 'people.preserved-reference-publication@1', activePath, stagedPath, previousPath,
    proofDigest, sourceDigest: proof.currentDigest, candidateDigest: proof.candidateDigest };
  const requestDigest = canonicalDigest(request);
  function save(phase, extra = {}) {
    const value = { request, requestDigest, phase, ...extra };
    writeAtomic(journalPath, { ...value, recordDigest: canonicalDigest(value) }); syncDirectory(path.dirname(journalPath));
  }
  let state;
  if (fs.existsSync(journalPath)) {
    const { recordDigest, ...value } = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (canonicalDigest(value) !== recordDigest || value.requestDigest !== requestDigest ||
        !['prepared', 'switching', 'complete'].includes(value.phase)) fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
    state = value;
  } else {
    closed(activePath); closed(stagedPath);
    if (fs.existsSync(previousPath) || fileDigest(activePath) !== proof.currentDigest || fileDigest(stagedPath) !== proof.candidateDigest)
      fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
    // A closed SQLite Host normally removes SHM. Never silently discard a
    // surprising companion during the narrow recovery publication.
    if (['-wal', '-shm', '-journal'].some(suffix => fs.existsSync(activePath + suffix))) fail('PEOPLE_RECOVERY_COMPANION_PRESENT');
    save('prepared'); state = { phase: 'prepared' }; checkpoint('publication_prepared');
  }
  if (state.phase === 'complete') {
    if (fileDigest(activePath) !== proof.candidateDigest || fileDigest(previousPath) !== proof.currentDigest)
      fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
    return { complete: true, proofDigest, requestDigest };
  }
  save('switching'); assertClosed();
  if (!fs.existsSync(previousPath)) {
    if (fileDigest(activePath) !== proof.currentDigest || fileDigest(stagedPath) !== proof.candidateDigest)
      fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
    fs.renameSync(activePath, previousPath); syncDirectory(path.dirname(activePath)); checkpoint('previous_database_preserved');
  }
  if (fileDigest(previousPath) !== proof.currentDigest) fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
  if (!fs.existsSync(activePath)) {
    if (fileDigest(stagedPath) !== proof.candidateDigest) fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
    fs.renameSync(stagedPath, activePath); syncDirectory(path.dirname(activePath)); checkpoint('recovered_database_published');
  }
  if (fileDigest(activePath) !== proof.candidateDigest) fail('PEOPLE_RECOVERY_PUBLICATION_CHANGED');
  assertClosed(); save('complete'); checkpoint('publication_complete');
  return { complete: true, proofDigest, requestDigest };
}

module.exports = Object.freeze({ preparePeopleReferenceRecovery, publishPeopleReferenceRecovery });
