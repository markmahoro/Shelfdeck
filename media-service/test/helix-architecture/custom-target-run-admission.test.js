'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/custom-spec-publication-harness');
const {D}=require('./fixtures/us-adult-analysis-basis-harness');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {createLibraRunContextReader}=require('../../src/helix/domains/libra/application/libra-run-context-reader');
const {createLibraRunCreator}=require('../../src/helix/domains/libra/application/libra-run-creator');
const {createRunLifecycleStore}=require('../../src/helix/domains/libra/persistence/run-lifecycle-store');
const {buildRunLifecycleDecision}=require('../../src/helix/domains/libra/model/run-lifecycle-contracts');
const {createStrategyAvailabilityStore}=require('../../src/helix/domains/libra/persistence/strategy-availability-store');
const {createWorkLifecycle}=require('../../src/helix/foundation/execution/work-lifecycle');

const EMPTY_RELATED={relatedReferenceSetDigest:canonicalDigest({schema:'procurement.related-reference-set@1',items:[]}),
  relatedDispositionScopeDigest:canonicalDigest({schema:'procurement.related-disposition-scope@1',items:[]})};
function prepareRun(h){
  const {db,data,base}=h;
  // This fixture starts without a Run and uses the actual admission and
  // lifecycle writers. It never deletes or edits immutable runtime evidence.
  db.prepare('UPDATE libra_subjects SET current_continuity_set_digest=?,current_episode_scope_digest=?').run(D('continuity'),D('episodes'));
  db.prepare('INSERT INTO libra_intake_decisions(intake_decision_id,candidate_package_id,source_field_id,source_field_access_revision,source_field_context_digest,candidate_identity_claim_digest) VALUES(?,?,?,?,?,?)')
    .run('intake','candidate','field',1,D('field'),D('claim'));
  const identity={mountScopeId:'mount',inode:'101',fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
    contentFingerprint:D('source-content'),sizeBytes:1000},key=canonicalDigest({schema:'physical-material-identity@2',...identity});
  db.prepare('INSERT INTO fx_material_controls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,identity.mountScopeId,identity.inode,identity.sizeBytes,
    identity.fingerprintAlgorithm,1,identity.contentFingerprint,'libra','subject','subject',1,'controlled',1);
  db.prepare('INSERT INTO fx_material_control_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(key,1,'acquire',null,null,null,
    'libra','subject','subject',D('control'),'fixture-control-marker',1);
  const columns=['subject_id','material_key','role','authority_kind','mount_scope_id','inode','fingerprint_algorithm','fingerprint_version',
    'content_fingerprint','size_bytes','endpoint_id','location','binding_revision','health_state','evidence_digest','origin_intake_decision_id',
    'origin_offer_id','origin_candidate_package_id','origin_package_revision','origin_package_digest','origin_candidate_delivery_snapshot_digest',
    'origin_related_reference_set_digest','origin_related_disposition_scope_digest','current'];
  db.prepare('INSERT INTO libra_material_bindings('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run('subject',key,'primary_payload',
    'primary_control',identity.mountScopeId,identity.inode,identity.fingerprintAlgorithm,1,identity.contentFingerprint,identity.sizeBytes,
    'endpoint','/source/movie.mkv',1,'active',D('binding'),'intake','offer','candidate',1,D('package'),D('delivery'),
    EMPTY_RELATED.relatedReferenceSetDigest,EMPTY_RELATED.relatedDispositionScopeDigest,1);
  const contextReader=createLibraRunContextReader(h),creator=createLibraRunCreator({...h,contextReader}),admitted=creator.reconcile('subject');
  assert.equal(admitted.kind,'admitted');
  const old=db.prepare('SELECT * FROM libra_runs').get(),strategy=createStrategyAvailabilityStore(h);let unavailable;
  for(const offset of [0,60000,300000,900000,1800000,3600000]){
    const at=1700000000000+offset;h.advanceClock(at);
    unavailable=strategy.observe({libraRunId:old.libra_run_id,strategyKind:'moviepilot',reasonCode:'moviepilot_integration_unavailable',
      conditionDigest:D('provider-unavailable'),now:at},old);
  }
  assert.equal(unavailable.status,'unavailable');
  const head=db.prepare('SELECT * FROM libra_run_admission_heads').get(),decision=buildRunLifecycleDecision({libraRunId:old.libra_run_id,
    expectedStateRevision:Number(old.state_revision),expectedStateDigest:old.state_digest,transitionKind:'freeze',transitionEvidence:unavailable,
    expectedAdmissionHeadRevision:Number(head.head_revision),expectedActiveScopeSetDigest:head.active_scope_set_digest});
  createRunLifecycleStore(h).transition({decision,commitMarker:'fixture-freeze-marker',resultId:'fixture-freeze-result'});
  const frozen=db.prepare('SELECT * FROM libra_runs').get(),manifest=db.prepare('SELECT * FROM libra_run_material_manifests').get();
  assert.equal(frozen.state,'frozen');assert.equal(frozen.acceptance_spec_id,base.acceptanceSpecId);
  Object.assign(data.targetBasis,{libraRunId:frozen.libra_run_id,runState:frozen.state,runStateRevision:frozen.state_revision,
    runStateDigest:frozen.state_digest,runExecutionBasisDigest:frozen.execution_basis_digest,materialSetDigest:manifest.member_set_digest});
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
}
function runHarness(callback){return harness(h=>{
  const published=h.publish(),spec=h.publisher.read(published.receipt.resultRef.acceptanceSpecId),contextReader=createLibraRunContextReader(h.options),
    lifecycle=createWorkLifecycle({...h.options,nextWorkAttemptId:()=> 'unused'}),cancelled=[],
    creator=createLibraRunCreator({...h.options,contextReader,customTargetStore:h.targets,cancelProcessWorks(scope){cancelled.push(scope);return lifecycle.cancelProcess(scope);}}),
    advance=readFence=>creator.replaceConfirmedCustomTarget(h.chosen.intent,readFence),
    snapshot=()=>Object.fromEntries(['libra_runs','libra_run_revisions','libra_run_admission_heads','libra_run_material_manifests',
      'libra_run_material_members','fx_event_result_bindings','fx_commit_markers'].map(table=>[table,h.db.prepare('SELECT * FROM '+table).all()]));
  return callback({...h,spec,creator,cancelled,advance,snapshot});
},{prepareRun});}

test('an actual frozen Run is replaced through a confirmed target, keeping identity, input and the real standard',()=>runHarness(h=>{
  const oldId=h.chosen.intent.basis.libraRunId,old=h.db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(oldId),
    sourceControls=h.db.prepare('SELECT * FROM fx_material_controls').all(),originalIntents=h.db.prepare('SELECT * FROM libra_custom_target_intents').all(),
    admitted=h.advance(h.unitOfWork.captureReadFence());
  assert.equal(admitted.kind,'admitted');assert.notEqual(admitted.libraRunId,oldId);
  const current=h.db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(admitted.libraRunId),
    previous=h.db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(oldId),basis=JSON.parse(current.execution_basis_record_json);
  assert.equal(previous.state,'superseded');assert.equal(previous.execution_basis_digest,old.execution_basis_digest);
  assert.equal(current.state,'active');assert.equal(current.acceptance_spec_id,h.spec.acceptanceSpecId);
  assert.equal(h.spec.originalTarget.acceptanceSpecId,h.base.acceptanceSpecId);assert.equal(h.spec.requirements.space.maxSizeGiB,50);
  assert.deepEqual(basis.collectionTargetRef,{schemaRef:'libra.collection-target-reference@1',targetKind:'user_custom',
    intentId:h.chosen.intent.intentId,intentDigest:h.chosen.intent.intentDigest,targetRevision:1});
  assert.equal(h.cancelled.length,1);assert.equal(h.cancelled[0].processId,oldId);
  assert.deepEqual(h.db.prepare('SELECT * FROM fx_material_controls').all(),sourceControls);
  assert.deepEqual(h.db.prepare('SELECT * FROM libra_custom_target_intents').all(),originalIntents);
  assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
}));

test('custom Run admission requires a fresh opaque view and leaves the frozen Run unchanged on conflict',()=>runHarness(h=>{
  const before=h.snapshot(),readFence=h.unitOfWork.captureReadFence();
  h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();
  assert.throws(()=>h.advance(readFence),{code:'P3_UOW_READ_FENCE_CHANGED'});assert.deepEqual(h.snapshot(),before);
  assert.throws(()=>h.advance(null),{code:'LIBRA_COLLECTION_TARGET_NOT_CURRENT'});
}));

test('confirmed target cannot follow a changed source binding into a replacement Run',()=>runHarness(h=>{
  h.db.prepare('UPDATE libra_material_bindings SET location=?').run('/source/other.mkv');
  const before=h.snapshot();assert.throws(()=>h.advance(h.unitOfWork.captureReadFence()),{code:'LIBRA_CUSTOM_TARGET_ADMISSION_MATERIAL_CHANGED'});
  assert.deepEqual(h.snapshot(),before);
}));

test('changed original identity or new target authority cannot silently inherit a confirmation',()=>runHarness(h=>{
  h.db.prepare('UPDATE libra_product_fact_revisions SET fact_digest=?').run(D('another-identity'));
  const before=h.snapshot();assert.throws(()=>h.advance(h.unitOfWork.captureReadFence()),{code:'LIBRA_CUSTOM_TARGET_ADMISSION_STALE'});
  assert.deepEqual(h.snapshot(),before);
}));
