'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {CAPABILITY,FRAME,EMBED}=require('../../src/helix/contracts/us-adult-catalogue-work-types');
const {catalogueFrameWork}=require('../../src/helix/domains/libra/model/us-adult-catalogue-frame-work');
const {catalogueObservationWork,initialCompletedCatalogueBatch}=require('../../src/helix/domains/libra/model/us-adult-catalogue-observation-work');
const {readCompletedCatalogueBatches,exactCatalogueResult}=require('../../src/helix/domains/libra/model/us-adult-catalogue-work-results');
const {validateSupportingWorkDefinition}=require('../../src/helix/foundation/execution/runtime-contracts');

test('a complete qualified initial Observation stops further sampling and remains evidence rather than a Person or Cast',async t=>{
  const f=coordination(t),first=f.reconcile();assert.equal(first.phase,'us_adult_catalogue_initial_frames');assert.equal(first.kind,'pending');
  assert.equal(f.store.getByRun('run').basisDigest,f.basis.basisDigest);
  await f.completeFrames('initial');const pending=f.reconcile();assert.equal(pending.phase,'us_adult_catalogue_initial_observation');
  const completed=await f.completeObservation('initial'),result=f.reconcile();
  assert.equal(result.kind,'catalogue_candidate');assert.equal(result.assessment.winner.name,'Example Performer');
  assert.equal(Object.hasOwn(result.assessment.winner,'personId'),false);assert.equal(result.completedBatches.batches.length,1);
  assert.equal(f.submissions.some(work=>work.workObjectiveTypeRef.includes('supplement')),false);
  assert.deepEqual(f.reconcile(),result);assert.equal(validateSupportingWorkDefinition(completed.work).workId,pending.workId);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,3);
});

test('only an unqualified complete initial assessment admits supplementation and the second lookup includes both complete batches',async t=>{
  const f=coordination(t);f.reconcile();const first=await f.completeFrames('initial');
  assert.equal(f.reconcile().phase,'us_adult_catalogue_initial_observation');
  assert.equal(f.submissions.some(work=>work.workObjectiveTypeRef.includes('supplement')),false);
  const initial=await f.completeObservation('initial',{match:false});assert.equal(initial.observation.resultKind,'observed');
  assert.equal(f.reconcile().phase,'us_adult_catalogue_supplement_frames');const second=await f.completeFrames('supplement');
  assert.equal(f.reconcile().phase,'us_adult_catalogue_initial_and_supplement_observation');
  const merged=await f.completeObservation('initial_and_supplement'),result=f.reconcile();
  assert.equal(result.kind,'catalogue_candidate');assert.equal(result.observation.frameEvidenceRefs.length,40);
  assert.deepEqual(initialCompletedCatalogueBatch(merged.completedBatches),initial.completedBatches);
  assert.deepEqual(merged.work.dependencyRefs.map(ref=>ref.objectId),[initial.work.workId,second.workId]);
  assert.equal(initial.work.dependencyRefs[0].objectId,first.workId);assert.notEqual(initial.work.workId,merged.work.workId);
  assert.equal(validateSupportingWorkDefinition(merged.work).workId,merged.work.workId);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n,6);
  const expedited=catalogueObservationWork({snapshot:{...f.args.snapshot,run:{...f.args.snapshot.run,priorityClass:'expedited'}},
    basis:f.basis,completedBatches:merged.completedBatches,validator:f.validator});
  assert.equal(expedited.workId,merged.work.workId);assert.equal(expedited.priorityClass,'expedited_formation');
});

test('no faces after both bounded stages is explicit and does not manufacture a match or add a third stage',async t=>{
  const f=coordination(t,{noFaces:true});f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial');
  assert.equal(f.reconcile().phase,'us_adult_catalogue_supplement_frames');await f.completeFrames('supplement');
  await f.completeObservation('initial_and_supplement');const result=f.reconcile();
  assert.equal(result.kind,'catalogue_unresolved');assert.equal(result.assessment.status,'no_faces');
  assert.equal(result.observation.queries.length,0);assert.equal(result.assessment.winner,null);assert.deepEqual(f.reconcile(),result);
  const handles=result.completedBatches.batches.map(batch=>batch.faceClusterSetHandle);
  assert.notEqual(handles[0].clusterDigest,handles[1].clusterDigest);assert.notEqual(handles[0].artifactHandleId,handles[1].artifactHandleId);
});

test('a very short clip with no remaining unique timestamps finishes unresolved without an empty supplemental Work',async t=>{
  const f=coordination(t,{durationMs:1,noFaces:true});f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial');
  const result=f.reconcile();assert.equal(result.kind,'catalogue_unresolved');assert.equal(result.observation.frameEvidenceRefs.length,1);
  assert.equal(f.submissions.some(work=>work.workObjectiveTypeRef.includes('supplement')),false);
});

test('an oversized Observation Handle is rejected before controlled Artifact bytes are read',async t=>{
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');const final=await f.completeObservation('initial'),
    record=f.records.get(final.work.workId)[0],result=JSON.parse(canonicalJson(record.result));
  result.observationArtifactHandle.sizeBytes=8*1024*1024+1;const{handleDigest,...body}=result;result.handleDigest=D(body);
  f.records.set(final.work.workId,[{...record,result,resultDigest:D(result)}]);
  let reads=0;f.options.workspaceProductPort.readArtifactBytes=()=>{reads++;throw Error('Must reject before reading bytes');};
  assert.throws(f.reconcile,{code:'US_ADULT_CATALOGUE_HANDLE_INVALID'});assert.equal(reads,0);
});

test('Artifact read failure and cancellation after a read remain failures rather than permission for more sampling',async t=>{
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial');
  const read=f.options.workspaceProductPort.readArtifactBytes;
  f.options.workspaceProductPort.readArtifactBytes=()=>{throw Object.assign(Error('Read unavailable'),{code:'READ_UNAVAILABLE'});};
  assert.throws(f.reconcile,{code:'READ_UNAVAILABLE'});assert.equal(f.submissions.some(work=>work.workObjectiveTypeRef.includes('supplement')),false);
  f.options.workspaceProductPort.readArtifactBytes=handle=>{const value=read(handle);f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");return value;};
  assert.throws(f.reconcile,{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
});

test('failed lookup and missing completed producer evidence cannot be reclassified as unresolved or grant supplementation',async t=>{
  const f=coordination(t);f.reconcile();const frames=await f.completeFrames('initial'),observing=f.reconcile();
  f.statuses.set(observing.workId,{state:'failed',latestAttempt:{attempt_id:'failed',state:'failed'},failure_code:'CATALOGUE_UNAVAILABLE'});
  assert.equal(f.reconcile().kind,'failed');assert.equal(f.submissions.some(work=>work.workObjectiveTypeRef.includes('supplement')),false);
  f.records.set(frames.workId,f.records.get(frames.workId).filter(record=>record.capabilityRef!==EMBED));
  assert.throws(f.reconcile,{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});
  f.statuses.set(f.source.workId,{state:'cancelled'});assert.equal(f.reconcile().kind,'failed');
});

test('manual choice before sampling or while reading a late automatic result wins without creating a Person',async t=>{
  const f=coordination(t);f.choice.current={intentId:'manual',subjectId:'subject'};
  assert.equal(f.reconcile().kind,'manual_choice_present');assert.equal(f.submissions.length,0);assert.equal(f.store.getByRun('run'),null);
  f.choice.current=null;f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial');
  const read=f.options.workspaceProductPort.readArtifactBytes;
  f.options.workspaceProductPort.readArtifactBytes=handle=>{const result=read(handle);f.choice.current={intentId:'late-manual'};return result;};
  assert.equal(f.reconcile().kind,'manual_choice_present');assert.equal(f.submissions.some(work=>work.workObjectiveTypeRef.includes('supplement')),false);
});

test('replanning cannot consume a previous Attempt success, a duplicate current Result or a different current Plan',async t=>{
  const f=coordination(t);f.reconcile();const work=await f.completeFrames('initial'),records=f.records.get(work.workId),original=records[0];
  records.unshift({...original,attemptId:'old-attempt',planId:'old-plan',resultId:'old-result'});
  assert.equal(readCompletedCatalogueBatches(f.options,f.args.snapshot,f.basis,'initial').batches[0].sourceResultRefs[0].attemptId,original.attemptId);
  f.statuses.set(work.workId,{state:'succeeded',latestAttempt:{attempt_id:'new-attempt',state:'succeeded'}});
  assert.throws(()=>exactCatalogueResult(f.options,work,FRAME),{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});
  assert.throws(()=>exactCatalogueResult(f.options,work,FRAME,{workAttemptId:original.attemptId,planId:'other'}),{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});
  f.statuses.set(work.workId,{state:'succeeded',latestAttempt:{attempt_id:original.attemptId,state:'succeeded'}});records.push({...original,resultId:'duplicate'});
  assert.throws(()=>readCompletedCatalogueBatches(f.options,f.args.snapshot,f.basis,'initial'),{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});
});

test('a cancelled Run or substituted successful lookup cannot advance through historical catalogue evidence',async t=>{
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');const final=await f.completeObservation('initial'),record=f.records.get(final.work.workId)[0];
  f.records.set(final.work.workId,[{...record,resultDigest:D('other')}]);assert.throws(f.reconcile,{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});
  f.records.set(final.work.workId,[record]);f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");
  assert.throws(f.reconcile,{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
  assert.equal(catalogueFrameWork(f.args.snapshot,f.basis,'initial').workId,final.completedBatches.batches[0].workId);
  assert.equal(record.capabilityRef,CAPABILITY);
});
