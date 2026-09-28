'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const {
  migrateUatIdentitySelectionSchema,
  PRE_DEFECT_ADMISSION_SCHEMA_DIGEST,
  TARGET_SCHEMA_DIGEST,
} = require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
const {
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
  coversRequirementGaps,
  resolveProductSelection,
} = require('../../src/helix/domains/libra/model/defect-admission-contracts');
const {
  acceptsProductionAttestation,
} = require('../../src/helix/domains/arca/model/authorized-defect-manifest');
const { projectHealth } = require('../../src/helix/domains/arca/model/aftercare-contract');
const { applyRunLifecycleDecision, buildRunLifecycleDecision } = require(
  '../../src/helix/domains/libra/model/run-lifecycle-contracts');

const D = (value) => canonicalDigest({ value });
function frozen() {
  return Object.freeze({ libraRunId:'run-119', state:'frozen', stateRevision:3,
    stateDigest:D('frozen') });
}
function terminal(failureCode, capabilityRef = 'libra.product_metadata.fetch@1') {
  const work = Object.freeze({ workId:'work-119', failureCode, capabilityRef,
    failureClass:'business_unachievable', terminalEvidenceDigest:D(failureCode) });
  const body = { blockedWorks:[work] };
  return Object.freeze({ ...body, evidenceDigest:canonicalDigest(body) });
}
function authorize(candidate) {
  return buildAuthorizedDefectManifest({ candidate, actorId:'admin',
    idempotencyKey:'uat-126', acknowledged:true, decidedAtMs:119 });
}
function sizeVerification(overrides = {}) {
  return Object.freeze({ libraRunId:'run-119',candidateKind:'workspace_output',
    result:'failed',reasonCodes:Object.freeze(['max_size_exceeded']),
    verificationId:D('size-verification'),candidateBasisDigest:D('size-candidate'),
    productMaterialHandleId:'workspace-product-1',productMaterialHandleDigest:D('workspace-product'),
    productMaterialFenceDigest:D('workspace-fence'),workspaceMediaHandleId:'workspace-media-1',
    spaceSummary:{actualSizeBytes:22,maxSizeBytes:14,withinLimit:false},...overrides });
}

test('UAT-126 admits an evidenced actor absence but preserves the unmet fact', () => {
  const candidate = buildDefectAdmissionCandidate({ run:frozen(),
    terminalEvidence:terminal('product_metadata_required_cast_missing') });
  assert.deepEqual(candidate.waivedRequirementCodes, ['metadata_field_unmet']);
  const manifest = authorize(candidate);
  assert.equal(coversRequirementGaps(manifest, ['metadata_field_unmet']), true);
  assert.equal(coversRequirementGaps(manifest, []), false);
  assert.equal(acceptsProductionAttestation({ acceptanceKind:'accepted_with_defects',
    unmetRequirementCount:1, unmetRequirementCodes:['metadata_field_unmet'],
    authorizedDefectManifest:manifest }), true);
  const current = Object.freeze({ ...frozen(), acceptanceSpecId:'spec-119',
    executionBasisDigest:D('basis'), runScopeDigest:D('scope'), priorityClass:'normal',
    priorityIntentDigest:D('priority'), recoveryAttemptOrdinal:5 });
  const decision = buildRunLifecycleDecision({ libraRunId:'run-119',
    expectedStateRevision:3, expectedStateDigest:current.stateDigest,
    transitionKind:'defect_admit', transitionEvidence:manifest,
    expectedAdmissionHeadRevision:1, expectedActiveScopeSetDigest:D('head') });
  const resumed = applyRunLifecycleDecision(current, decision);
  assert.deepEqual({ state:resumed.state, revision:resumed.stateRevision,
    transitionKind:resumed.transitionKind },
  { state:'active', revision:4, transitionKind:'defect_admitted' });
});

test('UAT-251 sourcing exhaustion never authorizes media specification gaps', () => {
  for(const reason of ['container_unmet','video_codec_unmet','minimum_raster_unmet','primary_audio_unmet','playback_decode_failed']) {
    assert.throws(()=>buildDefectAdmissionCandidate({run:frozen(),
      terminalEvidence:terminal('no_requirement_eligible_candidate','libra.external_material.candidate.select@1'),
      directMediaVerification:{candidateKind:'direct_input',result:'failed',libraRunId:'run-119',
        verificationId:D('verification'),reasonCodes:[reason]}}),{code:'P9_DEFECT_ADMISSION_INELIGIBLE'});
  }
});

test('size-cap admission waives only max_size_exceeded after measured workspace verification freeze', () => {
  const candidate = buildDefectAdmissionCandidate({ run:frozen(),
    terminalEvidence:terminal('size_cap_requires_admission',
      'libra.product_media.verify@1'),sizeCapVerification:sizeVerification() });
  assert.equal(candidate.defects[0].defectCode, 'size_cap_exceeded');
  assert.deepEqual(candidate.waivedRequirementCodes, ['max_size_exceeded']);
  const manifest = authorize(candidate);
  assert.equal(coversRequirementGaps(manifest, ['max_size_exceeded']), true);
  assert.equal(coversRequirementGaps(manifest, ['video_codec_unmet']), false);
  assert.equal(candidate.defects[0].workspaceMediaVerificationId,
    sizeVerification().verificationId);
  assert.throws(() => buildDefectAdmissionCandidate({ run:frozen(),
    terminalEvidence:terminal('size_cap_requires_admission',
      'libra.product_media.verify@1'),sizeCapVerification:sizeVerification({
      reasonCodes:['max_size_exceeded','video_codec_unmet'] }) }),
  (error) => error.code === 'P9_DEFECT_ADMISSION_SIZE_VERIFICATION');
  const verification=sizeVerification(),exactCandidate=buildDefectAdmissionCandidate({run:frozen(),
    terminalEvidence:terminal('size_cap_requires_admission','libra.product_media.verify@1'),
    sizeCapVerification:verification}),exactManifest=authorize(exactCandidate),results=[
      {outcomeKind:'succeeded',capabilityRef:'libra.product_output.select@1',result:{result:'not_selected'}},
      {outcomeKind:'succeeded',capabilityRef:'libra.product_media.verify@1',result:verification},
    ];
  assert.equal(resolveProductSelection(results,exactManifest,{workId:'work-119'})
    .effectiveSelection.selectionKind,'authorized_defect_workspace_output');
  assert.equal(resolveProductSelection(results,exactManifest,{workId:'another-work'})
    .effectiveSelection,null);
  assert.throws(() => resolveProductSelection([
    results[0],{...results[1],result:{...verification,productMaterialHandleId:'different-product'}},
  ],exactManifest,{workId:'work-119'}),
  (error) => error.code === 'P9_DEFECT_ADMISSION_SIZE_STALE');
});

test('UAT-126 rejects provider outages and Arca rejects stale or broader attestations', () => {
  assert.throws(() => buildDefectAdmissionCandidate({ run:frozen(),
    terminalEvidence:terminal('provider_timeout', 'libra.external.search@1') }),
  (error) => error.code === 'P9_DEFECT_ADMISSION_INELIGIBLE');
  const manifest = authorize(buildDefectAdmissionCandidate({ run:frozen(),
    terminalEvidence:terminal('product_metadata_required_cast_missing') }));
  assert.equal(acceptsProductionAttestation({ acceptanceKind:'accepted_with_defects',
    unmetRequirementCount:2,
    unmetRequirementCodes:['metadata_field_unmet','container_unmet'],
    authorizedDefectManifest:manifest }), false);
});

test('UAT-126 Aftercare ignores only the authorized conformance gap', () => {
  const manifest = authorize(buildDefectAdmissionCandidate({ run:frozen(),
    terminalEvidence:terminal('product_metadata_required_cast_missing') }));
  const basis = D('care');
  const assessments = ['custody','presentation','conformance'].map((kind) =>
    Object.freeze({ assessmentId:`assessment-${kind}`, assessmentKind:kind,
      careBasisDigest:basis, result:kind === 'conformance' ? 'observing' : 'healthy',
      evidenceDigest:D(kind), assessedAtMs:100 }));
  const health = projectHealth({ shelfEntryId:'entry-119', basis:{ digest:basis },
    authorizedDefectManifest:manifest }, { assessments, cases:[], findings:[
    { assessmentId:'assessment-conformance', findingKind:'conformance:metadata_field_missing__actor',
      repairability:'auto_repair', state:'open' },
  ] }, 100);
  assert.equal(health.state, 'healthy');
  assert.equal(health.dimensions.conformance.findings.length, 0);
  const unrelated = projectHealth({ shelfEntryId:'entry-119', basis:{ digest:basis },
    authorizedDefectManifest:manifest }, { assessments, cases:[], findings:[
    { assessmentId:'assessment-conformance', findingKind:'conformance:checksum_unmet',
      repairability:'attention_required', state:'open' },
  ] }, 100);
  assert.equal(unrelated.state, 'attention_required');
});

test('UAT-126 upgrades the prior clean schema before defect admission revisions are written', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uat126-schema-'));
  try {
    const dataDir = path.join(root, 'data');
    initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1',
      secretRoot:'uat126-schema-secret-root-0123456789abcdef' });
    const databasePath = path.join(dataDir, 'shelfdeck.db');
    let database = new Database(databasePath);
    database.pragma('foreign_keys = OFF');
    for (const table of ['arca_defect_repair_intents','arca_defect_admission_heads','arca_defect_admissions',
      'libra_reprocess_intents','libra_strategy_availability','libra_run_outcomes','libra_defect_authorization_head','libra_defect_authorizations'])
      database.exec('DROP TABLE "' + table + '"');
    const catalog = database.prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    ).all().map((row) => ({ ...row, sql:row.sql && row.sql.replaceAll('\r\n', '\n') }));
    database.prepare('UPDATE platform_schema_marker SET schema_digest=?,catalog_digest=?')
      .run(PRE_DEFECT_ADMISSION_SCHEMA_DIGEST, digest(catalog));
    database.close();
    const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
    const migrated = migrateUatIdentitySelectionSchema({ Database, databasePath,
      schemaManifest, now:() => 119 });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.targetSchemaDigest, TARGET_SCHEMA_DIGEST);
    database = new Database(databasePath, { readonly:true });
    const marker = database.prepare('SELECT schema_digest FROM platform_schema_marker').get();
    const table = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='libra_run_revisions'").get();
    assert.equal(marker.schema_digest, TARGET_SCHEMA_DIGEST);
    assert.match(table.sql, /'defect_admitted'/);
    database.close();
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});
