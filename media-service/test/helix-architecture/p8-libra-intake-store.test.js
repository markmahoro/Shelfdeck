'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createLibraIntakeRepositoryDefinitions, createLibraIntakeStore } = require('../../src/helix/domains/libra/persistence/libra-intake-store');
const { continuityHeadDigest, subjectContinuitySetDigest, subjectEpisodeScopeDigest } = require('../../src/helix/domains/libra/model/libra-intake-contracts');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const D = (value) => canonicalDigest(value);

function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-libra-intake-')); let now=1_700_080_000_000;
  const kernel=openSqliteKernel({ Database,databasePath:path.join(root,'shelfdeck.db'),schemaDdl,schemaManifest,now:()=>now++ });
  const unitOfWork=createSqliteUnitOfWork({ kernel }); const store=createLibraIntakeStore({ schemaManifest,unitOfWork });
  try { return run({ store,unitOfWork,kernel }); } finally { kernel.close(); fs.rmSync(root,{ recursive:true,force:true }); }
}

test('binds Libra Intake repositories to the exact ten SSOT-owned tables',()=>fixture(({ store })=>{
  assert.deepEqual(store.repositoryManifest.tableIds,[
    'libra_handoff_a_receipts','libra_intake_decisions','libra_intake_resolution_episode_overlaps',
    'libra_intake_resolution_match_witnesses','libra_material_binding_episode_claims','libra_material_bindings',
    'libra_subject_continuity_heads','libra_subject_episode_scopes','libra_subject_season_continuity_claims','libra_subjects'
  ]);
  assert.equal(store.repositories.subjects.owner,'libra'); assert.equal(store.repositories.bindings.owner,'libra');
  assert.equal(store.repositories.intake.owner,'libra');
}));

test('initializes the sole global continuity head at revision zero idempotently',()=>fixture(({ store })=>{
  const first=store.ensureContinuityHead(),second=store.ensureContinuityHead();
  assert.equal(first.head_id,'active_subject_continuity'); assert.equal(first.current_revision,0);
  assert.equal(first.head_digest,continuityHeadDigest(0)); assert.deepEqual(second,first);
}));

test('persists Subject continuity and Material-to-Episode N:M relations without flattening',()=>fixture(({ store,unitOfWork })=>{
  store.ensureContinuityHead(); const { subjects,bindings,intake }=store.repositories;
  const subjectId='subject-1',decisionId='decision-1',materialKey=D('material-1');
  const claims=[
    { claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:9:season:1',claimDigest:D('claim-1'),provenanceKind:'candidate',provenanceRef:'candidate-1' },
    { claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:9:season:1',claimDigest:D('claim-2'),provenanceKind:'resolved_identity',provenanceRef:'subject-1:1' }
  ];
  const continuityDigest=subjectContinuitySetDigest(subjectId,claims),episodeDigest=subjectEpisodeScopeDigest(subjectId,['S01E01','S01E02']);
  unitOfWork.execute([{ participantId:'seed',owner:'libra',repositories:[subjects,bindings,intake],execute(context){
    const s=context.repository(subjects.repositoryId),b=context.repository(bindings.repositoryId),i=context.repository(intake.repositoryId),at=context.commitTimeMs;
    s.invoke('insert_subject',{ subject_id:subjectId,structure_kind:'season',status:'active',intake_revision:1,
      current_continuity_set_digest:continuityDigest,current_episode_scope_digest:episodeDigest,current_identity_revision:null,
      created_at_ms:at,updated_at_ms:at,terminal_at_ms:null });
    i.invoke('insert_decision',{ intake_decision_id:decisionId,decision_revision:1,offer_id:'offer-1',candidate_package_id:'candidate-1',package_revision:1,
      package_digest:D('package'),acceptance_basis_digest:D('basis'),candidate_delivery_snapshot_digest:D('delivery'),expected_continuity_head_revision:0,
      expected_continuity_head_digest:continuityHeadDigest(0),committed_continuity_head_revision:1,candidate_continuity_set_digest:continuityDigest,
      candidate_episode_scope_digest:episodeDigest,match_cardinality:'none',matched_subject_set_digest:D('matches'),episode_overlap_digest:D('overlap'),
      result:'new_subject',target_subject_id:subjectId,expected_target_status:null,expected_target_intake_revision:null,
      expected_target_continuity_set_digest:null,expected_target_episode_scope_digest:null,committed_target_intake_revision:1,
      committed_subject_continuity_set_digest:continuityDigest,committed_subject_episode_scope_digest:episodeDigest,
      accepted_payload_digest:D('payload'),rejection_schema_ref:null,decision_digest:D('decision'),decided_at_ms:at });
    for(const claim of claims)s.invoke('insert_claim',{ subject_id:subjectId,claim_kind:claim.claimKind,claim_namespace:claim.claimNamespace,
      claim_key:claim.claimKey,claim_digest:claim.claimDigest,provenance_kind:claim.provenanceKind,provenance_ref:claim.provenanceRef,accepted_at_ms:at });
    for(const episodeKey of ['S01E01','S01E02'])s.invoke('insert_episode',{ subject_id:subjectId,episode_key:episodeKey,
      first_intake_decision_id:decisionId,source_episode_scope_digest:episodeDigest,accepted_at_ms:at });
    b.invoke('insert_binding',{ subject_id:subjectId,material_key:materialKey,role:'primary_payload',endpoint_id:'endpoint-1',location:'/field/show.mkv',
      binding_revision:1,health_state:'active',evidence_digest:D('delivery-member'),current:1 });
    for(const episodeKey of ['S01E01','S01E02'])b.invoke('insert_binding_episode',{ subject_id:subjectId,material_key:materialKey,binding_revision:1,
      episode_key:episodeKey,season_claim_digest:D('season'),claim_digest:D(episodeKey) });
  }}]);
  assert.equal(store.getSubject(subjectId).current_identity_revision,null);
  assert.deepEqual(store.listSubjectEpisodes(subjectId).map((row)=>row.episode_key),['S01E01','S01E02']);
  assert.deepEqual(store.listBindingEpisodes(subjectId,materialKey,1).map((row)=>row.episode_key),['S01E01','S01E02']);
  assert.equal(store.listSubjectBindings(subjectId).length,1);
  assert.equal(store.findActiveContinuityMatches({ claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:9:season:1' }).length,2);
}));

test('digest contracts are order-stable and reject duplicate Episode scope',()=>{
  const claims=[{ claimKind:'triage_grouping_lineage',claimNamespace:'triage',claimKey:'group-1',claimDigest:D('claim'),provenanceKind:'candidate',provenanceRef:'candidate-1' }];
  assert.equal(subjectContinuitySetDigest('subject-1',claims),subjectContinuitySetDigest('subject-1',[...claims].reverse()));
  assert.equal(subjectEpisodeScopeDigest('subject-1',['S01E02','S01E01']),subjectEpisodeScopeDigest('subject-1',['S01E01','S01E02']));
  assert.throws(()=>subjectEpisodeScopeDigest('subject-1',['S01E01','S01E01']),(error)=>error.code==='P8_EPISODE_SCOPE_DUPLICATE');
});

test('canonical Handoff A contract freezes ten Libra plus five Foundation tables',()=>{
  const contract=require('../../src/helix/contracts/transaction-contracts/helix.transaction.handoff-a-accepted/v1/contract.json').contract;
  assert.equal(contract.writeTables.length,15); assert.equal(contract.readTables.length,15);
  assert.deepEqual([...contract.participants.find((item)=>item.owner==='libra').tables].sort(),
    createLibraIntakeRepositoryDefinitions(schemaManifest).tableIds);
  assert.deepEqual(contract.participants.filter((item)=>item.owner!=='libra').flatMap((item)=>item.tables),
    ['fx_material_controls','fx_material_control_revisions','fx_event_result_bindings','fx_commit_markers','fx_outbox']);
});
