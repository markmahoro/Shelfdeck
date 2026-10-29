'use strict';

const fs = require('node:fs'), path = require('node:path');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { fileDigest } = require('./formation-reset-generation');
const { writeAtomic } = require('../src/clean-runtime-operations');
const { readColdResetState } = require('../src/clean-reset-generation-fence');
const { verifyBackupFiles } = require('./formation-reset-backup');
const { stageResetDatabase } = require('./formation-reset-stage');
const { buildStorageBudget } = require('./formation-reset-storage');
const { preparePeopleReferenceRecovery, publishPeopleReferenceRecovery } = require('./formation-reset-people-recovery');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function real(value, directory = true) {
  if (!path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) fail('PEOPLE_RECOVERY_PATH_UNSAFE');
  const stat = fs.lstatSync(value);
  if (stat.isSymbolicLink() || fs.realpathSync.native(value) !== value ||
      (directory ? !stat.isDirectory() : !stat.isFile())) fail('PEOPLE_RECOVERY_PATH_UNSAFE');
}
function read(file) { real(file, false); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function signed(file, key) {
  const { [key]: digest, ...body } = read(file);
  if (canonicalDigest(body) !== digest) fail('PEOPLE_RECOVERY_RECORD_CHANGED');
  return body;
}
function save(file, body) { writeAtomic(file, { ...body, recordDigest: canonicalDigest(body) }); }

async function runPeopleReferenceRecovery(request) {
  if (request?.schema !== 'shelfdeck.people-reference-recovery-request@1' ||
      Object.keys(request).sort().join(',') !== 'closure,dataDir,deploymentBackupReceiptFile,operationRoot,schema,scope' ||
      request.closure?.schema !== 'shelfdeck.deployment-closure@1' || request.closure.oldContainerRemoved !== true ||
      !Array.isArray(request.closure.remainingDataMounts) || request.closure.remainingDataMounts.length ||
      !/^[a-f0-9]{64}$/.test(request.closure.stopOperationId || '') ||
      request.scope?.schema !== 'shelfdeck.people-reference-recovery@1' ||
      !/^[a-f0-9]{64}$/.test(request.scope.resetGeneration || '')) fail('PEOPLE_RECOVERY_AUTHORITY_INVALID');
  const { dataDir, operationRoot, closure, scope } = request;
  real(dataDir); real(operationRoot);
  if (request.deploymentBackupReceiptFile !== path.join(operationRoot, 'deployment-backup-receipt.json'))
    fail('PEOPLE_RECOVERY_AUTHORITY_INVALID');
  const operationId = canonicalDigest({ closure, scope });
  const directory = path.join(operationRoot, 'people-reference-recovery-' + operationId);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 }); real(directory);
  const temporaryRoot = path.join(directory, 'sqlite-temp');
  if (!fs.existsSync(temporaryRoot)) fs.mkdirSync(temporaryRoot, { mode: 0o700 }); real(temporaryRoot);
  const environment = Object.fromEntries(['SQLITE_TMPDIR', 'TMPDIR', 'TMP', 'TEMP'].map(name => [name, process.env[name]]));
  for (const name of Object.keys(environment)) process.env[name] = temporaryRoot;
  let lease;
  try {
    const Database = require('better-sqlite3');
    lease = require('../src/clean-generation-lease').acquireGenerationLease({ dataDir, Database });
    const markerPath = path.join(dataDir, 'database-generation.json'), markerDigest = fileDigest(markerPath);
    const fencePath = path.join(dataDir, 'operator-runtime', 'generation-fence.json'), fenceDigest = fileDigest(fencePath);
    function assertClosed() {
      lease.assertHeld();
      const intent = read(path.join(dataDir, 'operator-runtime', 'intent.json'));
      const stop = read(path.join(dataDir, 'operator-runtime', closure.stopOperationId + '.json'));
      const state = readColdResetState(dataDir);
      if (intent.desiredMode !== 'stopped' || intent.pendingReset || intent.revision !== closure.runtimeRevision ||
          canonicalDigest(intent) !== closure.intentDigest || canonicalDigest(stop) !== closure.stopReceiptDigest ||
          stop.kind !== 'stop' || stop.state !== 'completed' || stop.result?.mode !== 'stopped' ||
          state?.fence.phase !== 'complete' || state.fence.generationId !== scope.resetGeneration ||
          fileDigest(markerPath) !== markerDigest || fileDigest(fencePath) !== fenceDigest)
        fail('PEOPLE_RECOVERY_STOP_CHANGED');
    }
    assertClosed();
    const reset = read(path.join(dataDir, 'operator-runtime', 'generation-' + scope.resetGeneration + '-result.json'));
    if (canonicalDigest(reset) !== readColdResetState(dataDir).fence.receiptDigest || reset.phase !== 'complete')
      fail('PEOPLE_RECOVERY_RESET_RECEIPT_CHANGED');
    const originalManifest = read(scope.originalManifestFile);
    if (canonicalDigest({ manifest: originalManifest, backupRoot: scope.originalBackupRoot }) !== reset.backupDigest ||
        reset.sourceDigest !== scope.originalSourceDigest) fail('PEOPLE_RECOVERY_ORIGINAL_BACKUP_INVALID');
    const originalEntry = originalManifest.entries.find(row => row.root === 'data' && row.relative === 'shelfdeck.db');
    if (originalEntry?.sha256 !== reset.sourceDigest) fail('PEOPLE_RECOVERY_ORIGINAL_BACKUP_INVALID');
    const originalPath = path.join(scope.originalBackupRoot, 'data', 'shelfdeck.db');
    const backup = signed(request.deploymentBackupReceiptFile, 'receiptDigest');
    if (backup.schema !== 'shelfdeck.deployment-backup@1' || backup.closureDigest !== canonicalDigest(closure) ||
        backup.manifestFile !== path.join(operationRoot, 'deployment-backup-manifest.json')) fail('PEOPLE_RECOVERY_CURRENT_BACKUP_INVALID');
    const manifest = read(backup.manifestFile);
    const currentEntry = manifest.entries.find(row => row.root === 'data' && row.relative === 'shelfdeck.db');
    if (!currentEntry || !manifest.sources.some(row => row.id === 'data' && row.path === dataDir))
      fail('PEOPLE_RECOVERY_CURRENT_BACKUP_INVALID');
    verifyBackupFiles({ targetRoot: backup.backup.targetRoot, manifest });
    const currentPath = path.join(backup.backup.targetRoot, 'data', 'shelfdeck.db');
    const budget = buildStorageBudget({ allocations: [
      { directory: operationRoot, purpose: 'reference-recovery-private-sources-candidate-and-retry',
        bytes: BigInt(originalEntry.bytes) + BigInt(currentEntry.bytes) * 5n },
      { directory: dataDir, purpose: 'reference-recovery-same-volume-staging-and-retry', bytes: BigInt(currentEntry.bytes) * 2n },
    ], reserveBytes: 256n * 1024n * 1024n });
    if (!budget.ready) fail('PEOPLE_RECOVERY_SPACE_INSUFFICIENT');
    const originalPrivatePath = path.join(directory, 'original-source.db'), currentPrivatePath = path.join(directory, 'current-source.db');
    for (const [purpose, sourcePath, stagePath, digest] of [
      ['original', originalPath, originalPrivatePath, originalEntry.sha256],
      ['current', currentPath, currentPrivatePath, currentEntry.sha256],
    ]) stageResetDatabase({ sourcePath, stagePath, journalPath: path.join(directory, purpose + '-copy.json'),
      generationId: canonicalDigest({ operationId, purpose }), candidateDigest: digest, assertStopped: assertClosed });
    const preparation = path.join(directory, 'preparation.json');
    let proof;
    if (fs.existsSync(preparation)) proof = signed(preparation, 'recordDigest');
    else {
      const attemptFile = path.join(directory, 'attempt.json');
      const attempt = fs.existsSync(attemptFile) ? signed(attemptFile, 'recordDigest').attempt + 1 : 1;
      if (!Number.isSafeInteger(attempt) || attempt < 1) fail('PEOPLE_RECOVERY_RECORD_CHANGED');
      save(attemptFile, { attempt });
      const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
      proof = preparePeopleReferenceRecovery({ Database, originalPrivatePath, currentPrivatePath,
        candidatePath: path.join(directory, 'candidate-attempt-' + attempt + '.db'),
        originalDigest: originalEntry.sha256, currentDigest: currentEntry.sha256,
        expectedCount: scope.expectedCount, expectedHandlesDigest: scope.expectedHandlesDigest,
        expectedReferenceDigest: scope.expectedReferenceDigest, schemaManifest,
        schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8'), assertClosed });
      save(preparation, proof);
    }
    const { proofDigest, ...proofBody } = proof;
    if (canonicalDigest(proofBody) !== proofDigest || proof.currentDigest !== currentEntry.sha256 ||
        proof.originalDigest !== originalEntry.sha256 || proof.expectedHandlesDigest !== scope.expectedHandlesDigest ||
        proof.expectedReferenceDigest !== scope.expectedReferenceDigest || proof.recoveredCount !== scope.expectedCount ||
        fileDigest(proof.candidatePath) !== proof.candidateDigest) fail('PEOPLE_RECOVERY_PREPARATION_CHANGED');
    const activePath = path.join(dataDir, 'shelfdeck.db'), stagedPath = path.join(dataDir, '.people-reference-stage-' + operationId + '.db');
    const publicationJournal = path.join(directory, 'publication.json');
    if (!fs.existsSync(publicationJournal)) {
      if (fileDigest(activePath) !== currentEntry.sha256) fail('PEOPLE_RECOVERY_ACTIVE_CHANGED');
      stageResetDatabase({ sourcePath: proof.candidatePath, stagePath: stagedPath,
        journalPath: path.join(directory, 'staging.json'), generationId: operationId,
        candidateDigest: proof.candidateDigest, assertStopped: assertClosed });
    }
    const publication = publishPeopleReferenceRecovery({ activePath, stagedPath,
      previousPath: path.join(dataDir, '.people-reference-previous-' + operationId + '.db'),
      journalPath: publicationJournal, proof, assertClosed });
    assertClosed();
    if (fileDigest(originalPath) !== originalEntry.sha256 || fileDigest(currentPath) !== currentEntry.sha256)
      fail('PEOPLE_RECOVERY_BACKUP_CHANGED');
    const receipt = { schemaRef: 'people.preserved-reference-recovery-receipt@1', operationId,
      databaseGeneration: scope.resetGeneration, desiredMode: 'stopped', state: 'completed',
      closureDigest: canonicalDigest(closure), currentBackupDigest: canonicalDigest(read(request.deploymentBackupReceiptFile)),
      originalBackupDigest: reset.backupDigest, markerDigest, fenceDigest, proof, publication };
    const receiptFile = path.join(directory, 'receipt.json');
    if (fs.existsSync(receiptFile) && canonicalDigest(signed(receiptFile, 'recordDigest')) !== canonicalDigest(receipt))
      fail('PEOPLE_RECOVERY_RECEIPT_CHANGED');
    save(receiptFile, receipt);
    return { state: 'completed', desiredMode: 'stopped', operationId, databaseGeneration: scope.resetGeneration,
      recoveredCount: proof.recoveredCount, unchangedTables: proof.unchangedTables, proofDigest: proof.proofDigest,
      receiptDigest: canonicalDigest(receipt), candidateDigest: proof.candidateDigest };
  } finally {
    lease?.close();
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

if (require.main === module) Promise.resolve().then(() => runPeopleReferenceRecovery(read(process.argv[2])))
  .then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^[A-Z][A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'PEOPLE_RECOVERY_FAILED'); process.exitCode = 1;
  });
module.exports = Object.freeze({ runPeopleReferenceRecovery });
