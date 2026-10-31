'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
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
