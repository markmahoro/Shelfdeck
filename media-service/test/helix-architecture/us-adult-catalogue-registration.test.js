'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buffaloModelReference}=require('../../src/helix/contracts/buffalo-model-reference');
const {createUsAdultCatalogueDecisionInput}=require('../../src/helix/domains/libra/model/us-adult-catalogue-decision-input');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {operationIdentity,buildCatalogueRegistration,SYSTEM}=require('../../src/helix/domains/people/model/us-adult-catalogue-registration');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const {createPeopleImageOperationStore}=require('../../src/helix/domains/people/persistence/people-image-operation-store');
const {buildCatalogueActorDecision}=require('../../src/helix/domains/libra/model/us-adult-catalogue-actor-decision');
const {createPeopleCatalogueRegistrationCommand}=require('../../src/helix/domains/people/application/us-adult-catalogue-registration-command');
const {preparationWork}=require('../../src/helix/domains/people/application/people-image-operation-coordinator');
const {createCommandCommitCoordinator}=require('../../src/helix/foundation/persistence/commit-foundation');

function provider(name,candidates=[],limit=10){
  const body={schema:'people.us-adult-provider-search-observation@1',provider:'theporndb',queries:[{term:name,limit,
    completion:candidates.length===limit?'saturated':'complete',responseDigest:D('provider-response'),candidates}]};
  return {...body,observationDigest:D(body)};
}
function reference(identity,imageDigest){
  const modelRef=buffaloModelReference('single_reference_face').digest;
  const vector=Array(512).fill(0);vector[0]=1;
  const featureBytes=Buffer.from(canonicalJson({schema:'shared.face-embedding-set@1',dimension:512,vectors:[vector]}));
  const artifact=(artifactHandleId,artifactKind,digestHex,mediaType,sizeBytes)=>({schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,
    artifactHandleId,artifactKind,ownerDomain:'people',ownerScope:{scopeType:'person',scopeId:identity.personId},storageRef:'people-artifact:'+artifactHandleId,
    digestAlgorithm:'sha256',digestHex,sizeBytes,mediaType,provenanceRef:{objectType:'people_image_operation',objectId:identity.operationId,
      revision:1,digest:D('provenance')},referenceRevision:1});
  const photo=artifact('photo','reference-image',imageDigest,'image/png',9),embeddingDigest=crypto.createHash('sha256').update(featureBytes).digest('hex'),
    embeddingArtifact=artifact('embedding','reference-embedding',embeddingDigest,'application/vnd.shelfdeck.face-embedding+json',featureBytes.length);
  const embeddingBody={schemaRef:'helix://contracts/types/FaceEmbeddingSetHandle/v1',schemaVersion:1,artifactHandleId:'embedding',artifactHandle:embeddingArtifact,
    computationMode:'single_reference_face',libraRunId:null,workspaceId:null,faceModelRefDigest:modelRef,sourceArtifactSetDigest:imageDigest,
    detectedFaceCount:1,vectorCount:1,dimension:512,embeddingDigest};
  const stable=(prefix,value)=>prefix+D(value).slice(0,40);
  const body={decisionId:stable('people-initial-reference-',identity.operationId),operationKind:'add_image',personId:identity.personId,expectedPersonRevision:1,
    expectedReferenceRevision:0,actorId:SYSTEM,referenceAssetId:stable('people-reference-asset-',identity.operationId),
    referenceFaceId:stable('people-reference-face-',identity.operationId),
    artifactHandle:photo,artifactDigest:imageDigest,faceEmbeddingSetHandle:{...embeddingBody,handleDigest:D(embeddingBody)},
    modelRef,initialState:'active'};
  return {...body,decisionDigest:D(body)};
}
async function setup(t){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');const result=await f.completeObservation('initial');
  f.options.movieProductionReader.readFact=()=>f.identity;
  const {input,inputDigest}=createUsAdultCatalogueDecisionInput(f.options).compile({libraRunId:'run',mode:'initial'});
  const resolution=resolveUsAdultName({name:input.winner.name,aliases:input.winner.aliases,people:[]});
  return {f,input,inputDigest,resolution,observation:result.observation};
}
function providerImage(s,items){
  const imageBytes=Buffer.from([137,80,78,71,13,10,26,10,1]);
  const imageSourceProof={kind:'provider',providerKey:'tpdb-1',imageId:'photo-1',urlDigest:D('url'),imageDigest:crypto.createHash('sha256').update(imageBytes).digest('hex')},
    identity=operationIdentity({inputDigest:s.inputDigest,nameResolutionDigest:s.resolution.resolutionDigest,imageSourceProof});
  return {...s,providerObservation:provider(s.input.winner.name,items),imageSourceProof,initialReference:reference(identity,imageSourceProof.imageDigest)};
}
function frameImage(s,items=[]){
  const group=s.observation.groups.find(item=>s.input.winner.groupIds.includes(item.clusterId)),key=group.representativeKeys[0],
    [ordinal,faceOrdinal]=key.split(':').map(Number),frame=s.observation.frameEvidenceRefs[ordinal],face=frame.faces[faceOrdinal];
  const value={schema:'shared.buffalo-representative-image@1',basisDigest:s.input.catalogueBasisDigest,frameEvidenceDigest:frame.frameEvidenceDigest,
    sourceImageDigest:frame.imageDigest,faceOrdinal,faceEvidenceDigest:face.faceEvidenceDigest,modelRefDigest:s.observation.modelRefDigest,
    coordinateSpaceDigest:D('canvas'),renderingPolicyDigest:s.input.representativeImagePolicyDigest,rectangle:{left:0,top:0,width:100,height:100},
    encoding:'png',imageDigest:D('crop'),imageBytes:300};
  const imageSourceProof={kind:'frame',proof:{...value,proofDigest:D(value)}},
    identity=operationIdentity({inputDigest:s.inputDigest,nameResolutionDigest:s.resolution.resolutionDigest,imageSourceProof});
  return {...s,providerObservation:provider(s.input.winner.name,items),imageSourceProof,initialReference:reference(identity,value.imageDigest)};
}
const person={providerKey:'tpdb-1',canonicalName:'Example Performer',aliases:[],images:[{imageId:'photo-1',urlDigest:D('url'),width:100,height:100}]};
test('system registration binds the unique TPDB image, People name snapshot, directory evidence and buffalo reference',async t=>{
  const request=providerImage(await setup(t),[person]),decision=buildCatalogueRegistration(request);
  assert.equal(decision.catalogueOrigin.sourceObservationDigest,request.input.observationHandle.observationArtifactHandle.digestHex);
  assert.equal(decision.catalogueOrigin.imageSourceProof.kind,'provider');
  assert.equal(decision.newPersonId,request.initialReference.personId);
  assert.equal(decision.providerIdentities[0].providerKey,'tpdb-1');
  assert.equal(decision.initialReference.actorId,SYSTEM);
  request.f.validator.validate(decision.schemaRef,decision);
  assert.deepEqual(buildCatalogueRegistration(request),decision);
});
test('a complete no-result or no-image provider result permits only a proven selected representative face',async t=>{
  const s=await setup(t),none=frameImage(s),foundWithoutImage=frameImage(s,[{...person,images:[]}]);
  assert.equal(buildCatalogueRegistration(none).catalogueOrigin.imageSourceProof.kind,'frame');
  assert.equal(buildCatalogueRegistration(foundWithoutImage).providerIdentities[0].providerKey,'tpdb-1');
  assert.throws(()=>buildCatalogueRegistration(frameImage(s,[person])),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
});
test('saturated, ambiguous, false no-match and a substituted image never authorize registration',async t=>{
  const s=await setup(t),items=[person,{...person,providerKey:'tpdb-2'}];
  assert.throws(()=>buildCatalogueRegistration(providerImage(s,items)),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
  const saturated=providerImage(s,[person]);saturated.providerObservation=provider(s.input.winner.name,[person],1);
  assert.throws(()=>buildCatalogueRegistration(saturated),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
  const wrong=providerImage(s,[person]);wrong.imageSourceProof={...wrong.imageSourceProof,urlDigest:D('wrong')};
  assert.throws(()=>buildCatalogueRegistration(wrong),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
  const wrongModel=providerImage(s,[person]),embedding=wrongModel.initialReference.faceEmbeddingSetHandle,
    {handleDigest:ignoredEmbeddingDigest,...embeddingBody}=embedding,legacyEmbedding={...embeddingBody,dimension:128},
    {decisionDigest:ignoredReferenceDigest,...referenceBody}=wrongModel.initialReference,
    invalidReference={...referenceBody,faceEmbeddingSetHandle:{...legacyEmbedding,handleDigest:D(legacyEmbedding)}};
  wrongModel.initialReference={...invalidReference,decisionDigest:D(invalidReference)};
  assert.throws(()=>buildCatalogueRegistration(wrongModel),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
  const resolution=resolveUsAdultName({name:s.input.winner.name,people:[{personId:'existing',libraryKind:'us_adult',status:'active',personRevision:1,
    personFactDigest:D('person'),canonicalName:s.input.winner.name,aliases:[]}]});
  assert.throws(()=>buildCatalogueRegistration({...providerImage(s,[person]),resolution}),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
});
test('a crop from another face or modified frozen rendering policy cannot become the Person reference',async t=>{
  const s=await setup(t),request=frameImage(s),proof=request.imageSourceProof.proof;
  const {proofDigest,...body}=proof,changed={...body,renderingPolicyDigest:D('other-policy')};
  request.imageSourceProof={kind:'frame',proof:{...changed,proofDigest:D(changed)}};
  assert.throws(()=>buildCatalogueRegistration(request),{code:'PEOPLE_CATALOGUE_REGISTRATION_INVALID'});
});
function prepareOperation(request){
  const selectedBody={schemaRef:'helix://contracts/domain-types/PeopleSelectedImageHandle/v1',schemaVersion:1,uploadId:D('upload'),
    digestHex:request.initialReference.artifactDigest,sizeBytes:9,mediaType:'image/png',provenance:{source:'stashbox'}},
    identity=operationIdentity({inputDigest:request.inputDigest,nameResolutionDigest:request.resolution.resolutionDigest,imageSourceProof:request.imageSourceProof});
  return {schema:'people.catalogue-image-operation-request@1',operationKind:'catalogue_registration',expectedPersonRevision:1,
    expectedReferenceRevision:0,operationId:identity.operationId,personId:identity.personId,actorId:SYSTEM,canonicalName:request.input.winner.name,
    aliases:[request.input.winner.name,...request.input.winner.aliases],selectedImage:{...selectedBody,handleDigest:D(selectedBody)},
    faceModelRef:buffaloModelReference('single_reference_face'),catalogueDecisionInputDigest:request.inputDigest,
    nameResolutionDigest:request.resolution.resolutionDigest,imageSourceProofDigest:identity.imageSourceProofDigest};
}
function evidence(request){return Object.fromEntries(['input','inputDigest','resolution','observation','providerObservation','imageSourceProof','initialReference']
  .map(key=>[key,request[key]]));}
test('People Owner atomically publishes a system Person, Reference, evidence and operation on real SQLite',async t=>{
  const request=providerImage(await setup(t),[person]),options=request.f.workspaceOptions,store=createPeopleStore(options),
    operations=createPeopleImageOperationStore(options),payload=prepareOperation(request),operation=operations.createCatalogue(payload),
    fence=options.unitOfWork.captureReadFence(),participant=store.createCatalogueRegistrationParticipant(evidence(request),fence);
  assert.equal(operation.state,'preparing');
  const result=options.unitOfWork.execute([participant],{readFence:fence}).people_catalogue_registration;
  assert.equal(result.personId,payload.personId);assert.equal(result.revision.originKind,'catalogue_auto');
  assert.equal(result.revision.originDecisionRef.decisionId,buildCatalogueRegistration(request).decisionId);
  assert.equal(result.currentReferenceRevision,1);assert.equal(operations.get(payload.operationId).state,'completed');
  const origin=request.f.db.prepare('SELECT * FROM people_us_adult_catalogue_registration_origins WHERE person_id=?').get(payload.personId);
  assert.equal(origin.observation_digest,request.input.observationHandle.observationArtifactHandle.digestHex);
  assert.equal(JSON.parse(origin.decision_json).decisionId,result.revision.originDecisionRef.decisionId);
  assert.equal(request.f.db.prepare('SELECT count(*) n FROM people_reference_assets WHERE person_id=?').get(payload.personId).n,1);
  const snapshot=store.readUsAdultPersonSnapshot({personId:payload.personId,expectedPersonRevision:1,expectedReferenceRevision:1}),
    registration=buildCatalogueRegistration(request),actor=buildCatalogueActorDecision({input:request.input,inputDigest:request.inputDigest,
      resolution:request.resolution,registration:{decisionId:registration.decisionId,decisionDigest:registration.decisionDigest,
        personId:registration.newPersonId,catalogueDecisionInputDigest:request.inputDigest,nameResolutionDigest:request.resolution.resolutionDigest},
      personSnapshot:snapshot,referenceAssetId:request.initialReference.referenceAssetId});
  request.f.validator.validate(actor.schemaRef,actor);
  assert.deepEqual(request.f.db.pragma('foreign_key_check'),[]);
});
test('a competing People registration invalidates the frozen no-match instead of creating a duplicate',async t=>{
  const request=providerImage(await setup(t),[person]),options=request.f.workspaceOptions,store=createPeopleStore(options),
    operations=createPeopleImageOperationStore(options),payload=prepareOperation(request);operations.createCatalogue(payload);
  const otherIdentity={operationId:'other-operation',personId:'existing-person'},baseReference=reference(otherIdentity,D('other-image')),
    {decisionDigest:ignored,...base}=baseReference,manualReference={...base,actorId:'admin'},
    value={decisionId:'manual-decision',newPersonId:'existing-person',libraryKind:'us_adult',canonicalName:request.input.winner.name,
      aliases:[],providerIdentities:[],actorId:'admin',initialReference:{...manualReference,decisionDigest:D(manualReference)}};
  store.registerDirectPerson({...value,decisionDigest:D(value)});
  const fence=options.unitOfWork.captureReadFence(),participant=store.createCatalogueRegistrationParticipant(evidence(request),fence);
  assert.throws(()=>options.unitOfWork.execute([participant],{readFence:fence}),{code:'PEOPLE_NAME_LIBRARY_CHANGED'});
  assert.equal(store.getPerson(payload.personId),undefined);assert.equal(operations.get(payload.operationId).state,'preparing');
  assert.equal(request.f.db.prepare('SELECT count(*) n FROM people_us_adult_catalogue_registration_origins').get().n,0);
});
test('failure after Person creation rolls back Person, initial Reference, evidence and operation together',async t=>{
  const request=providerImage(await setup(t),[person]),options=request.f.workspaceOptions,store=createPeopleStore(options),
    operations=createPeopleImageOperationStore(options),payload=prepareOperation(request);operations.createCatalogue(payload);
  const fence=options.unitOfWork.captureReadFence(),participant=store.createCatalogueRegistrationParticipant(evidence(request),fence),
    crash={participantId:'injected_crash',owner:'people',repositories:participant.repositories,execute(){throw new Error('injected failure');}};
  assert.throws(()=>options.unitOfWork.execute([participant,crash],{readFence:fence}),/injected failure/);
  assert.equal(store.getPerson(payload.personId),undefined);assert.equal(operations.get(payload.operationId).state,'preparing');
  assert.equal(request.f.db.prepare('SELECT count(*) n FROM people_us_adult_catalogue_registration_origins').get().n,0);
  assert.equal(request.f.db.prepare('SELECT count(*) n FROM people_reference_assets WHERE person_id=?').get(payload.personId).n,0);
});
function commandFixture(request,overrides={}){
  const options=request.f.workspaceOptions,peopleStore=createPeopleStore(options),operationStore=createPeopleImageOperationStore(options),
    payload=prepareOperation(request),operation=operationStore.createCatalogue(payload),work=preparationWork(operation),ref=request.initialReference,
    vector=Array(512).fill(0);vector[0]=1;
  const imageBytes=Buffer.from([137,80,78,71,13,10,26,10,1]),featureBytes=Buffer.from(canonicalJson({schema:'shared.face-embedding-set@1',dimension:512,vectors:[vector]}));
  const result=(capabilityRef,value,eventId)=>({workId:work.workId,attemptId:'attempt',planId:'plan',eventId,eventAttemptId:'event-attempt-'+eventId,
    state:'succeeded',outcomeKind:'succeeded',inputSnapshotDigest:D(eventId+'-input'),capabilityRef,
    resultSchemaRef:'helix://contracts/capabilities/'+capabilityRef.replace('@1','/v1/result'),resultDigest:D(value),result:value});
  const records=[result('people.reference_asset.import@1',ref.artifactHandle,'import'),result('shared.face.embedding.compute@1',ref.faceEmbeddingSetHandle,'embed')];
  const asRecord=handle=>({artifactHandleId:handle.artifactHandleId,artifactKind:handle.artifactKind,ownerDomain:handle.ownerDomain,
    ownerScopeType:handle.ownerScope.scopeType,ownerScopeId:handle.ownerScope.scopeId,storageRef:handle.storageRef,digestAlgorithm:handle.digestAlgorithm,
    digestHex:handle.digestHex,sizeBytes:handle.sizeBytes,mediaType:handle.mediaType,provenanceRef:handle.provenanceRef,
    referenceRevision:handle.referenceRevision,state:'active',createdAtMs:1});
  const artifacts=new Map([ref.artifactHandle,ref.faceEmbeddingSetHandle.artifactHandle].map(handle=>[handle.artifactHandleId,asRecord(handle)]));
  const services={...options,peopleStore,operationStore,contractValidator:request.f.validator,commandCoordinator:createCommandCommitCoordinator(options),
    catalogueInputReader:{compile(){return request.f.db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get('run').state==='active'?
      {kind:'qualified',input:request.input,inputDigest:request.inputDigest}:{kind:'manual_choice_present'};}},
    workResultReader:{status:()=>({state:'succeeded',latestAttempt:{state:'succeeded',attempt_id:'attempt'},owner_domain:'people',
      process_type:'people_image_preparation',process_id:operation.operationId,basis_digest:operation.payloadDigest}),
      readDefinition:()=>({definition:work}),read:()=>records},
    artifactRepository:{get:id=>artifacts.get(id)},peopleImagePort:{readArtifact:handle=>handle.artifactHandleId==='photo'?imageBytes:featureBytes},...overrides};
  return {options,peopleStore,operationStore,payload,services,command:createPeopleCatalogueRegistrationCommand(services)};
}
test('system command writes an audit and receipt and replays after the originating Run ends',async t=>{
  const request=providerImage(await setup(t),[person]),f=commandFixture(request),result=f.command.register(evidence(request));
  assert.equal(result.replayed,false);assert.equal(result.receipt.targetId,f.payload.personId);
  const audit=request.f.db.prepare("SELECT actor_type,actor_id,action FROM fx_audit_records WHERE scope_id=?").get(f.payload.personId);
  assert.deepEqual(audit,{actor_type:'system',actor_id:SYSTEM,action:'people.person.catalogue_register'});
  assert.equal(request.f.db.prepare("SELECT count(*) n FROM fx_command_receipts WHERE target_id=?").get(f.payload.personId).n,1);
  request.f.db.prepare("UPDATE libra_runs SET state='discarded' WHERE libra_run_id='run'").run();
  const replay=f.command.register(evidence(request));assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,result.receipt);
});
test('Owner changes after the preparation fence cannot publish system Person facts',async t=>{
  const request=providerImage(await setup(t),[person]),f=commandFixture(request,{beforeCatalogueCommit(){
    request.f.db.prepare("UPDATE libra_runs SET state='discarded' WHERE libra_run_id='run'").run();}});
  assert.throws(()=>f.command.register(evidence(request)),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(f.peopleStore.getPerson(f.payload.personId),undefined);
  assert.equal(f.operationStore.get(f.payload.operationId).state,'preparing');
  assert.equal(request.f.db.prepare('SELECT count(*) n FROM fx_command_receipts WHERE target_id=?').get(f.payload.personId).n,0);
});
test('a failed image Work cannot publish a system Person or receipt',async t=>{
  const request=providerImage(await setup(t),[person]),f=commandFixture(request);
  f.services.workResultReader.status=()=>({state:'failed',latestAttempt:{state:'failed'}});
  assert.throws(()=>f.command.register(evidence(request)),{code:'PEOPLE_CATALOGUE_PREPARATION_INCOMPLETE'});
  assert.equal(f.peopleStore.getPerson(f.payload.personId),undefined);assert.equal(f.operationStore.get(f.payload.operationId).state,'preparing');
  assert.equal(request.f.db.prepare('SELECT count(*) n FROM fx_command_receipts WHERE target_id=?').get(f.payload.personId).n,0);
});

test('fresh Reset verifies the independent system registration and rejects missing or changed audit evidence',async t=>{
  const request=providerImage(await setup(t),[person]),f=commandFixture(request),{Database}=require('./fixtures/us-adult-catalogue-store');
  f.command.register(evidence(request));
  const verify=()=>{
    const source=new Database(request.f.databasePath,{readonly:true,fileMustExist:true});source.exec('BEGIN');
    try{return require('../../scripts/formation-reset-people-catalogue').verifyRetainedCatalogueRegistrations(source,source);}
    finally{source.exec('ROLLBACK');source.close();}
  };
  assert.equal(verify().count,1);
  const row=request.f.db.prepare('SELECT * FROM fx_audit_records WHERE scope_id=?').get(f.payload.personId);
  request.f.db.prepare('DELETE FROM fx_audit_records WHERE audit_id=?').run(row.audit_id);
  assert.throws(verify,{code:'RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID'});
  const columns=Object.keys(row);request.f.db.prepare('INSERT INTO fx_audit_records('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>row[key]));
  assert.equal(verify().count,1);
  request.f.db.prepare('UPDATE people_us_adult_catalogue_registration_origins SET origin_digest=? WHERE person_id=?').run('0'.repeat(64),f.payload.personId);
  assert.throws(verify,{code:'RESET_VERIFY_CATALOGUE_EVIDENCE_INVALID'});
});

test('fresh Reset retains a registered Person and exact independent evidence without reviving its unfinished Run',async t=>{
  const request=providerImage(await setup(t),[person]),f=commandFixture(request),{Database,schemaManifest,schemaDdl}=require('./fixtures/us-adult-catalogue-store'),
    path=require('node:path'),{createRetainedDatabase}=require('../../scripts/formation-reset-copy'),
    {buildOwnerRetentionPolicy}=require('../../scripts/formation-reset-owner-policy'),
    {verifyRetainedCatalogueRegistrations}=require('../../scripts/formation-reset-people-catalogue');
  f.command.register(evidence(request));
  for(const handle of [request.initialReference.artifactHandle,request.initialReference.faceEmbeddingSetHandle.artifactHandle]){
    const record=f.services.artifactRepository.get(handle.artifactHandleId);
    request.f.db.prepare(`INSERT INTO fx_artifact_registry(artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,
      digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(record.artifactHandleId,record.artifactKind,record.ownerDomain,record.ownerScopeType,record.ownerScopeId,record.storageRef,
        record.digestAlgorithm,record.digestHex,record.sizeBytes,record.mediaType,canonicalJson(record.provenanceRef),record.referenceRevision,record.state,1);
  }
  const targetPath=path.join(request.f.root,'retained.db');
  createRetainedDatabase({Database,sourcePath:request.f.databasePath,targetPath,policy:buildOwnerRetentionPolicy(schemaManifest),targetSchema:{schemaManifest,schemaDdl}});
  const source=new Database(request.f.databasePath,{readonly:true}),target=new Database(targetPath,{readonly:true});
  source.exec('BEGIN');target.exec('BEGIN');
  try{
    assert.equal(verifyRetainedCatalogueRegistrations(source,target).count,1);
    assert.equal(target.prepare('SELECT count(*) n FROM people_persons WHERE person_id=?').get(f.payload.personId).n,1);
    assert.equal(target.prepare("SELECT count(*) n FROM libra_runs WHERE libra_run_id='run'").get().n,0);
    assert.equal(target.prepare("SELECT count(*) n FROM libra_subjects WHERE subject_id='subject'").get().n,0);
    assert.deepEqual(target.pragma('foreign_key_check'),[]);
  }finally{source.exec('ROLLBACK');target.exec('ROLLBACK');source.close();target.close();}
});
