'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/custom-spec-publication-harness');
const {D}=require('./fixtures/us-adult-analysis-basis-harness');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {createLibraRunContextReader}=require('../../src/helix/domains/libra/application/libra-run-context-reader');
const {createLibraRunCreator}=require('../../src/helix/domains/libra/application/libra-run-creator');
const {createCustomTargetBaselineReader}=require('../../src/helix/domains/libra/application/custom-target-baseline-reader');
const {buildDecisionInputSet}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {createRunAdmissionStore}=require('../../src/helix/domains/libra/persistence/run-admission-store');
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
    baseline={kind:'ready',subjectId:h.chosen.intent.subjectId,productScopeDigest:h.chosen.intent.basis.productScopeDigest,
      standardSpecDigest:h.chosen.intent.basis.baseSpecDigest,shelfId:h.chosen.intent.basis.shelfId,
      shelfStandardRevision:h.chosen.intent.basis.shelfStandardRevision,shelfStandardDigest:h.chosen.intent.basis.shelfStandardDigest,
      identityDigest:h.chosen.intent.basis.identityDigest,handoffState:'no_offer'},
    readCurrentCustomTargetBaseline=()=>Object.freeze({...baseline}),
    setBaseline=value=>Object.assign(baseline,value),
    creator=createLibraRunCreator({...h.options,contextReader,customTargetStore:h.targets,readCurrentCustomTargetBaseline,
      cancelProcessWorks(scope){cancelled.push(scope);return lifecycle.cancelProcess(scope);}}),
    advance=readFence=>creator.replaceConfirmedCustomTarget(h.chosen.intent,readFence),
    snapshot=()=>Object.fromEntries(['libra_runs','libra_run_revisions','libra_run_admission_heads','libra_run_material_manifests',
      'libra_run_material_members','fx_event_result_bindings','fx_commit_markers'].map(table=>[table,h.db.prepare('SELECT * FROM '+table).all()]));
  return callback({...h,spec,creator,cancelled,advance,snapshot,readCurrentCustomTargetBaseline,setBaseline});
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

test('Arca Accepted prevents replacement and leaves the old Run and Work untouched',()=>runHarness(h=>{
  const actual=createLibraRunContextReader(h.options),oldId=h.chosen.intent.basis.libraRunId,cancelled=[];
  const contextReader={...actual,read(subjectId){const context=actual.read(subjectId);
    return {...context,acceptedDeliveryRunIds:[oldId]};}};
  const creator=createLibraRunCreator({...h.options,contextReader,customTargetStore:h.targets,cancelProcessWorks(scope){cancelled.push(scope);}});
  const before=h.snapshot(),result=creator.replaceConfirmedCustomTarget(h.chosen.intent,h.unitOfWork.captureReadFence());
  assert.equal(result.kind,'delivered');assert.equal(result.libraRunId,oldId);assert.deepEqual(cancelled,[]);assert.deepEqual(h.snapshot(),before);
}));

test('a newly selected standard Spec does not inherit the confirmed custom target',()=>runHarness(h=>{
  h.db.prepare('UPDATE libra_subject_decision_heads SET current_acceptance_spec_id=? WHERE subject_id=?').run(h.base.acceptanceSpecId,'subject');
  const before=h.snapshot();assert.throws(()=>h.advance(h.unitOfWork.captureReadFence()),{code:'LIBRA_COLLECTION_TARGET_NOT_CURRENT'});
  assert.deepEqual(h.cancelled,[]);assert.deepEqual(h.snapshot(),before);
}));

test('changed current rating requirements or unavailable baseline prevents custom Run admission',()=>runHarness(h=>{
  const before=h.snapshot();
  const original=h.readCurrentCustomTargetBaseline();
  for(const change of [{standardSpecDigest:D('rating-changed')},{identityDigest:D('identity-changed')},
    {shelfStandardRevision:original.shelfStandardRevision+1},{productScopeDigest:D('another-scope')},{handoffState:'accepted'}]){
    h.setBaseline({...original,...change});
    assert.throws(()=>h.advance(h.unitOfWork.captureReadFence()),{code:'LIBRA_CUSTOM_TARGET_BASELINE_CHANGED'});
  }
  h.setBaseline({kind:'unavailable'});
  assert.throws(()=>h.advance(h.unitOfWork.captureReadFence()),{code:'LIBRA_CUSTOM_TARGET_BASELINE_UNAVAILABLE'});
  assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.cancelled,[]);
  h.setBaseline(original);
  assert.equal(h.advance(h.unitOfWork.captureReadFence()).kind,'admitted');
}));

test('the typed current standard projection can feed the actual custom Run transaction',()=>runHarness(h=>{
  const source=h.data.inputSet,subject={...source.subjectSnapshot,currentIdentityRevision:1,currentIdentityDigest:h.chosen.intent.basis.identityDigest};
  subject.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(subject).filter(([key])=>key!=='snapshotDigest')));
  const inputSet=buildDecisionInputSet({...source,subjectSnapshot:subject}),baselineReader=createCustomTargetBaselineReader({
    acceptanceSpecContextReader:{read:()=>({kind:'ready',inputSet})},
    readHandoffResponsibility:request=>({kind:'ready',...request,handoffState:'no_offer'})}),
    contextReader=createLibraRunContextReader(h.options),creator=createLibraRunCreator({...h.options,contextReader,
      customTargetStore:h.targets,readCurrentCustomTargetBaseline:baselineReader.read,cancelProcessWorks(){return {drainingWorks:0};}});
  const result=creator.replaceConfirmedCustomTarget(h.chosen.intent,h.unitOfWork.captureReadFence());
  assert.equal(result.kind,'admitted');assert.equal(h.db.prepare('SELECT acceptance_spec_id FROM libra_runs WHERE libra_run_id=?')
    .get(result.libraRunId).acceptance_spec_id,h.spec.acceptanceSpecId);
}));

test('direct custom admission also requires the current baseline inside its transaction',()=>runHarness(h=>{
  const accepted=h.advance(h.unitOfWork.captureReadFence()),row=h.db.prepare(
    'SELECT transition_evidence_json FROM libra_run_revisions WHERE libra_run_id=? AND state_revision=1').get(accepted.libraRunId),
    decision=JSON.parse(row.transition_evidence_json),before=h.snapshot();
  assert.throws(()=>createRunAdmissionStore(h.options).admit({decision,commitMarker:'new-marker',resultId:'new-result',
    readFence:h.unitOfWork.captureReadFence()}),{code:'LIBRA_CUSTOM_TARGET_BASELINE_UNAVAILABLE'});
  assert.deepEqual(h.snapshot(),before);
}));

test('a custom Run cannot be admitted without a current Owner baseline reader',()=>runHarness(h=>{
  const contextReader=createLibraRunContextReader(h.options),creator=createLibraRunCreator({...h.options,contextReader,readCurrentCustomTargetBaseline:undefined,
    customTargetStore:h.targets,cancelProcessWorks(){throw new Error('must not cancel');}}),before=h.snapshot();
  assert.throws(()=>creator.replaceConfirmedCustomTarget(h.chosen.intent,h.unitOfWork.captureReadFence()),
    {code:'LIBRA_CUSTOM_TARGET_BASELINE_UNAVAILABLE'});
  assert.deepEqual(h.snapshot(),before);
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

test('replacement replay returns the committed Run and resumes cancellation after interruption',()=>runHarness(h=>{
  const contextReader=createLibraRunContextReader(h.options), lifecycle=createWorkLifecycle({...h.options,nextWorkAttemptId:()=> 'unused'});
  let calls=0;
  const creator=createLibraRunCreator({...h.options,contextReader,customTargetStore:h.targets,
    readCurrentCustomTargetBaseline:h.readCurrentCustomTargetBaseline,cancelProcessWorks(scope){
    calls++;
    if(calls===1)throw new Error('injected after admission');
    return lifecycle.cancelProcess(scope);
  }});
  assert.throws(()=>creator.replaceConfirmedCustomTarget(h.chosen.intent,h.unitOfWork.captureReadFence()),/injected after admission/);
  const committed=h.db.prepare("SELECT * FROM libra_runs WHERE state='active'").get(), before=h.snapshot();
  h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();
  h.setBaseline({kind:'unavailable'});
  const replay=creator.replaceConfirmedCustomTarget(h.chosen.intent,null);
  assert.equal(replay.kind,'admitted');assert.equal(replay.replayed,true);assert.equal(replay.libraRunId,committed.libra_run_id);
  assert.equal(calls,2);assert.deepEqual(h.snapshot(),before);
  const again=creator.replaceConfirmedCustomTarget(h.chosen.intent,null);
  assert.equal(again.libraRunId,committed.libra_run_id);assert.equal(again.replayed,true);assert.equal(calls,3);
  assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
}));

test('replacement replay rejects a forged target and corrupt stored admission evidence',()=>runHarness(h=>{
  h.advance(h.unitOfWork.captureReadFence());
  const before=h.snapshot(), altered={...h.chosen.intent,actorId:'forged'};
  assert.throws(()=>h.creator.replaceConfirmedCustomTarget(altered,null));
  assert.deepEqual(h.snapshot(),before);
  const row=h.db.prepare("SELECT result_id FROM fx_event_result_bindings WHERE result_schema_ref=? AND json_extract(result_json,'$.supersededRunRef.libraRunId')=?")
    .get('helix://contracts/types/LibraRunAdmissionResult/v1',h.chosen.intent.basis.libraRunId);
  h.db.prepare('UPDATE fx_event_result_bindings SET evidence_digest=? WHERE result_id=?').run(D('corrupt'),row.result_id);
  assert.throws(()=>h.creator.replaceConfirmedCustomTarget(h.chosen.intent,null),{code:'P9_RUN_REPLAY_CORRUPT'});
}));

test('replacement replay validates the complete stored Run basis and custom Spec',()=>runHarness(h=>{
  const result=h.advance(h.unitOfWork.captureReadFence()),id=result.libraRunId;
  const row=h.db.prepare('SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id=?').get(id),basis=JSON.parse(row.execution_basis_record_json);
  basis.subjectSnapshot.intakeRevision++;
  h.db.prepare('UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id=?').run(canonicalJson(basis),id);
  assert.throws(()=>h.creator.replaceConfirmedCustomTarget(h.chosen.intent,null),{code:'P9_RUN_REPLAY_CORRUPT'});
  h.db.prepare('UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id=?').run(row.execution_basis_record_json,id);
  const original=h.db.prepare('SELECT spec_json FROM libra_acceptance_specs WHERE acceptance_spec_id=?').get(h.spec.acceptanceSpecId),spec=JSON.parse(original.spec_json);
  spec.requirements.space.maxSizeGiB=51;
  h.db.prepare('UPDATE libra_acceptance_specs SET spec_json=? WHERE acceptance_spec_id=?').run(canonicalJson(spec),h.spec.acceptanceSpecId);
  assert.throws(()=>h.creator.replaceConfirmedCustomTarget(h.chosen.intent,null),{code:'P9_RUN_REPLAY_CORRUPT'});
}));

function replacementReadiness(h, cancelProcessWorks, readArcaFormationStatus) {
  const {createCustomTargetReplacementReadiness}=require('../../src/helix/domains/libra/application/custom-target-replacement-readiness');
  const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
  const lifecycle=createWorkLifecycle({...h.options,nextWorkAttemptId:()=> 'unused'});
  return createCustomTargetReplacementReadiness({...h.options,customTargetStore:h.targets,
    workResultReader:createWorkResultReader(h.options),readArcaFormationStatus,
    cancelProcessWorks:cancelProcessWorks||((scope)=>lifecycle.cancelProcess(scope))});
}
function seedDrainingRun(h,runId) {
  const db=h.db;
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,state) VALUES(?,?,?,?,?,?)')
    .run('draining-work','libra','libra_run',runId,'workspace_media_production','running');
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,state) VALUES(?,?,?,?)').run('draining-attempt','draining-work',1,'running');
  db.prepare('INSERT INTO fx_workflow_events(event_id,work_id,attempt_id,owner_domain,state) VALUES(?,?,?,?,?)')
    .run('draining-event','draining-work','draining-attempt','libra','executing');
  db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state) VALUES(?,?,?,?)')
    .run('draining-event-attempt','draining-event',1,'executing');
  db.prepare('INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,state) VALUES(?,?,?,?,?)')
    .run('draining-effect','draining-event-attempt','workspace_write','draining-effect-key','intended');
}

test('confirmed custom replacement keeps the old Work and unresolved Effect behind a fenced readiness proof',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId;seedDrainingRun(h,old);
  const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=replacementReadiness(h);
  let result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_execution_draining');
  assert.equal(h.db.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get('draining-work').state,'running');
  h.db.prepare("UPDATE fx_workflow_events SET state='succeeded' WHERE event_id='draining-event'").run();
  h.db.prepare("UPDATE fx_event_attempts SET state='completed',outcome_kind='succeeded' WHERE event_attempt_id='draining-event-attempt'").run();
  result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_execution_draining');
  assert.equal(h.db.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get('draining-work').state,'cancelled');
  h.db.prepare("UPDATE fx_effect_journal SET state='committed' WHERE effect_id='draining-effect'").run();
  result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'ready');assert.equal(result.previousRunIds[0],old);assert.ok(result.readFence);
  h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();
  const reader=require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader(h.options);
  const participant=reader.createExecutionStateReadParticipant([{ownerDomain:'libra',processType:'libra_run',processId:old}],()=>{});
  assert.throws(()=>h.unitOfWork.execute([participant],{readFence:result.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
}));

test('replacement readiness retries cancellation and never accepts forged relations or a changed target',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence());let calls=0;
  const lifecycle=createWorkLifecycle({...h.options,nextWorkAttemptId:()=> 'unused'}),guard=replacementReadiness(h,scope=>{
    calls++;if(calls===1)throw new Error('interrupted cancellation');return lifecycle.cancelProcess(scope);
  });
  assert.throws(()=>guard.check(replacement.libraRunId),/interrupted cancellation/);
  assert.equal(guard.check(replacement.libraRunId).kind,'ready');assert.equal(calls,2);
  h.db.prepare('DELETE FROM libra_custom_target_heads').run();
  assert.throws(()=>guard.check(replacement.libraRunId));assert.equal(calls,2);
}));

test('an old published Offer cannot be mistaken for a drained no-offer replacement',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence()),guard=replacementReadiness(h);
  seedPriorOffer(h,old);
  assert.notEqual(guard.check(replacement.libraRunId).kind,'ready');
}));

function seedPriorOffer(h,oldRunId,packageRevision=1) {
  const old=h.db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(oldRunId),
    onDeckPackageId=canonicalDigest({schema:'libra.on-deck-package-id@1',libraRunId:oldRunId,packageRevision}),
    packageDigest=D('prior-package-'+packageRevision),offerId=canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,packageDigest}),
    offer={offerId,onDeckPackageId,packageRevision,packageDigest,shelfId:'shelf',libraRunId:oldRunId,subjectId:old.subject_id,
      acceptanceSpecId:old.acceptance_spec_id,relatedDispositionSetDigest:D('related-disposition')};
  h.db.prepare('INSERT INTO libra_product_packages(on_deck_package_id,offer_id,package_revision,libra_run_id,subject_id,shelf_id,acceptance_spec_id,package_digest,related_disposition_set_digest,state) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(onDeckPackageId,offerId,packageRevision,oldRunId,old.subject_id,'shelf',old.acceptance_spec_id,packageDigest,offer.relatedDispositionSetDigest,'published');
  h.db.prepare('UPDATE libra_runs SET package_revision_head=? WHERE libra_run_id=?').run(packageRevision,oldRunId);
  const body={eligibility:'ineligible',reasonCode:'target_not_current',libraRunId:oldRunId,runState:old.state,
    runStateRevision:Number(old.state_revision),runStateDigest:old.state_digest,acceptanceSpecId:old.acceptance_spec_id,
    packageRevisionHead:packageRevision,deliveryReceiptAbsent:true};
  return {offer,deliveryFence:{...body,fenceDigest:canonicalDigest(body)}};
}

test('real Arca withdrawal closes the exact old Offer and its acceptance Work must also drain',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence()),prior=seedPriorOffer(h,old),
    projection=require('../../src/helix/domains/arca/application/formation-status-projection').createFormationStatusProjection(h.options),
    guard=replacementReadiness(h,undefined,ids=>projection.read(ids));
  let result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_offer_closure_unproven');
  const store=require('../../src/helix/domains/arca/persistence/offer-withdrawal-store').createOfferWithdrawalStore(h.options);
  store.close({...prior,readFence:h.unitOfWork.captureReadFence()});
  h.db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,state) VALUES(?,?,?,?,?,?)')
    .run('arca-draining-work','arca','arca_acceptance',prior.offer.offerId,'acceptance_assessment','running');
  result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_execution_draining');
  h.db.prepare("UPDATE fx_supporting_works SET state='cancelled' WHERE work_id='arca-draining-work'").run();
  result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'ready');assert.deepEqual(result.closedOfferIds,[prior.offer.offerId]);
}));

test('withdrawal proof is rejected when its exact Offer or digest is altered, and concurrent writes invalidate its fence',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence()),prior=seedPriorOffer(h,old),
    store=require('../../src/helix/domains/arca/persistence/offer-withdrawal-store').createOfferWithdrawalStore(h.options),
    projection=require('../../src/helix/domains/arca/application/formation-status-projection').createFormationStatusProjection(h.options);
  store.close({...prior,readFence:h.unitOfWork.captureReadFence()});
  const corrupt=replacementReadiness(h,undefined,ids=>{
    const statuses=projection.read(ids),status=statuses.get(prior.offer.offerId);
    statuses.set(prior.offer.offerId,{...status,withdrawalReceipt:{...status.withdrawalReceipt,receiptDigest:D('forged')}});return statuses;
  });
  assert.throws(()=>corrupt.check(replacement.libraRunId),{code:'LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID'});
  const changed=replacementReadiness(h,undefined,ids=>{
    const statuses=projection.read(ids);h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();return statuses;
  });
  assert.throws(()=>changed.check(replacement.libraRunId),{code:'P3_UOW_READ_FENCE_CHANGED'});
}));

test('a missing custom Run target or a package hidden behind a zero head never opens the readiness gate',()=>{
  runHarness(h=>{
    const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=replacementReadiness(h),
      row=h.db.prepare('SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id=?').get(replacement.libraRunId),
      basis=JSON.parse(row.execution_basis_record_json);
    delete basis.collectionTargetRef;
    h.db.prepare('UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id=?').run(canonicalJson(basis),replacement.libraRunId);
    assert.throws(()=>guard.check(replacement.libraRunId));
  });
  runHarness(h=>{
    const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence());
    seedPriorOffer(h,old);h.db.prepare('UPDATE libra_runs SET package_revision_head=0 WHERE libra_run_id=?').run(old);
    assert.throws(()=>replacementReadiness(h).check(replacement.libraRunId),{code:'LIBRA_REPLACEMENT_OFFER_EVIDENCE_INVALID'});
  });
});

test('all superseded ancestor Runs must drain, and a cyclic replacement relation is rejected',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence());
  h.db.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state,superseded_by_run_id) VALUES(?,?,?,?)')
    .run('older-run','subject','superseded',old);
  h.db.prepare('UPDATE libra_runs SET supersedes_run_id=? WHERE libra_run_id=?').run('older-run',old);
  seedDrainingRun(h,'older-run');
  const guard=replacementReadiness(h),result=guard.check(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_execution_draining');
  h.db.prepare('UPDATE libra_runs SET supersedes_run_id=? WHERE libra_run_id=?').run(old,'older-run');
  assert.throws(()=>guard.check(replacement.libraRunId),{code:'LIBRA_REPLACEMENT_RELATION_INVALID'});
}));

for(const outcome of ['accepted','rejected']) test('a '+outcome+' Libra delivery receipt never substitutes for a withdrawal receipt',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence()),prior=seedPriorOffer(h,old);
  h.db.prepare('INSERT INTO libra_delivery_receipts(receipt_id,offer_id,on_deck_package_id,package_digest,result) VALUES(?,?,?,?,?)')
    .run('delivery',prior.offer.offerId,prior.offer.onDeckPackageId,prior.offer.packageDigest,outcome);
  const result=replacementReadiness(h,undefined,()=>new Map()).check(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_offer_outcome_review_required');
}));

test('a stale replacement readiness fence cannot admit new Work after an old Effect appears',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId,replacement=h.advance(h.unitOfWork.captureReadFence()),guard=replacementReadiness(h),
    readiness=guard.check(replacement.libraRunId),run=h.db.prepare('SELECT execution_basis_digest FROM libra_runs WHERE libra_run_id=?').get(replacement.libraRunId);
  assert.equal(readiness.kind,'ready');
  const work={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'replacement-work',ownerDomain:'libra',
    processType:'libra_run',processId:replacement.libraRunId,workKind:'product_gap',workObjectiveTypeRef:'helix://libra/work/ProductGap/v1',
    workObjectiveVersion:1,executionBasisId:'replacement-basis',executionBasisDigest:run.execution_basis_digest,dependencyRefs:[],
    priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'libra',workspaceMaterialScope:[],
    idempotencyKey:'replacement-work-key',concurrencyScope:replacement.libraRunId+'/product',outputContractRef:'helix://libra/results/ProductGap/v1'},
    admission=require('../../src/helix/foundation/execution/work-admission').createWorkAdmission({...h.options,
      eligibilityProvider:{check:request=>({eligible:true,basisDigest:request.executionBasisDigest})},
      limits:{globalOpenWorks:100,ownerOpenWorks:100,openEvents:100}});
  seedDrainingRun(h,old);
  assert.throws(()=>admission.submit(work,{readFence:readiness.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE work_id=?').get('replacement-work').n,0);
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_command_receipts WHERE target_id=?').get('replacement-work').n,0);
  assert.equal(guard.check(replacement.libraRunId).reasonCode,'prior_execution_draining');
  h.db.prepare("UPDATE fx_workflow_events SET state='succeeded' WHERE event_id='draining-event'").run();
  h.db.prepare("UPDATE fx_event_attempts SET state='completed',outcome_kind='succeeded' WHERE event_attempt_id='draining-event-attempt'").run();
  h.db.prepare("UPDATE fx_effect_journal SET state='committed' WHERE effect_id='draining-effect'").run();
  const fresh=guard.check(replacement.libraRunId);
  assert.equal(fresh.kind,'ready');
  assert.equal(admission.submit(work,{readFence:fresh.readFence}).kind,'admitted');
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE work_id=?').get('replacement-work').n,1);
}));

test('an old standard Run loses target currency immediately at confirmation and its stale fence cannot admit Work',()=>runHarness(h=>{
  const {createCurrentRunTargetReader}=require('../../src/helix/domains/libra/application/current-run-target-reader');
  const old=h.chosen.intent.basis.libraRunId,head=h.db.prepare('SELECT * FROM libra_custom_target_heads').get(),
    run=h.db.prepare('SELECT execution_basis_digest FROM libra_runs WHERE libra_run_id=?').get(old);
  // Model the two sides of target confirmation using the exact stored head.
  h.db.prepare('DELETE FROM libra_custom_target_heads').run();
  h.db.prepare("UPDATE libra_runs SET state='active' WHERE libra_run_id=?").run(old);
  const reader=createCurrentRunTargetReader(h.options),before=reader.read(old);
  assert.equal(before.kind,'target_current');assert.ok(before.readFence);
  h.db.prepare('INSERT INTO libra_custom_target_heads(subject_id,product_scope_digest,current_revision,intent_id,record_digest) VALUES(?,?,?,?,?)')
    .run(head.subject_id,head.product_scope_digest,head.current_revision,head.intent_id,head.record_digest);
  assert.equal(reader.read(old).kind,'target_not_current');
  const work={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'old-late-work',ownerDomain:'libra',
    processType:'libra_run',processId:old,workKind:'product_gap',workObjectiveTypeRef:'helix://libra/work/ProductGap/v1',
    workObjectiveVersion:1,executionBasisId:'old-basis',executionBasisDigest:run.execution_basis_digest,dependencyRefs:[],
    priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'libra',workspaceMaterialScope:[],
    idempotencyKey:'old-late-key',concurrencyScope:old+'/product',outputContractRef:'helix://libra/results/ProductGap/v1'},
    admission=require('../../src/helix/foundation/execution/work-admission').createWorkAdmission({...h.options,
      eligibilityProvider:{check:request=>({eligible:true,basisDigest:request.executionBasisDigest})},
      limits:{globalOpenWorks:100,ownerOpenWorks:100,openEvents:100}});
  assert.throws(()=>admission.submit(work,{readFence:before.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(h.db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_id='old-late-work'").get().n,0);
  assert.equal(h.db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE target_id='old-late-work'").get().n,0);
}));

test('target currency alone never proves prior Work drained or a new custom Run ready',()=>runHarness(h=>{
  const {createCurrentRunTargetReader}=require('../../src/helix/domains/libra/application/current-run-target-reader');
  const old=h.chosen.intent.basis.libraRunId;seedDrainingRun(h,old);
  const replacement=h.advance(h.unitOfWork.captureReadFence()),reader=createCurrentRunTargetReader(h.options),
    target=reader.read(replacement.libraRunId);
  assert.equal(target.kind,'target_current');assert.equal(target.targetKind,'user_custom');
  assert.equal(replacementReadiness(h).check(replacement.libraRunId).reasonCode,'prior_execution_draining');
  assert.equal(reader.read(old).kind,'run_not_active');
  h.db.prepare('DELETE FROM libra_custom_target_heads').run();
  assert.throws(()=>reader.read(replacement.libraRunId));
}));

test('target currency and completed drain can be checked under the same opaque read fence',()=>runHarness(h=>{
  const {createCurrentRunTargetReader}=require('../../src/helix/domains/libra/application/current-run-target-reader');
  const replacement=h.advance(h.unitOfWork.captureReadFence()),readiness=replacementReadiness(h).check(replacement.libraRunId),
    reader=createCurrentRunTargetReader(h.options);
  assert.equal(readiness.kind,'ready');
  assert.equal(reader.read(replacement.libraRunId,{readFence:readiness.readFence}).readFence,readiness.readFence);
  h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();
  assert.throws(()=>reader.read(replacement.libraRunId,{readFence:readiness.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
}));

test('old Work cannot start a planning Attempt when target confirmation invalidates its Owner view',()=>runHarness(h=>{
  const {createCurrentRunTargetReader}=require('../../src/helix/domains/libra/application/current-run-target-reader');
  const old=h.chosen.intent.basis.libraRunId,head=h.db.prepare('SELECT * FROM libra_custom_target_heads').get(),
    run=h.db.prepare('SELECT execution_basis_digest FROM libra_runs WHERE libra_run_id=?').get(old);
  h.db.prepare('DELETE FROM libra_custom_target_heads').run();
  h.db.prepare("UPDATE libra_runs SET state='active' WHERE libra_run_id=?").run(old);
  const reader=createCurrentRunTargetReader(h.options),work={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:'planned-old-work',ownerDomain:'libra',processType:'libra_run',processId:old,workKind:'product_gap',
    workObjectiveTypeRef:'helix://libra/work/ProductGap/v1',workObjectiveVersion:1,executionBasisId:'old-basis',
    executionBasisDigest:run.execution_basis_digest,dependencyRefs:[],priorityClass:'normal_foreground',priorityRevision:1,
    capabilityCatalogScope:'libra',workspaceMaterialScope:[],idempotencyKey:'planned-old-key',concurrencyScope:old+'/product',
    outputContractRef:'helix://libra/results/ProductGap/v1'},admission=require('../../src/helix/foundation/execution/work-admission')
      .createWorkAdmission({...h.options,eligibilityProvider:{check:request=>({eligible:true,basisDigest:request.executionBasisDigest})},
        limits:{globalOpenWorks:100,ownerOpenWorks:100,openEvents:100}});
  assert.equal(admission.submit(work,{readFence:reader.read(old).readFence}).kind,'admitted');
  const planningView=reader.read(old);assert.equal(planningView.kind,'target_current');
  h.db.prepare('INSERT INTO libra_custom_target_heads(subject_id,product_scope_digest,current_revision,intent_id,record_digest) VALUES(?,?,?,?,?)')
    .run(head.subject_id,head.product_scope_digest,head.current_revision,head.intent_id,head.record_digest);
  const lifecycle=createWorkLifecycle({...h.options,nextWorkAttemptId:()=> 'planned-old-attempt'});
  assert.throws(()=>lifecycle.ensurePlanningAttempt(work.workId,{readFence:planningView.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(h.db.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(work.workId).state,'admitted');
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_work_attempts WHERE work_id=?').get(work.workId).n,0);
  assert.equal(reader.read(old).kind,'target_not_current');
}));

function inputControlReader(h,materialControlProjectionPort){
  const {createLibraRunInputControlReader}=require('../../src/helix/domains/libra/public');
  const port=materialControlProjectionPort||require('../../src/helix/foundation/persistence/material-control').createMaterialControlProjectionPort(h.options);
  return createLibraRunInputControlReader({...h.options,materialControlProjectionPort:port});
}
function customDispatchGuard(h,baseline=h.readCurrentCustomTargetBaseline,readArcaFormationStatus){
  const {createCurrentRunTargetReader}=require('../../src/helix/domains/libra/application/current-run-target-reader');
  const {createLibraCustomTargetDispatchGuard}=require('../../src/helix/domains/libra/public');
  return createLibraCustomTargetDispatchGuard({targetReader:createCurrentRunTargetReader(h.options),
    replacementReadiness:replacementReadiness(h,undefined,readArcaFormationStatus),customTargetStore:h.targets,
    inputControlReader:inputControlReader(h),readCurrentCustomTargetBaseline:baseline});
}
const dispatchScope=id=>({ownerDomain:'libra',processType:'libra_run',processId:id,workKind:'product_gap',workId:'work',eventId:'event'});

test('custom dispatch combines target currency, complete prior drain and current baseline under one fence',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId;seedDrainingRun(h,old);
  const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=customDispatchGuard(h);
  assert.equal(guard.check(dispatchScope(old)).reasonCode,'run_not_active');
  assert.equal(guard.check(dispatchScope(replacement.libraRunId)).reasonCode,'prior_execution_draining');
  h.db.prepare("UPDATE fx_workflow_events SET state='succeeded' WHERE event_id='draining-event'").run();
  h.db.prepare("UPDATE fx_event_attempts SET state='completed',outcome_kind='succeeded' WHERE event_attempt_id='draining-event-attempt'").run();
  h.db.prepare("UPDATE fx_effect_journal SET state='committed' WHERE effect_id='draining-effect'").run();
  const ready=guard.check(dispatchScope(replacement.libraRunId));assert.equal(ready.kind,'ready');assert.ok(ready.readFence);
  h.setBaseline({standardSpecDigest:D('changed-requirements')});
  assert.deepEqual(guard.check(dispatchScope(replacement.libraRunId)),{kind:'pending',reasonCode:'custom_target_baseline_changed'});
  h.setBaseline({standardSpecDigest:h.chosen.intent.basis.baseSpecDigest,handoffState:'accepted'});
  assert.equal(guard.check(dispatchScope(replacement.libraRunId)).reasonCode,'custom_target_baseline_changed');
  assert.deepEqual(guard.check({ownerDomain:'arca',processType:'arca_ondeck_run'}),{kind:'not_applicable'});
}));

test('custom dispatch refuses a caller snapshot from a different Run Basis',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=customDispatchGuard(h);
  assert.deepEqual(guard.check({...dispatchScope(replacement.libraRunId),executionBasisDigest:D('other-basis')}),
    {kind:'pending',reasonCode:'run_basis_changed'});
}));

test('a suspended custom Run may check its lifecycle without allowing Work dispatch',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=customDispatchGuard(h);
  h.db.prepare("UPDATE libra_runs SET state='suspended' WHERE libra_run_id=?").run(replacement.libraRunId);
  assert.deepEqual(guard.check(dispatchScope(replacement.libraRunId)),{kind:'pending',reasonCode:'run_not_active'});
  const lifecycle=guard.check({...dispatchScope(replacement.libraRunId),purpose:'lifecycle'});
  assert.equal(lifecycle.kind,'ready');assert.ok(lifecycle.readFence);
}));

function guardedCoordinator(h,libraRunId,{changeBeforeAdmission=false}={}){
  const row=h.db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(libraRunId),snapshot={
    run:{libraRunId,subjectId:row.subject_id,acceptanceSpecId:row.acceptance_spec_id,
      executionBasisDigest:row.execution_basis_digest,state:row.state,packageRevisionHead:row.package_revision_head},
    spec:{contentProfile:'movie'},relatedReferences:[]};
  let changed=false;
  const unitOfWork={...h.unitOfWork,execute(participants,settings){
    if(changeBeforeAdmission&&!changed&&participants.some(item=>item.participantId==='work_admission')){
      changed=true;h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();
    }
    return h.unitOfWork.execute(participants,settings);
  }};
  const workResultReader=require('../../src/helix/foundation/execution/work-result-reader').createWorkResultReader(h.options);
  return require('../../src/helix/domains/libra/application/libra-run-coordinator').createLibraRunCoordinator({...h.options,unitOfWork,
    runExecutionGuard:customDispatchGuard(h),workResultReader,workspaceProductPort:{},
    movieProductionReader:{readRunSnapshot:()=>snapshot,readFact:()=>null}});
}

test('actual Run Coordinator waits while the prior execution is draining before admitting any new Work',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId;seedDrainingRun(h,old);
  const replacement=h.advance(h.unitOfWork.captureReadFence()),coordinator=guardedCoordinator(h,replacement.libraRunId),
    result=coordinator.reconcile(replacement.libraRunId);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'prior_execution_draining');
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE process_id=?').get(replacement.libraRunId).n,0);
}));

for(const changed of [false,true])test('actual Run Coordinator '+(changed?'defers a changed Owner view':'admits under the Owner fence'),()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),coordinator=guardedCoordinator(h,replacement.libraRunId,{changeBeforeAdmission:changed}),
    result=coordinator.reconcile(replacement.libraRunId);
  assert.equal(result.kind,'pending');
  assert.equal(changed?result.reasonCode:result.phase,changed?'owner_view_changed':'product_identity_search');
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE process_id=?').get(replacement.libraRunId).n,changed?0:1);
}));

function continuationHarness(callback){return harness(h=>{
  const lifecycle=createWorkLifecycle({...h.options,nextWorkAttemptId:()=> 'unused'}),contextReader=createLibraRunContextReader(h.options),
    scope={subjectId:h.chosen.intent.subjectId,productScopeDigest:h.chosen.intent.basis.productScopeDigest};
  function continuation({publisher=h.publisher,cancelProcessWorks=scope=>lifecycle.cancelProcess(scope),targets=h.targets}={}){
    const creator=createLibraRunCreator({...h.options,contextReader,customTargetStore:targets,cancelProcessWorks});
    return require('../../src/helix/domains/libra/application/custom-target-continuation').createCustomTargetContinuation({
      ...h.options,customTargetStore:targets,customSpecPublicationStore:publisher,libraRunCreator:creator,now:()=>1200});
  }
  return callback({...h,scope,continuation,lifecycle});
},{prepareRun});}

test('persisted custom Intent continues through actual Spec publication and replacement exactly once',()=>continuationHarness(h=>{
  const first=h.continuation().reconcile(h.scope),again=h.continuation().reconcile(h.scope);
  assert.equal(first.kind,'admitted');assert.equal(again.kind,'admitted');assert.equal(again.libraRunId,first.libraRunId);
  assert.equal(again.replayed,true);assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
  assert.equal(h.db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(h.chosen.intent.basis.libraRunId).state,'superseded');
}));

test('continuation resumes a published Spec after interruption without assigning a second revision',()=>continuationHarness(h=>{
  let interrupted=false;
  const publisher={...h.publisher,publish(request){const result=h.publisher.publish(request);
    if(!interrupted){interrupted=true;throw new Error('fixture-after-spec');}return result;}};
  assert.throws(()=>h.continuation({publisher}).reconcile(h.scope),/fixture-after-spec/);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
  assert.equal(h.continuation().reconcile(h.scope).kind,'admitted');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
}));

test('continuation resumes the same admitted Run if cancellation was interrupted',()=>continuationHarness(h=>{
  let calls=0;const cancelProcessWorks=scope=>{if(++calls===1)throw new Error('fixture-after-run');return h.lifecycle.cancelProcess(scope);};
  assert.throws(()=>h.continuation({cancelProcessWorks}).reconcile(h.scope),/fixture-after-run/);
  const run=h.db.prepare('SELECT superseded_by_run_id FROM libra_runs WHERE libra_run_id=?').get(h.chosen.intent.basis.libraRunId).superseded_by_run_id;
  assert.ok(run);const resumed=h.continuation({cancelProcessWorks}).reconcile(h.scope);
  assert.equal(resumed.libraRunId,run);assert.equal(resumed.replayed,true);assert.equal(calls,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
}));

test('continuation keeps a changed standard pending without publishing or replacing',()=>continuationHarness(h=>{
  h.setBaseline({standardSpecDigest:D('changed-standard')});const result=h.continuation().reconcile(h.scope);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'custom_target_baseline_changed');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
}));

test('continuation keeps a changed baseline pending after publication until the exact target is valid again',()=>continuationHarness(h=>{
  let changed=false;const publisher={...h.publisher,publish(request){const result=h.publisher.publish(request);
    if(!changed){changed=true;h.setBaseline({standardSpecDigest:D('changed-after-publication')});}return result;}};
  const first=h.continuation({publisher}).reconcile(h.scope);
  assert.equal(first.kind,'pending');assert.equal(first.reasonCode,'custom_target_baseline_changed');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
  h.setBaseline({standardSpecDigest:h.chosen.intent.basis.baseSpecDigest});
  assert.equal(h.continuation().reconcile(h.scope).kind,'admitted');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
}));

test('continuation rejects a view changed while reading its durable Target Head',()=>continuationHarness(h=>{
  let changed=false;const targets={...h.targets,current(scope){const value=h.targets.current(scope);
    if(!changed){changed=true;h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();}return value;}};
  const result=h.continuation({targets}).reconcile(h.scope);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'owner_view_changed');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
}));

test('continuation rechecks the Target Head after Spec publication before Run admission',()=>continuationHarness(h=>{
  let reads=0;const targets={...h.targets,current(scope){const value=h.targets.current(scope);
    if(++reads===2)h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();return value;}};
  const result=h.continuation({targets}).reconcile(h.scope);
  assert.equal(result.kind,'pending');assert.equal(result.reasonCode,'owner_view_changed');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
}));

test('continuation does not create a target when the durable Head is absent',()=>continuationHarness(h=>{
  h.db.prepare('DELETE FROM libra_custom_target_heads').run();
  assert.equal(h.continuation().reconcile(h.scope).kind,'no_custom_target');
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,1);
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
}));

test('continuation reconstructs the same published Spec after closing and reopening SQLite',()=>continuationHarness(h=>{
  const publication=h.publish(),specId=publication.receipt.resultRef.acceptanceSpecId;
  h.options.kernel.close();
  const fs=require('node:fs'),path=require('node:path'),generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),
    kernel=require('../../src/helix/foundation/persistence/sqlite-kernel').openSqliteKernel({Database:require('better-sqlite3'),
      databasePath:h.options.databasePath,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),
      schemaManifest:h.options.schemaManifest,now:()=>1700000000000});
  try{
    const unitOfWork=require('../../src/helix/foundation/persistence/sqlite-unit-of-work').createSqliteUnitOfWork({kernel}),
      options={...h.options,kernel,unitOfWork},targets=require('../../src/helix/domains/libra/persistence/custom-target-store').createCustomTargetStore(options),
      publisher=require('../../src/helix/domains/libra/persistence/custom-spec-publication-store').createCustomSpecPublicationStore({...options,customTargetStore:targets}),
      lifecycle=createWorkLifecycle({...options,nextWorkAttemptId:()=> 'unused'}),
      creator=createLibraRunCreator({...options,contextReader:createLibraRunContextReader(options),customTargetStore:targets,
        cancelProcessWorks:scope=>lifecycle.cancelProcess(scope)}),
      continuation=require('../../src/helix/domains/libra/application/custom-target-continuation').createCustomTargetContinuation({...options,
        customTargetStore:targets,customSpecPublicationStore:publisher,libraRunCreator:creator,now:()=>1200}),
      result=continuation.reconcile(h.scope);
    assert.equal(result.kind,'admitted');
    assert.equal(h.db.prepare('SELECT acceptance_spec_id FROM libra_runs WHERE libra_run_id=?').get(result.libraRunId).acceptance_spec_id,specId);
    assert.equal(h.db.prepare('SELECT count(*) n FROM libra_acceptance_specs').get().n,2);
  }finally{kernel.close();}
}));

test('custom dispatch refuses unavailable or concurrently changed Owner baselines',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),scope=dispatchScope(replacement.libraRunId),
    pending=customDispatchGuard(h,()=>({kind:'unavailable',reasonCode:'handoff_responsibility_pending'}));
  assert.deepEqual(pending.check(scope),{kind:'pending',reasonCode:'custom_target_baseline_unavailable'});
  const concurrent=customDispatchGuard(h,request=>{
    const value=h.readCurrentCustomTargetBaseline(request);
    h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();return value;
  });
  assert.deepEqual(concurrent.check(scope),{kind:'pending',reasonCode:'owner_view_changed'});
  assert.throws(()=>customDispatchGuard(h,null),TypeError);
}));

test('a custom Run cannot dispatch after its admitted input Control belongs to another Owner',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=customDispatchGuard(h),scope=dispatchScope(replacement.libraRunId);
  assert.equal(guard.check(scope).kind,'ready');
  h.db.prepare("UPDATE fx_material_controls SET owner_domain='arca',owner_scope_type='on_deck',owner_scope_id='other' WHERE owner_domain='libra'").run();
  assert.deepEqual(guard.check(scope),{kind:'pending',reasonCode:'input_control_changed'});
}));

test('changed input Binding and changed Control revision cannot authorize a custom Run',()=>{
  for(const change of ['binding','control_revision'])runHarness(h=>{
    const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=customDispatchGuard(h),scope=dispatchScope(replacement.libraRunId);
    assert.equal(guard.check(scope).kind,'ready');
    if(change==='binding')h.db.prepare("UPDATE libra_material_bindings SET location='/another-location' WHERE authority_kind='primary_control'").run();
    else h.db.prepare('UPDATE fx_material_controls SET control_revision=control_revision+1').run();
    assert.deepEqual(guard.check(scope),{kind:'pending',reasonCode:change==='binding'?'input_binding_changed':'input_control_changed'});
  });
});

test('input Control unavailability, malformed projections and corrupt immutable evidence never authorize dispatch',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),scope={subjectId:'subject',libraRunId:replacement.libraRunId};
  const unavailable=inputControlReader(h,{getMaterialControlProjections:keys=>keys.map(materialKey=>({materialKey,resultKind:'unavailable'}))});
  assert.deepEqual(unavailable.check(scope),{kind:'pending',reasonCode:'input_control_unavailable'});
  const malformed=inputControlReader(h,{getMaterialControlProjections:()=>[]});
  assert.throws(()=>malformed.check(scope),{code:'LIBRA_RUN_INPUT_EVIDENCE_INVALID'});
  const stored=h.db.prepare('SELECT run_material_manifest_id FROM libra_runs WHERE libra_run_id=?').get(replacement.libraRunId);
  h.db.prepare('UPDATE libra_run_material_members SET member_digest=? WHERE run_material_manifest_id=?').run(D('corrupt-member'),stored.run_material_manifest_id);
  assert.throws(()=>inputControlReader(h).check(scope),{code:'LIBRA_RUN_INPUT_EVIDENCE_INVALID'});
}));

test('a Control change during projection invalidates the entire input read fence',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),actual=require('../../src/helix/foundation/persistence/material-control')
    .createMaterialControlProjectionPort(h.options),reader=inputControlReader(h,{getMaterialControlProjections:keys=>{
      const result=actual.getMaterialControlProjections(keys);h.db.prepare('UPDATE fx_material_controls SET control_revision=control_revision+1').run();return result;
    }});
  assert.throws(()=>reader.check({subjectId:'subject',libraRunId:replacement.libraRunId}),{code:'P3_UOW_READ_FENCE_CHANGED'});
}));

test('a Foundation Control release changes the real projection and blocks custom dispatch',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),guard=customDispatchGuard(h),scope=dispatchScope(replacement.libraRunId),
    before=guard.check(scope),row=h.db.prepare('SELECT * FROM fx_material_controls').get();
  assert.equal(before.kind,'ready');
  const control=require('../../src/helix/foundation/persistence/material-control'),identity={
    schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:row.material_key,
    mountScopeId:row.mount_scope_id,inode:row.inode,sizeBytes:row.size_bytes,fingerprintAlgorithm:row.fingerprint_algorithm,
    fingerprintVersion:Number(row.fingerprint_version),contentFingerprint:row.content_fingerprint},
    change={action:'release',identity,expectedRevision:row.control_revision,fromScope:{ownerDomain:'libra',scopeType:'subject',scopeId:'subject'},toScope:null},
    handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:'fixture-control-release',
      operationKind:'release',ownerDomain:'libra',processType:'libra_run',processId:replacement.libraRunId,
      basisRef:{objectType:'fixture',objectId:'fixture',revision:1,digest:D('basis-ref')},basisDigest:D('basis'),
      canonicalFactSetDigest:D('facts'),bindingSetDigest:D('bindings'),controlScopeDigest:control.controlScopeDigest([change]),
      expectedControlRevisions:[{materialKey:identity.materialKey,revision:row.control_revision}],eventFenceDigest:D('fence'),
      receiptContract:{receiptSchemaRef:'fixture.receipt@1',controlRevisionSetSchemaRef:'fixture.revisions@1'}};
  const markers=require('../../src/helix/foundation/persistence/owner-repository').createRepositoryDefinition({repositoryId:'fixture_release_marker',
    owner:'execution-foundation',schemaManifest:h.options.schemaManifest,statements:{insert:{kind:'insert',tableId:'fx_commit_markers',
      columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','committed_at_ms']}}});
  h.unitOfWork.execute([control.createMaterialControlParticipant({schemaManifest:h.options.schemaManifest,handle,changes:[change],commitMarker:'fixture-release'}),
    {participantId:'fixture_release_marker',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[markers],execute(context){
      context.repository(markers.repositoryId).invoke('insert',{commit_marker:'fixture-release',owner_domain:'libra',scope_type:'subject',
        scope_id:'subject',commit_digest:D('release'),committed_at_ms:context.commitTimeMs});
    }}]);
  assert.deepEqual(guard.check(scope),{kind:'pending',reasonCode:'input_control_changed'});
  const targetReader=require('../../src/helix/domains/libra/application/current-run-target-reader').createCurrentRunTargetReader(h.options);
  assert.throws(()=>targetReader.read(replacement.libraRunId,{readFence:before.readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(h.db.prepare('SELECT control_revision FROM fx_material_controls WHERE material_key=?').get(identity.materialKey).control_revision,2);
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_material_control_revisions WHERE material_key=?').get(identity.materialKey).n,2);
}));

test('a forged Run execution basis fails reconstruction even when the input manifest itself is intact',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),run=h.db.prepare('SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id=?').get(replacement.libraRunId),
    basis=JSON.parse(run.execution_basis_record_json);basis.relatedDispositionScope.relatedReferenceSetDigest=D('forged-related-scope');
  h.db.prepare('UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id=?').run(canonicalJson(basis),replacement.libraRunId);
  assert.throws(()=>inputControlReader(h).check({subjectId:'subject',libraRunId:replacement.libraRunId}),{code:'LIBRA_RUN_INPUT_EVIDENCE_INVALID'});
}));

test('an old standard Run is blocked by the confirmed Head even before replacement admission',()=>runHarness(h=>{
  const old=h.chosen.intent.basis.libraRunId;h.db.prepare("UPDATE libra_runs SET state='active' WHERE libra_run_id=?").run(old);
  assert.deepEqual(customDispatchGuard(h).check(dispatchScope(old)),{kind:'pending',reasonCode:'target_not_current'});
}));

test('target currency reader rejects corrupted Run and Spec identity rather than authorizing dispatch',()=>runHarness(h=>{
  const {createCurrentRunTargetReader}=require('../../src/helix/domains/libra/application/current-run-target-reader');
  const replacement=h.advance(h.unitOfWork.captureReadFence()),reader=createCurrentRunTargetReader(h.options),
    row=h.db.prepare('SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id=?').get(replacement.libraRunId),
    basis=JSON.parse(row.execution_basis_record_json);
  basis.acceptanceSpec.productScopeDigest=D('wrong-scope');
  h.db.prepare('UPDATE libra_runs SET execution_basis_record_json=? WHERE libra_run_id=?').run(canonicalJson(basis),replacement.libraRunId);
  assert.throws(()=>reader.read(replacement.libraRunId),{code:'LIBRA_RUN_TARGET_EVIDENCE_INVALID'});
}));

function handoffReader(h,arca){
  const {createLibraHandoffResponsibilityReader}=require('../../src/helix/domains/libra/public');
  const projection=arca||require('../../src/helix/domains/arca/public').createArcaOfferResponsibilityProjection(h.options);
  return createLibraHandoffResponsibilityReader({...h.options,readArcaOfferResponsibility:offer=>projection.read(offer)});
}
function handoffRequest(h){return {subjectId:h.chosen.intent.subjectId,libraRunId:h.chosen.intent.basis.libraRunId,
  productScopeDigest:h.chosen.intent.basis.productScopeDigest};}

test('Libra reads exact Run Offer responsibility through Arca Owner projections',()=>runHarness(h=>{
  const request=handoffRequest(h),reader=handoffReader(h);
  assert.deepEqual(reader.read(request),{kind:'ready',...request,handoffState:'no_offer'});
  assert.equal(h.advance(h.unitOfWork.captureReadFence()).kind,'admitted');
  const prior=seedPriorOffer(h,request.libraRunId);
  assert.deepEqual(reader.read(request),{kind:'ready',...request,handoffState:'not_accepted'});
  h.db.pragma('foreign_keys = OFF');
  h.db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
    .run('accepted-attempt',prior.offer.offerId,prior.offer.onDeckPackageId,prior.offer.packageDigest,prior.offer.shelfId,'accepted');
  assert.deepEqual(reader.read(request),{kind:'ready',...request,handoffState:'accepted'});
}));

test('exact Run responsibility fails closed on a hidden Offer or unavailable Arca view',()=>runHarness(h=>{
  const request=handoffRequest(h);h.advance(h.unitOfWork.captureReadFence());seedPriorOffer(h,request.libraRunId);
  const missing=handoffReader(h,{read:()=>({kind:'unavailable'})});
  assert.equal(missing.read(request).kind,'unavailable');
  const mismatched=handoffReader(h,{read:offer=>({kind:'ready',offer:{...offer,subjectId:'other'},state:'not_accepted'})});
  assert.throws(()=>mismatched.read(request),{code:'LIBRA_HANDOFF_RESPONSIBILITY_INVALID'});
  h.db.prepare('UPDATE libra_runs SET package_revision_head=0 WHERE libra_run_id=?').run(request.libraRunId);
  assert.throws(()=>handoffReader(h).read(request),{code:'LIBRA_HANDOFF_RESPONSIBILITY_INVALID'});
  assert.throws(()=>handoffReader(h).read({...request,productScopeDigest:D('other-scope')}),{code:'LIBRA_HANDOFF_RESPONSIBILITY_INVALID'});
}));

test('an Arca change during the exact Offer read invalidates the caller\'s shared fence',()=>runHarness(h=>{
  const request=handoffRequest(h);h.advance(h.unitOfWork.captureReadFence());const prior=seedPriorOffer(h,request.libraRunId),
    arca=require('../../src/helix/domains/arca/public').createArcaOfferResponsibilityProjection(h.options),
    reader=handoffReader(h,{read:offer=>{const result=arca.read(offer);h.db.pragma('foreign_keys = OFF');
      h.db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
        .run('concurrent-accepted',prior.offer.offerId,prior.offer.onDeckPackageId,prior.offer.packageDigest,prior.offer.shelfId,'accepted');
      return result;}}),fence=h.unitOfWork.captureReadFence();
  assert.throws(()=>reader.read(request,{readFence:fence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(handoffReader(h).read(request).handoffState,'accepted');
}));

test('Run responsibility checks every bounded Offer page and finds acceptance beyond the first page',()=>runHarness(h=>{
  const request=handoffRequest(h);h.advance(h.unitOfWork.captureReadFence());let last;
  for(let revision=1;revision<=101;revision++)last=seedPriorOffer(h,request.libraRunId,revision);
  h.db.pragma('foreign_keys = OFF');
  h.db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
    .run('accepted-later-page',last.offer.offerId,last.offer.onDeckPackageId,last.offer.packageDigest,last.offer.shelfId,'accepted');
  assert.equal(handoffReader(h).read(request).handoffState,'accepted');
  h.db.prepare('DELETE FROM libra_product_packages WHERE package_revision=2 AND libra_run_id=?').run(request.libraRunId);
  assert.throws(()=>handoffReader(h).read(request),{code:'LIBRA_HANDOFF_RESPONSIBILITY_INVALID'});
}));

test('real Arca withdrawal and Owner projections compose into the custom dispatch fence',()=>runHarness(h=>{
  const replacement=h.advance(h.unitOfWork.captureReadFence()),request=handoffRequest(h),prior=seedPriorOffer(h,request.libraRunId),
    source=h.data.inputSet,subject={...source.subjectSnapshot,currentIdentityRevision:1,currentIdentityDigest:h.chosen.intent.basis.identityDigest};
  subject.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(subject).filter(([key])=>key!=='snapshotDigest')));
  let handoffFence;const inputSet=buildDecisionInputSet({...source,subjectSnapshot:subject}),responsibility=handoffReader(h),
    baseline=createCustomTargetBaselineReader({acceptanceSpecContextReader:{read:()=>({kind:'ready',inputSet})},
      readHandoffResponsibility:(request,options)=>{handoffFence=options.readFence;return responsibility.read(request,options);}}),
    formation=require('../../src/helix/domains/arca/application/formation-status-projection').createFormationStatusProjection(h.options),
    guard=customDispatchGuard(h,baseline.read,ids=>formation.read(ids));
  assert.equal(guard.check(dispatchScope(replacement.libraRunId)).reasonCode,'prior_offer_closure_unproven');
  require('../../src/helix/domains/arca/persistence/offer-withdrawal-store').createOfferWithdrawalStore(h.options)
    .close({...prior,readFence:h.unitOfWork.captureReadFence()});
  assert.equal(responsibility.read(request).handoffState,'not_accepted');
  const ready=guard.check(dispatchScope(replacement.libraRunId));assert.equal(ready.kind,'ready');assert.ok(ready.readFence);
  assert.equal(handoffFence,ready.readFence);
  const run=h.db.prepare('SELECT execution_basis_digest FROM libra_runs WHERE libra_run_id=?').get(replacement.libraRunId),
    work={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'owner-composed-work',ownerDomain:'libra',
      processType:'libra_run',processId:replacement.libraRunId,workKind:'product_gap',workObjectiveTypeRef:'helix://libra/work/ProductGap/v1',
      workObjectiveVersion:1,executionBasisId:'owner-composed-basis',executionBasisDigest:run.execution_basis_digest,dependencyRefs:[],
      priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'libra',workspaceMaterialScope:[],
      idempotencyKey:'owner-composed-key',concurrencyScope:replacement.libraRunId+'/product',outputContractRef:'helix://libra/results/ProductGap/v1'},
    admission=require('../../src/helix/foundation/execution/work-admission').createWorkAdmission({...h.options,
      eligibilityProvider:{check:value=>({eligible:true,basisDigest:value.executionBasisDigest})},
      limits:{globalOpenWorks:100,ownerOpenWorks:100,openEvents:100}});
  assert.equal(admission.submit(work,{readFence:ready.readFence}).kind,'admitted');
  const later=guard.check(dispatchScope(replacement.libraRunId));assert.equal(later.kind,'ready');
  h.db.prepare('UPDATE libra_subjects SET intake_revision=intake_revision+1').run();
  assert.throws(()=>admission.submit({...work,workId:'owner-stale-work',idempotencyKey:'owner-stale-key'},{readFence:later.readFence}),
    {code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(h.db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE work_id='owner-stale-work'").get().n,0);
  assert.equal(h.db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE target_id='owner-stale-work'").get().n,0);
}));
