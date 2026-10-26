'use strict';

const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFormationRetirementStore, createFreshResetWorkspaceArchive } = require('../src/helix/domains/libra/public');
const { createArcaFormationRetirementStore, createFreshResetSeriesNormalization } = require('../src/helix/domains/arca/public');
const { createFreshResetFieldNormalization } = require('../src/helix/domains/procurement/public');

function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }

// Run only on the isolated retained generation. The copy already discarded
// uncommitted Runs; the existing Owner command retires each remaining intake
// root without changing terminal Runs or releasing collection Control.
function normalizeRetainedSubjects({ Database, targetPath, schemaManifest, schemaDdl,
  generationId, backupDigest, manifestDigest, assertIsolated, seriesRetention }) {
  if (![generationId, backupDigest, manifestDigest].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      typeof assertIsolated !== 'function') fail('RESET_NORMALIZATION_INPUT_INVALID');
  assertIsolated(targetPath);
  const read = new Database(targetPath, { readonly: true, fileMustExist: true });
  let subjects, workspaceIds;
  try {
    if (read.prepare("SELECT 1 FROM libra_runs WHERE state IN ('active','suspended','frozen') LIMIT 1").get())
      fail('RESET_RETAINED_UNCOMMITTED_RUN');
    if (read.prepare('SELECT 1 FROM libra_predeck_pipeline_tokens LIMIT 1').get() ||
        read.prepare('SELECT 1 FROM libra_workshop_placements LIMIT 1').get()) fail('RESET_RETAINED_ADMISSION_OCCUPANCY');
    subjects = read.prepare("SELECT subject_id FROM libra_subjects WHERE status='active' ORDER BY subject_id").all();
    workspaceIds = read.prepare('SELECT workspace_id FROM libra_workspaces ORDER BY workspace_id').all();
  } finally { read.close(); }
  const kernel = openSqliteKernel({ Database, databasePath: targetPath, schemaManifest, schemaDdl });
  try {
    const unitOfWork = createSqliteUnitOfWork({ kernel }), dependencies = { unitOfWork, schemaManifest };
    const fields = createFreshResetFieldNormalization(dependencies)({ generationId });
    const shared = seriesRetention ? createFreshResetSeriesNormalization(dependencies)(seriesRetention) : null;
    const arca = createArcaFormationRetirementStore(dependencies);
    const libra = createFormationRetirementStore({ ...dependencies, readArcaRetirementProof: arca.readRetirementProof });
    const receipts = [];
    for (const { subject_id: subjectId } of subjects) {
      assertIsolated(targetPath);
      const before = libra.inspect(subjectId);
      const proof = arca.readRetirementProof(before.packages.map(row => ({
        offerId: row.offer_id, packageId: row.on_deck_package_id, packageDigest: row.package_digest,
      })));
      if (!proof.length || proof.some(row => row.disposition !== 'committed'))
        fail('RESET_RETAINED_SUBJECT_WITHOUT_COLLECTION', { subjectId });
      const result = libra.commit({ retirementId: generationId, subjectId,
        expectedSnapshotDigest: before.snapshotDigest, backupDigest, manifestDigest,
        retiringRunIds: [], expectedControls: [], expectedArcaProofDigest: canonicalDigest(proof) });
      receipts.push({ subjectId, receiptDigest: canonicalDigest(result.receipt) });
    }
    const archive = createFreshResetWorkspaceArchive({ ...dependencies, assertIsolated: () => assertIsolated(targetPath) });
    const workspaceArchives = workspaceIds.map(({ workspace_id: workspaceId }) => ({ workspaceId,
      receiptDigest: canonicalDigest(archive.archive({ workspaceId, generationId, backupDigest, manifestDigest }).receipt) }));
    return { schemaRef: 'formation-reset-normalization@1', generationId, retiredSubjectCount: receipts.length, receipts, shared, fields, workspaceArchives };
  } finally { kernel.close(); }
}

module.exports = Object.freeze({ normalizeRetainedSubjects });
