'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buffaloModelReference}=require('../../src/helix/contracts/buffalo-model-reference');
const {normalizeName,queryNames}=require('../../src/helix/contracts/us-adult-name-query');
const {createUsAdultCatalogueDecisionInput}=require('../../src/helix/domains/libra/model/us-adult-catalogue-decision-input');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {createPeopleImageOperationStore}=require('../../src/helix/domains/people/persistence/people-image-operation-store');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const {createPeopleImageExecutionRegistration}=require('../../src/helix/domains/people/public/image-execution-registration');
const {createUsAdultCatalogueSettlementCoordinator}=require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-coordinator');
const {createUsAdultCatalogueDecisionStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-decision-store');
const {preparationWork}=require('../../src/helix/domains/people/application/people-image-operation-coordinator');
const {createPeopleReferencePreparation}=require('../../src/helix/integrations/people-reference-preparation');
const currentSelection=require('../../src/helix/domains/libra/model/us-adult-actor-selection-current');

const png=Buffer.from([137,80,78,71,13,10,26,10,1]);

function stageUpload({bytes,actorId,idempotencyKey,provenance}){
  const digestHex=crypto.createHash('sha256').update(bytes).digest('hex');
  const basis={schemaRef:'helix://contracts/domain-types/PeopleSelectedImageHandle/v1',schemaVersion:1,
    uploadId:D({schema:'people.selected-upload@1',actorId,idempotencyKey,digestHex}),
    digestHex,sizeBytes:bytes.length,mediaType:'image/png',provenance};
  return {...basis,handleDigest:D(basis)};
}
function providerObservation(name,aliases=[],images=[{imageId:'photo-1',urlDigest:D('url'),width:100,height:100}]){
  const names=queryNames(name,aliases);
  const person={providerKey:'tpdb-1',canonicalName:name,aliases:[],images};
  const queries=names.map(term=>({term,limit:10,completion:'complete',responseDigest:D('provider-'+term),
    candidates:term===normalizeName(name)?[person]:[]}));
  const body={schema:'people.us-adult-provider-search-observation@1',provider:'theporndb',queries};
  return {...body,observationDigest:D(body)};
}
function catalogueOps(db){
  return db.prepare('SELECT payload_json FROM people_image_operations').all()
    .map(row=>JSON.parse(row.payload_json)).filter(payload=>payload.operationKind==='catalogue_registration');
}
function assertNotStubStall(result,ops){
  const stalled=(result?.pendingCode==='PEOPLE_CATALOGUE_EVIDENCE_PENDING'||result?.pendingCode==='PEOPLE_CATALOGUE_EVIDENCE_UNWIRED')&&ops.length===0;
  if(stalled)assert.fail('PEOPLE_CATALOGUE_EVIDENCE_PENDING with zero catalogue_registration ops');
}
async function scene(t){
  const f=coordination(t);
  f.reconcile();
  await f.completeFrames('initial');
  await f.completeObservation('initial');
  f.options.movieProductionReader.readFact=()=>f.identity;
  const catalogue=f.reconcile();
  assert.equal(catalogue.kind,'catalogue_candidate');
  const compiled=createUsAdultCatalogueDecisionInput(f.options).compile({libraRunId:'run',mode:'initial'});
  const resolution=resolveUsAdultName({name:compiled.input.winner.name,aliases:compiled.input.winner.aliases,people:[]});
  assert.equal(resolution.kind,'not_found');
  return {f,catalogue,input:compiled.input,inputDigest:compiled.inputDigest,resolution};
}
function executionFor(f,{observe,readImageBytes,buildFrameImageProof,artifacts}){
  const store=createPeopleImageOperationStore(f.workspaceOptions);
  const port={stageUpload,readArtifact(handle){return artifacts.get(handle.artifactHandleId);}};
  const execution=createPeopleImageExecutionRegistration({
    ...f.workspaceOptions,contractValidator:f.validator,workResultReader:f.options.workResultReader,
    peopleImagePort:port,operationStore:store,
    catalogueInputReader:createUsAdultCatalogueDecisionInput(f.options),
    workspaceProductPort:f.options.workspaceProductPort,
    artifactRepository:{get:id=>artifacts.get(id)},
  });
  const admission=execution.createCatalogueRegistrationAdmission({
    observeProviderSearch:observe,readImageBytes,buildFrameImageProof,peopleImagePort:port,operationStore:store,
    catalogueInputReader:createUsAdultCatalogueDecisionInput(f.options),
    workspaceProductPort:f.options.workspaceProductPort,
    artifactRepository:{get:id=>artifacts.get(id)},
  });
  return {execution,admission,store,port};
}

test('local reference preparation delegates buffalo single_reference_face',async()=>{
  let called=0;
  const preparation=createPeopleReferencePreparation({
    imagePort:{readUpload(){return png;},readArtifact(){return png;},materialize(){return {artifactHandleId:'artifact'};}},
    faceModel:{async analyzeImage(){throw new Error('local model');}},
    buffaloPreparation:{computeEmbedding(){called+=1;return {delegated:true};}},
  });
  const result=await preparation.computeEmbedding({
    context:{assertExecutionActive(){}},personId:'person',operationId:'operation',referenceRevision:1,
    artifactHandle:{},faceModelRef:buffaloModelReference('single_reference_face'),
  });
  assert.equal(called,1);
  assert.deepEqual(result,{delegated:true});
});

test('wired catalogue admission creates a catalogue_registration operation instead of the evidence stub',async t=>{
  const sceneValue=await scene(t);
  const {admission}=executionFor(sceneValue.f,{
    observe:({name,aliases})=>providerObservation(name,aliases),
    readImageBytes:()=>png,
    artifacts:new Map(),
  });
  const result=admission.registerCataloguePerson({
    input:sceneValue.input,inputDigest:sceneValue.inputDigest,resolution:sceneValue.resolution,candidate:sceneValue.catalogue,
  });
  const ops=catalogueOps(sceneValue.f.db);
  assertNotStubStall(result,ops);
  assert.equal(result.kind,'pending');
  assert.equal(result.pendingCode,'PEOPLE_CATALOGUE_IMAGE_PREP_PENDING');
  assert.equal(ops.length,1);
  assert.equal(ops[0].operationKind,'catalogue_registration');
  assert.equal(D(ops[0].faceModelRef),D(buffaloModelReference('single_reference_face')));
  assert.equal(ops[0].selectedImage.provenance.source,'stashbox');
  assert.equal(Object.hasOwn(ops[0].selectedImage.provenance,'providerKey'),false);
  assert.equal(Object.hasOwn(ops[0].selectedImage.provenance,'imageId'),false);
  sceneValue.f.validator.validate(
    'helix://contracts/domain-types/PeopleSelectedImageHandle/v1',ops[0].selectedImage);
  assert.ok(result.workId);
});

test('provider with no image falls back to a catalogue frame and still opens registration prep',async t=>{
  const sceneValue=await scene(t);
  const {input,catalogue}=sceneValue;
  const {admission}=executionFor(sceneValue.f,{
    observe:({name,aliases})=>providerObservation(name,aliases,[]),
    readImageBytes:()=>png,
    buildFrameImageProof(){
      const observation=catalogue.observation;
      const group=observation.groups.find(item=>input.winner.groupIds.includes(item.clusterId));
      const key=group.representativeKeys[0];
      const [ordinal,faceOrdinal]=key.split(':').map(Number);
      const frame=observation.frameEvidenceRefs[ordinal],face=frame.faces[faceOrdinal];
      const bytes=Buffer.alloc(300,7);
      const imageDigest=crypto.createHash('sha256').update(bytes).digest('hex');
      const value={schema:'shared.buffalo-representative-image@1',basisDigest:input.catalogueBasisDigest,
        frameEvidenceDigest:frame.frameEvidenceDigest,sourceImageDigest:frame.imageDigest,faceOrdinal,
        faceEvidenceDigest:face.faceEvidenceDigest,modelRefDigest:observation.modelRefDigest,
        coordinateSpaceDigest:D('canvas'),renderingPolicyDigest:input.representativeImagePolicyDigest,
        rectangle:{left:0,top:0,width:100,height:100},encoding:'png',imageDigest,imageBytes:bytes.length};
      return {kind:'frame',bytes,proof:{...value,proofDigest:D(value)}};
    },
    artifacts:new Map(),
  });
  const result=admission.registerCataloguePerson({
    input,inputDigest:sceneValue.inputDigest,resolution:sceneValue.resolution,candidate:catalogue,
  });
  const ops=catalogueOps(sceneValue.f.db);
  assertNotStubStall(result,ops);
  assert.equal(ops.length,1);
  assert.equal(ops[0].selectedImage.provenance.source,'catalogue_frame');
  assert.equal(Object.hasOwn(ops[0].selectedImage.provenance,'proofDigest'),false);
  sceneValue.f.validator.validate(
    'helix://contracts/domain-types/PeopleSelectedImageHandle/v1',ops[0].selectedImage);
  assert.equal(result.pendingCode,'PEOPLE_CATALOGUE_IMAGE_PREP_PENDING');
});

test('provider with no image and no frame proof fails closed instead of workless pending',async t=>{
  const sceneValue=await scene(t);
  const {admission}=executionFor(sceneValue.f,{
    observe:({name,aliases})=>providerObservation(name,aliases,[]),
    readImageBytes:()=>png,
    artifacts:new Map(),
  });
  const result=admission.registerCataloguePerson({
    input:sceneValue.input,inputDigest:sceneValue.inputDigest,resolution:sceneValue.resolution,candidate:sceneValue.catalogue,
  });
  const ops=catalogueOps(sceneValue.f.db);
  assert.equal(ops.length,0);
  assert.equal(result.kind,'failed');
  assert.equal(result.reasonCode,'PEOPLE_CATALOGUE_FRAME_PROOF_UNWIRED');
  assert.equal(result.workId,undefined);
  assert.notEqual(result.kind,'pending');
  assert.notEqual(result.pendingCode,'PEOPLE_CATALOGUE_FRAME_PROOF_PENDING');
});

test('succeeded catalogue_registration prep writes the Person and settlement reaches face_catalogue',async t=>{
  const sceneValue=await scene(t);
  const artifacts=new Map();
  const records=new Map();
  const reader={
    status(id){return records.get(id)?.status||sceneValue.f.options.workResultReader.status(id);},
    read(id){return records.get(id)?.read||sceneValue.f.options.workResultReader.read(id);},
    readDefinition(id){return records.get(id)?.readDefinition||null;},
  };
  const store=createPeopleImageOperationStore(sceneValue.f.workspaceOptions);
  const port={stageUpload,readArtifact(handle){
    const bytes=artifacts.get(handle.artifactHandleId);
    if(!bytes)throw new Error('missing artifact '+handle.artifactHandleId);
    return bytes;
  }};
  const execution=createPeopleImageExecutionRegistration({
    ...sceneValue.f.workspaceOptions,contractValidator:sceneValue.f.validator,workResultReader:reader,
    peopleImagePort:port,operationStore:store,
    catalogueInputReader:createUsAdultCatalogueDecisionInput(sceneValue.f.options),
    workspaceProductPort:sceneValue.f.options.workspaceProductPort,
    artifactRepository:{get:id=>artifacts.get('record:'+id)||null},
  });
  const admission=execution.createCatalogueRegistrationAdmission({
    observeProviderSearch:({name,aliases})=>providerObservation(name,aliases),
    readImageBytes:()=>png,
    peopleImagePort:port,operationStore:store,
    catalogueInputReader:createUsAdultCatalogueDecisionInput(sceneValue.f.options),
    workspaceProductPort:sceneValue.f.options.workspaceProductPort,
    artifactRepository:{get:id=>artifacts.get('record:'+id)||null},
  });
  const pendingResult=admission.registerCataloguePerson({
    input:sceneValue.input,inputDigest:sceneValue.inputDigest,resolution:sceneValue.resolution,candidate:sceneValue.catalogue,
  });
  const ops=catalogueOps(sceneValue.f.db);
  assertNotStubStall(pendingResult,ops);
  assert.equal(pendingResult.pendingCode,'PEOPLE_CATALOGUE_IMAGE_PREP_PENDING');
  const operation=store.get(ops[0].operationId);
  const work=preparationWork(operation);
  const imageDigest=operation.payload.selectedImage.digestHex;
  const vector=Array(512).fill(0);vector[0]=1;
  const featureBytes=Buffer.from(canonicalJson({schema:'shared.face-embedding-set@1',dimension:512,vectors:[vector]}));
  const artifact=(artifactHandleId,artifactKind,digestHex,mediaType,sizeBytes)=>({
    schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId,artifactKind,ownerDomain:'people',
    ownerScope:{scopeType:'person',scopeId:operation.personId},storageRef:'people-artifact:'+artifactHandleId,
    digestAlgorithm:'sha256',digestHex,sizeBytes,mediaType,
    provenanceRef:{objectType:'people_image_operation',objectId:operation.operationId,revision:1,digest:D('provenance')},
    referenceRevision:1});
  const photo=artifact('photo','reference-image',imageDigest,'image/png',png.length);
  const embeddingDigest=crypto.createHash('sha256').update(featureBytes).digest('hex');
  const embeddingArtifact=artifact('embedding','reference-embedding',embeddingDigest,'application/vnd.shelfdeck.face-embedding+json',featureBytes.length);
  const embeddingBody={schemaRef:'helix://contracts/types/FaceEmbeddingSetHandle/v1',schemaVersion:1,artifactHandleId:'embedding',
    artifactHandle:embeddingArtifact,computationMode:'single_reference_face',libraRunId:null,workspaceId:null,
    faceModelRefDigest:buffaloModelReference('single_reference_face').digest,sourceArtifactSetDigest:imageDigest,
    detectedFaceCount:1,vectorCount:1,dimension:512,embeddingDigest};
  const embedding={...embeddingBody,handleDigest:D(embeddingBody)};
  const result=(capabilityRef,value,eventId)=>({workId:work.workId,attemptId:'attempt',planId:'plan',eventId,
    eventAttemptId:'event-attempt-'+eventId,state:'succeeded',outcomeKind:'succeeded',inputSnapshotDigest:D(eventId+'-input'),
    capabilityRef,resultSchemaRef:'helix://contracts/capabilities/'+capabilityRef.replace('@1','/v1/result'),
    resultDigest:D(value),result:value});
  const asRecord=handle=>({artifactHandleId:handle.artifactHandleId,artifactKind:handle.artifactKind,ownerDomain:handle.ownerDomain,
    ownerScopeType:handle.ownerScope.scopeType,ownerScopeId:handle.ownerScope.scopeId,storageRef:handle.storageRef,
    digestAlgorithm:handle.digestAlgorithm,digestHex:handle.digestHex,sizeBytes:handle.sizeBytes,mediaType:handle.mediaType,
    provenanceRef:handle.provenanceRef,referenceRevision:handle.referenceRevision,state:'active',createdAtMs:1});
  artifacts.set('photo',png);artifacts.set('embedding',featureBytes);
  artifacts.set('record:photo',asRecord(photo));artifacts.set('record:embedding',asRecord(embeddingArtifact));
  records.set(work.workId,{
    status:{state:'succeeded',latestAttempt:{state:'succeeded',attempt_id:'attempt'},owner_domain:'people',
      process_type:'people_image_preparation',process_id:operation.operationId,basis_digest:operation.payloadDigest},
    read:[result('people.reference_asset.import@1',photo,'import'),result('shared.face.embedding.compute@1',embedding,'embed')],
    readDefinition:{definition:work},
  });
  const services=execution.createProcessServices({
    onDeckPersonEvidenceProjection:{read(){return null;},listPage(){return [];}},
    onDeckNfoPersonEvidence:{observeEntry(){return {kind:'skipped'};},listPage(){return [];}},
  });
  const done=services.imageOperations.reconcile(operation.operationId);
  assert.equal(done.state,'completed');
  const peopleStore=createPeopleStore(sceneValue.f.workspaceOptions);
  assert.equal(peopleStore.getPerson(operation.personId).currentRevision,1);
  const decisionStore=createUsAdultCatalogueDecisionStore({...sceneValue.f.workspaceOptions,contractValidator:sceneValue.f.validator});
  const settled=createUsAdultCatalogueSettlementCoordinator({
    ...sceneValue.f.options,usAdultCatalogueDecisionStore:decisionStore,
    resolveUsAdultName:input=>resolveUsAdultName({...input,people:[{
      personId:operation.personId,libraryKind:'us_adult',status:'active',personRevision:1,
      personFactDigest:peopleStore.getPerson(operation.personId).revision.factDigest,
      canonicalName:sceneValue.input.winner.name,aliases:[],
    }]}),
    readUsAdultPersonSnapshot:input=>peopleStore.readUsAdultPersonSnapshot(input),
    readPersonHead(personId){
      const found=peopleStore.getPerson(personId);
      return found?{personId:found.personId,personRevision:found.currentRevision,personFactDigest:found.revision.factDigest,
        currentReferenceRevision:found.currentReferenceRevision}:null;
    },
    registerCataloguePerson:admission.registerCataloguePerson,
  }).reconcile(sceneValue.catalogue);
  assert.equal(settled.kind,'settled');
  const selection=currentSelection.build({
    snapshot:{spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run',subjectId:sceneValue.f.args.snapshot.run.subjectId,
      executionBasisDigest:sceneValue.input.runExecutionBasisDigest}},
    resolvedIdentityDigest:sceneValue.input.resolvedIdentityDigest,
    catalogueDecision:settled.decision,referenceAssetId:settled.decision.referenceAssetId,
  });
  assert.equal(currentSelection.actorRelation(selection).source,'face_catalogue');
});

test('LibraExecutionRegistration exposes usAdultCatalogueDecisionInput with formal contracts',async t=>{
  const {LibraExecutionRegistration}=require('../../src/helix/domains/libra/public');
  const sceneValue=await scene(t);
  const f=sceneValue.f;
  const libraServices=LibraExecutionRegistration().createProcessServices({
    ...f.workspaceOptions,
    now:()=>1000,
    submit(){return {replayed:false};},
    contractValidator:f.validator,
    candidateDeliveryPort:{readSnapshot(){return null;}},
    movieProductionReader:f.options.movieProductionReader,
    productProductionPort:{issuePhysicalReadHandle:()=>f.basis.sourceHandle},
    mediaEffectPort:{executeRemux(){},executeTranscode(){},verifyTranscodeInput(){},verifyPlayback(){}},
    workResultReader:f.options.workResultReader,
    workspaceProductPort:f.options.workspaceProductPort,
    peopleReferenceQuery:{readUsAdultReferencePage(){return {items:[],nextCursor:null};},resolveUsAdultName(){return {kind:'not_found'};},readUsAdultPersonSnapshot(){return null;}},
    readJavUnknownActorProjection:()=>null,
    readArcaRoutingTargets:()=>[],
    readArcaShelfStandard:()=>null,
    readArcaFormationStatus:()=>({}),
    cancelProcessWorks(){},
    resolveRetryPolicyDigest:()=>D('retry'),
    resolvePerceptionRating:()=>({kind:'pending'}),
    qualifySeriesLocalSource:()=>null,
    onLibraPriorityChanged(){},
    onLibraWaitingExecutionsObserved(){},
  });
  assert.equal(typeof libraServices.usAdultCatalogueDecisionInput?.compile,'function');
  const directCompiled=libraServices.usAdultCatalogueDecisionInput.compile({libraRunId:'run',mode:'initial'});
  assert.equal(directCompiled.kind,'qualified');
  assert.equal(directCompiled.inputDigest,sceneValue.inputDigest);
});

test('default composition runtime catalogueInputReader compiles without outer contractValidator on options',async t=>{
  const {createProcurementExecutionRuntime}=require('../../src/helix/composition/create-procurement-execution-runtime');
  const {catalogueObservationWork}=require('../../src/helix/domains/libra/model/us-adult-catalogue-observation-work');
  const {readCompletedCatalogueBatches}=require('../../src/helix/domains/libra/model/us-adult-catalogue-work-results');
  const {CAPABILITY,FRAME,EMBED,CLUSTER,resultRef}=require('../../src/helix/contracts/us-adult-catalogue-work-types');
  const {sourceMediaObservationWork}=require('../../src/helix/domains/libra/planning/media-production-work');
  const {coordination}=require('./fixtures/us-adult-catalogue-coordination');

  const f2=coordination(t);
  f2.store.freeze(f2.basis);
  const sourceWork=sourceMediaObservationWork(f2.args.snapshot);
  const frameResult=await f2.completeFrames('initial');
  const obsResult=await f2.completeObservation('initial');
  const completedBatches=readCompletedCatalogueBatches(f2.options,f2.args.snapshot,f2.basis,'initial');
  const obsWork=catalogueObservationWork({snapshot:f2.args.snapshot,basis:f2.basis,completedBatches,validator:f2.validator});

  function seedSucceededWork(work,events){
    const attemptId=events[0]?.attemptId||(work.workId+':attempt:1'),planId=events[0]?.planId||(work.workId+':plan:1');
    const defJson=canonicalJson(work);
    f2.db.prepare('INSERT OR IGNORE INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(work.workId,work.ownerDomain,work.processType,work.processId,work.workKind,work.executionBasisDigest,'normal_foreground','helix://test/work/v1',defJson,D(work),'succeeded',work.idempotencyKey,1,1);
    f2.db.prepare("UPDATE fx_supporting_works SET state='succeeded' WHERE work_id=?").run(work.workId);
    f2.db.prepare('INSERT OR IGNORE INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
      .run(attemptId,work.workId,1,work.executionBasisDigest,'succeeded',1,2);
    f2.db.prepare('INSERT OR IGNORE INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(planId,attemptId,'helix://test/planner/v1',1,D('cat'),work.executionBasisDigest,D('graph'),'planned',1);
    for(const [idx,ev] of events.entries()){
      const eventId=ev.eventId||(work.workId+':ev:'+idx),eaId=eventId+':attempt:1',resId=ev.resultId||(eventId+':res');
      const bindings=ev.inputBindings||{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]};
      f2.db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameter_schema_ref,parameters_json,effect_class,fence_schema_ref,fence_basis_json,resource_demand_schema_ref,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(planId,'node-'+idx,ev.capabilityRef,1,'helix://foundation/types/EventInputBindingSet/v1',canonicalJson(bindings),'helix://test/params/v1','{}','pure_observation','helix://test/fence/v1','{}','helix://test/demand/v1','{}');
      f2.db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(eventId,planId,'node-'+idx,work.workId,attemptId,work.ownerDomain,ev.capabilityRef,1,'succeeded','normal_foreground',1,resId);
      f2.db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,evidence_digest,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(eaId,eventId,1,ev.capabilityRef,1,'helix://test/in/v1',D(bindings),D('fence'),'completed','succeeded',D({}),1,2);
      const schemaRef=resultRef(ev.capabilityRef);
      f2.db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(resId,eventId,'succeeded',schemaRef,canonicalJson(ev.result),D(ev.result),'helix://test/ev/v1','{}',D({}),2);
    }
  }
  seedSucceededWork(sourceWork,[{capabilityRef:'shared.material.media.probe@1',result:f2.args.sourceProbeRecord.result}]);
  seedSucceededWork(frameResult,f2.records.get(frameResult.workId));
  seedSucceededWork(obsWork,f2.records.get(obsWork.workId));

  const runtimeWorkspacePort={
    ...f2.workspace,
    readArtifactBytes(handle){
      const hit=f2.artifacts.get(handle.artifactHandleId);
      if(hit)return {bytes:hit.bytes};
      return f2.workspace.readArtifactBytes(handle);
    },
  };
  const runtimeArtifacts=new Map();
  const peoplePort={
    rootSnapshot(){return {mountScopeId:'local-mount',state:'active',rootKind:'internal-artifact'};},
    stageUpload,
    readArtifact(handle){
      const bytes=runtimeArtifacts.get(handle.artifactHandleId);
      if(!bytes)throw new Error('missing artifact '+handle.artifactHandleId);
      return bytes;
    },
  };
  f2.options.movieProductionReader.readFact=()=>f2.identity;
  const catalogue2=f2.reconcile();
  assert.equal(catalogue2.kind,'catalogue_candidate');
  const compiled2=createUsAdultCatalogueDecisionInput(f2.options).compile({libraRunId:'run',mode:'initial'});
  const resolution2=resolveUsAdultName({name:compiled2.input.winner.name,aliases:compiled2.input.winner.aliases,people:[]});
  const prep2=executionFor(f2,{
    observe:({name,aliases})=>providerObservation(name,aliases),
    readImageBytes:()=>png,
    artifacts:new Map(),
  });
  const pending2=prep2.admission.registerCataloguePerson({
    input:compiled2.input,inputDigest:compiled2.inputDigest,resolution:resolution2,candidate:catalogue2,
  });
  assert.equal(pending2.pendingCode,'PEOPLE_CATALOGUE_IMAGE_PREP_PENDING');

  // Explicitly omit contractValidator and catalogueInputReader to mirror clean-service-host.js.
  const runtime=createProcurementExecutionRuntime({
    schemaManifest:f2.workspaceOptions.schemaManifest,
    unitOfWork:f2.workspaceOptions.unitOfWork,
    movieProductionReader:f2.options.movieProductionReader,
    materialFieldStore:{listMaterialFields:()=>[],getMaterialField:()=>null},
    enumerator:{enumeratePage(){}},
    pageObserverFactory:()=>({observe(){}}),
    mediaProbe:{probe(){},bdmvTopologyReader:{inspect(){}}},
    candidateDeliveryPort:{readSnapshot(){return null;}},
    productProductionPort:{issuePhysicalReadHandle:()=>f2.basis.sourceHandle,issueShelfAcceptanceReadHandle(){},readRelatedNfo(){},fetchProvider(){}},
    mediaEffectPort:{executeRemux(){},executeTranscode(){},verifyTranscodeInput(){},verifyPlayback(){}},
    productDeliveryPort:{deliver(){},readDelivery(){},readPackage(){return null;}},
    inventoryPort:{assess(){return null;},inspectJavCorrectionPlacement(){return null;}},
    observeJavSourceForPreview(){},
    workspaceProductPort:runtimeWorkspacePort,
    catalogueConfiguration:f2.args,
    createCatalogueFramePort:()=>f2.port,
    createCatalogueObservationPort:()=>({async observe(){return obsResult.observation;}}),
    peopleImagePort:peoplePort,
    observeUsAdultCatalogueProviderSearch:({name,aliases})=>providerObservation(name,aliases),
    readCatalogueRegistrationImageBytes:()=>png,
    buildCatalogueRegistrationFrameProof:({observationHandle})=>{
      assert.equal(observationHandle.artifactHandleId,obsResult.handle.artifactHandleId);
      return {frameIndex:0,timestampMs:100,imageBytes:png,mediaType:'image/png',width:100,height:100};
    },
    createSeriesRootRelocationIo(){return {};},
    acquireJavCover(){},
    aftercareWorkspaceEndpointId:'aftercare-endpoint',
    aftercareWorkspaceMountScopeId:'aftercare-mount',
    aftercareWorkspaceMountScopeRevision:1,
    aftercareWorkspaceRoot:path.join(f2.root,'aftercare-ws'),
    libraWorkspaceRoot:f2.workspace.rootSnapshot().resolvedRoot,
  });

  const ops2=catalogueOps(f2.db);
  assert.equal(ops2.length,1);
  const store2=createPeopleImageOperationStore(f2.workspaceOptions);
  const op2=store2.get(ops2[0].operationId);
  const work2=preparationWork(op2);
  const imageDigest=op2.payload.selectedImage.digestHex;
  const vector=Array(512).fill(0);vector[0]=1;
  const featureBytes=Buffer.from(canonicalJson({schema:'shared.face-embedding-set@1',dimension:512,vectors:[vector]}));
  runtimeArtifacts.set('photo2',png);
  runtimeArtifacts.set('embedding2',featureBytes);
  const makeArtifact=(artifactHandleId,artifactKind,digestHex,mediaType,sizeBytes)=>({
    schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId,artifactKind,ownerDomain:'people',
    ownerScope:{scopeType:'person',scopeId:op2.personId},storageRef:'people-artifact:'+artifactHandleId,
    digestAlgorithm:'sha256',digestHex,sizeBytes,mediaType,
    provenanceRef:{objectType:'people_image_operation',objectId:op2.operationId,revision:1,digest:D('provenance')},
    referenceRevision:1});
  const photo=makeArtifact('photo2','reference-image',imageDigest,'image/png',png.length);
  const embeddingDigest=crypto.createHash('sha256').update(featureBytes).digest('hex');
  const embeddingArtifact=makeArtifact('embedding2','reference-embedding',embeddingDigest,'application/vnd.shelfdeck.face-embedding+json',featureBytes.length);
  const embeddingBody={schemaRef:'helix://contracts/types/FaceEmbeddingSetHandle/v1',schemaVersion:1,artifactHandleId:'embedding2',
    artifactHandle:embeddingArtifact,computationMode:'single_reference_face',libraRunId:null,workspaceId:null,
    faceModelRefDigest:buffaloModelReference('single_reference_face').digest,sourceArtifactSetDigest:imageDigest,
    detectedFaceCount:1,vectorCount:1,dimension:512,embeddingDigest};
  const embedding={...embeddingBody,handleDigest:D(embeddingBody)};
  f2.db.prepare('INSERT INTO fx_artifact_registry(artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(photo.artifactHandleId,photo.artifactKind,photo.ownerDomain,photo.ownerScope.scopeType,photo.ownerScope.scopeId,photo.storageRef,photo.digestAlgorithm,photo.digestHex,photo.sizeBytes,photo.mediaType,canonicalJson(photo.provenanceRef),photo.referenceRevision,'active',1);
  f2.db.prepare('INSERT INTO fx_artifact_registry(artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(embeddingArtifact.artifactHandleId,embeddingArtifact.artifactKind,embeddingArtifact.ownerDomain,embeddingArtifact.ownerScope.scopeType,embeddingArtifact.ownerScope.scopeId,embeddingArtifact.storageRef,embeddingArtifact.digestAlgorithm,embeddingArtifact.digestHex,embeddingArtifact.sizeBytes,embeddingArtifact.mediaType,canonicalJson(embeddingArtifact.provenanceRef),embeddingArtifact.referenceRevision,'active',1);
  seedSucceededWork(work2,[
    {capabilityRef:'people.reference_asset.import@1',result:photo},
    {capabilityRef:'shared.face.embedding.compute@1',result:embedding},
  ]);

  const done2=runtime.people.imageOperations.reconcile(op2.operationId);
  assert.equal(done2.state,'completed');
  const peopleStore2=createPeopleStore(f2.workspaceOptions);
  assert.equal(peopleStore2.getPerson(op2.personId).currentRevision,1);
});
