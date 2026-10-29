'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('../src/helix/contracts/canonical-json');
const { verifyFreshResetCatalogueRegistration } = require('../src/helix/domains/people/public');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function describe(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_VERIFY_READONLY_REQUIRED');
  const hasOrigins = !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='people_us_adult_catalogue_registration_origins'").get();
  const revisions = database.prepare("SELECT * FROM people_person_revisions WHERE revision=1 AND origin_kind='catalogue_auto' ORDER BY person_id");
  const hash = crypto.createHash('sha256'); hash.update('['); let count = 0;
  const get = (table, key, value) => database.prepare('SELECT * FROM ' + table + ' WHERE ' + key + '=?').get(value);
  for (const revision of revisions.iterate()) {
    if (!hasOrigins) fail('RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID');
    const origin = get('people_us_adult_catalogue_registration_origins', 'person_id', revision.person_id), id = origin?.decision_id,
      decision = (() => { try { return JSON.parse(origin?.decision_json || 'null'); } catch { return null; } })();
    if (!origin || !decision?.initialReference?.referenceAssetId || !decision.initialReference.referenceFaceId)
      fail('RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID');
    let proof;
    try { proof = verifyFreshResetCatalogueRegistration({ revision, origin,
      operation: get('people_image_operations', 'operation_id', origin?.operation_id),
      referenceRevision: database.prepare('SELECT * FROM people_reference_revisions WHERE person_id=? AND revision=1').get(revision.person_id),
      asset: get('people_reference_assets', 'reference_asset_id', decision?.initialReference?.referenceAssetId),
      face: get('people_reference_faces', 'reference_face_id', decision?.initialReference?.referenceFaceId),
      receipt: get('fx_command_receipts', 'command_receipt_id', 'people-catalogue-registration-' + id),
      audit: get('fx_audit_records', 'audit_id', 'people-catalogue-audit-' + id),
      marker: get('fx_commit_markers', 'commit_marker', 'people-catalogue-registration-' + id) }); }
    catch (error) { if (error.code === 'PEOPLE_RESET_CATALOGUE_EVIDENCE_INVALID') throw Object.assign(new Error('RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID'), { code: 'RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID', cause: error }); throw error; }
    if (count++) hash.update(','); hash.update(canonicalJson(proof));
  }
  if (hasOrigins && database.prepare('SELECT count(*) n FROM people_us_adult_catalogue_registration_origins').get().n !== count)
    fail('RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID');
  hash.update(']'); return { count, digest: hash.digest('hex') };
}
function verifyRetainedCatalogueRegistrations(source, target) {
  const before = describe(source), after = describe(target);
  if (before.count !== after.count || before.digest !== after.digest) fail('RESET_VERIFY_CATALOGUE_EVIDENCE_CHANGED');
  return before;
}
module.exports = Object.freeze({ describeFreshResetCatalogueRegistrations: describe, verifyRetainedCatalogueRegistrations });
