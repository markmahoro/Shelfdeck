'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {buffaloModelReference}=require('../../src/helix/contracts/buffalo-model-reference');
const {createUsAdultCatalogueDecisionInput}=require('../../src/helix/domains/libra/model/us-adult-catalogue-decision-input');
const {createUsAdultCatalogueSettlementCoordinator}=require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-coordinator');
const {createUsAdultCatalogueDecisionStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-decision-store');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {createPeopleImageOperationStore}=require('../../src/helix/domains/people/persistence/people-image-operation-store');
const {createUsAdultCatalogueBuffaloRefresh}=require('../../src/helix/domains/people/application/us-adult-catalogue-buffalo-refresh');
const {assertRequiredUsAdultActor}=require('../../src/helix/contracts/us-adult-actor-package');
const currentSelection=require('../../src/helix/domains/libra/model/us-adult-actor-selection-current');

function personSnapshot(name='Example Performer', modelRef=buffaloModelReference('single_reference_face').digest, personId='person-registered'){
  const referenceAssetId='asset-reg';
  const projectionValue={projectionContract:'people.person-reference-projection@1',personId,personRevision:1,
    currentReferenceRevision:1,contributions:[{ownerPersonId:personId,ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
      activeAssets:[{referenceAssetId,artifactHandleId:'picture',artifactDigest:D('picture')}],
      activeFaces:[{referenceFaceId:'face-1',referenceAssetId,embeddingHandleId:'embedding',embeddingDigest:D('embedding'),modelRef}]}]};
  const projection={...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
  const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId,personRevision:1,canonicalName:name,aliases:[],personFactDigest:D('person'),referenceProjection:projection};
  return {personSnapshot:{...personValue,snapshotDigest:D(personValue)},referenceAssetId,personId};
}

async function candidate(t,observationOpts={}){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial',observationOpts);
  f.options.movieProductionReader.readFact=()=>f.identity;
  const catalogue=f.reconcile();
  assert.equal(catalogue.kind,'catalogue_candidate');
  return {f,catalogue};
}

function settlementOptions(f,extra={}){
  const decisionStore=createUsAdultCatalogueDecisionStore({...f.workspaceOptions,contractValidator:f.validator});
  return {
    ...f.options,
    usAdultCatalogueDecisionStore:decisionStore,
    resolveUsAdultName:input=>resolveUsAdultName({...input,people:extra.people||[]}),
    readUsAdultPersonSnapshot:extra.readUsAdultPersonSnapshot||(()=>{throw new Error('snapshot unused');}),
    readPersonHead:extra.readPersonHead||(()=>null),
    registerCataloguePerson:extra.registerCataloguePerson,
    ensureCatalogueReferenceFeatures:extra.ensureCatalogueReferenceFeatures,
  };
}

test('without registerCataloguePerson, qualified not_found stalls on waiting_registration',async t=>{
  const {f,catalogue}=await candidate(t);
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f)).reconcile(catalogue);
  assert.equal(settled.kind,'waiting_registration');
  assert.equal(settled.reasonCode,'us_adult_catalogue_registration_required');
});

test('Host registerCataloguePerson unblocks settlement to registered decision and shelfable face_catalogue',async t=>{
  const {f,catalogue}=await candidate(t);
  const {personSnapshot:snapshot,referenceAssetId,personId}=personSnapshot();
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    registerCataloguePerson({input,inputDigest,resolution}){
      assert.equal(resolution.kind,'not_found');
      return Object.freeze({kind:'registered',
        registration:{decisionId:D('registration'),decisionDigest:D('registration-value'),personId,
          catalogueDecisionInputDigest:inputDigest,nameResolutionDigest:resolution.resolutionDigest},
        personSnapshot:snapshot,referenceAssetId});
    },
  })).reconcile(catalogue);
  assert.equal(settled.kind,'settled');
  assert.equal(settled.decision.nameResolution.kind,'registered');
  assert.equal(settled.decision.personSnapshot.personId,personId);
  const compiled=createUsAdultCatalogueDecisionInput(f.options).compile({libraRunId:'run',mode:'initial'});
  const selection=currentSelection.build({
    snapshot:{spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run',subjectId:f.args.snapshot.run.subjectId,
      executionBasisDigest:compiled.input.runExecutionBasisDigest}},
    resolvedIdentityDigest:compiled.input.resolvedIdentityDigest,
    catalogueDecision:settled.decision,referenceAssetId,
  });
  const relation=currentSelection.actorRelation(selection);
  assert.equal(relation.source,'face_catalogue');
  const relations=[relation];
  const castFact={schemaRef:'helix://contracts/types/MediaCastFact/v1',sourceBasisKind:'us_adult_actor',relationCount:1,relations,
    relationsDigest:D({schema:'libra.media-cast-relations@1',relations})};
  const factDigest=D(castFact);
  const packageValue={
    resolvedIdentitySnapshot:{factValue:{contentProfile:'western_adult',identityKind:'internal_identity',structureKind:'single'}},
    mediaCastSnapshot:{mediaCastFactId:'cast-fact',mediaCastFactRevision:1,factDigest,factValue:castFact,relations,
      relationsDigest:castFact.relationsDigest},
    productFactManifest:{items:[{productFactId:'cast-fact',factRevision:1,factDigest,factKind:'media_cast',factValue:castFact}]},
  };
  assert.equal(assertRequiredUsAdultActor(packageValue),packageValue);
});

test('name resolve (+ light spelling) reuses personId and settles when buffalo reference exists',async t=>{
  const {f,catalogue}=await candidate(t);
  const factDigest=D('person-fact-fuzzy');
  const {personSnapshot:snapshot,referenceAssetId,personId}=personSnapshot('Examble Performer');
  const personValue={...(({snapshotDigest,...rest})=>rest)(snapshot),canonicalName:'Examble Performer',personFactDigest:factDigest};
  const renamed={...personValue,snapshotDigest:D(personValue)};
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Examble Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>renamed,
  })).reconcile(catalogue);
  assert.equal(settled.kind,'settled');
  assert.equal(settled.decision.nameResolution.kind,'reused');
  assert.equal(settled.decision.personSnapshot.personId,personId);
  assert.equal(settled.decision.referenceAssetId,referenceAssetId);
});

function snapshotWithFact(snapshot,factDigest){
  const personValue={...(({snapshotDigest,...rest})=>rest)(snapshot),personFactDigest:factDigest};
  return {...personValue,snapshotDigest:D(personValue)};
}

test('May Thai catalogue winner reuses Mai Thai and does not register a second Person',async t=>{
  const {f,catalogue}=await candidate(t,{winnerName:'May Thai'});
  assert.equal(catalogue.assessment.winner.name,'May Thai');
  const factDigest=D('person-mai-thai');
  const buffalo=personSnapshot('Mai Thai');
  const stale=personSnapshot('Mai Thai','0'.repeat(64));
  const {personId,referenceAssetId}=buffalo;
  const people=[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
    canonicalName:'Mai Thai',aliases:[]}];
  const named=resolveUsAdultName({name:'May Thai',people});
  assert.equal(named.kind,'resolved');
  assert.equal(named.candidates[0].personId,personId);
  assert.equal(named.candidates[0].matchKind,'light_spelling');
  const head=()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1});
  const forbidRegister=()=>{throw new Error('Must not create May Thai when Mai Thai exists');};
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people,readPersonHead:head,readUsAdultPersonSnapshot:()=>snapshotWithFact(buffalo.personSnapshot,factDigest),
    registerCataloguePerson:forbidRegister,
  })).reconcile(catalogue);
  assert.equal(settled.kind,'settled');
  assert.equal(settled.decision.winner.name,'May Thai');
  assert.equal(settled.decision.nameResolution.kind,'reused');
  assert.equal(settled.decision.nameResolution.registrationDecisionId,null);
  assert.equal(settled.decision.personSnapshot.personId,personId);
  assert.equal(settled.decision.personSnapshot.canonicalName,'Mai Thai');
  assert.equal(settled.decision.referenceAssetId,referenceAssetId);
});

test('May Thai stale non-buffalo face fails closed when ensure is unwired',async t=>{
  const {f,catalogue}=await candidate(t,{winnerName:'May Thai'});
  const factDigest=D('person-mai-thai-stale');
  const stale=personSnapshot('Mai Thai','0'.repeat(64));
  const {personId}=stale;
  const people=[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
    canonicalName:'Mai Thai',aliases:[]}];
  const head=()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1});
  const unwired=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people,readPersonHead:head,readUsAdultPersonSnapshot:()=>snapshotWithFact(stale.personSnapshot,factDigest),
    registerCataloguePerson:()=>{throw new Error('Must not create May Thai when Mai Thai exists');},
  })).reconcile(catalogue);
  assert.equal(unwired.kind,'failed');
  assert.equal(unwired.reasonCode,'PEOPLE_CATALOGUE_ENSURE_UNWIRED');
  assert.equal(unwired.personId,personId);
  assert.equal(unwired.winnerName,'May Thai');
  assert.notEqual(unwired.reasonCode,'us_adult_catalogue_buffalo_reference_required');
  assert.notEqual(unwired.kind,'waiting_registration');
});

function legacySnapshot(personId,factDigest,name='Example Performer'){
  const modelRef='0'.repeat(64),referenceAssetId='asset-legacy';
  const projectionValue={projectionContract:'people.person-reference-projection@1',personId,personRevision:1,
    currentReferenceRevision:1,contributions:[{ownerPersonId:personId,ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
      activeAssets:[{referenceAssetId,artifactHandleId:'picture',artifactDigest:D('picture')}],
      activeFaces:[{referenceFaceId:'face-1',referenceAssetId,embeddingHandleId:'embedding',embeddingDigest:D('embedding'),modelRef}]}]};
  const projection={...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
  const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId,personRevision:1,canonicalName:name,aliases:[],personFactDigest:factDigest,referenceProjection:projection};
  return {...personValue,snapshotDigest:D(personValue)};
}

test('unwired name-bound reuse fails closed — never silent reference_features_pending',async t=>{
  const {f,catalogue}=await candidate(t);
  const personId='person-name-bound',factDigest=D('person-fact-bound');
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest),
  })).reconcile(catalogue);
  assert.equal(settled.kind,'failed');
  assert.equal(settled.phase,'us_adult_catalogue_name_bound');
  assert.equal(settled.reasonCode,'PEOPLE_CATALOGUE_ENSURE_UNWIRED');
  assert.equal(settled.personId,personId);
  assert.notEqual(settled.reasonCode,'us_adult_catalogue_buffalo_reference_required');
  assert.notEqual(settled.kind,'waiting_registration');
  assert.notEqual(settled.reasonCode,'us_adult_catalogue_reference_features_pending');
});

test('wired ensure opens buffalo refresh Work then settles reused (Tia shape)',async t=>{
  const {f,catalogue}=await candidate(t);
  const personId='person-tia',factDigest=D('person-fact-tia');
  const imageBytes=Buffer.from([137,80,78,71,13,10,26,10,1]);
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  let ready=false;
  const peopleStore={
    getPerson(){return {personId,currentRevision:1,currentReferenceRevision:1,
      revision:{canonicalName:'Example Performer',aliases:[]}};},
    readUsAdultPersonSnapshot(){
      if(!ready)return legacySnapshot(personId,factDigest);
      const built=personSnapshot('Example Performer',buffaloModelReference('single_reference_face').digest,personId).personSnapshot;
      const {snapshotDigest,...body}=built;
      const personValue={...body,personFactDigest:factDigest};
      return {...personValue,snapshotDigest:D(personValue)};
    },
    getPersonReferenceProjection(){return legacySnapshot(personId,factDigest).referenceProjection;},
    hasReferenceImage(){return false;},
  };
  function stageUpload({bytes,actorId,idempotencyKey,provenance}){
    const digestHex=crypto.createHash('sha256').update(bytes).digest('hex');
    const basis={schemaRef:'helix://contracts/domain-types/PeopleSelectedImageHandle/v1',schemaVersion:1,
      uploadId:D({schema:'people.selected-upload@1',actorId,idempotencyKey,digestHex}),
      digestHex,sizeBytes:bytes.length,mediaType:'image/png',provenance};
    return {...basis,handleDigest:D(basis)};
  }
  function providerObservation(name){
    const body={schema:'people.us-adult-provider-search-observation@1',provider:'theporndb',queries:[{term:name,limit:10,
      completion:'complete',responseDigest:D('provider-response'),candidates:[{providerKey:'tpdb-1',canonicalName:name,aliases:[],
        images:[{imageId:'photo-1',urlDigest:D('url'),width:100,height:100}]}]}]};
    return {...body,observationDigest:D(body)};
  }
  const refresh=createUsAdultCatalogueBuffaloRefresh({
    peopleStore,operationStore,peopleImagePort:{stageUpload},
    workResultReader:{status:()=>({state:'running'})},
    observeProviderSearch:({name})=>providerObservation(name),
    readImageBytes:()=>imageBytes,
  }).refreshBuffaloCatalogueReference;
  function ensure(args){
    return refresh({personId:args.personId,head:args.head||{
      personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1},
      input:args.input,inputDigest:args.inputDigest,resolution:args.resolution,candidate:args.candidate});
  }
  const coordinator=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest),
    ensureCatalogueReferenceFeatures:ensure,
  }));
  const pending=coordinator.reconcile(catalogue);
  assert.equal(pending.kind,'pending');
  assert.equal(pending.phase,'us_adult_catalogue_name_bound');
  assert.equal(pending.reasonCode,'us_adult_catalogue_reference_features_pending');
  assert.ok(pending.workId||pending.pendingCode);
  assert.notEqual(pending.kind,'waiting_registration');
  assert.notEqual(pending.reasonCode,'us_adult_catalogue_buffalo_reference_required');
  const page=operationStore.listPendingPage({cursor:null,limit:100});
  assert.equal(page.length,1);
  const operation=operationStore.get(page[0].scope.operationId);
  assert.equal(operation.payload.operationKind,'reference_replace');
  assert.equal(D(operation.payload.faceModelRef),D(buffaloModelReference('single_reference_face')));
  ready=true;
  const settled=coordinator.reconcile(catalogue);
  assert.equal(settled.kind,'settled');
  assert.equal(settled.decision.nameResolution.kind,'reused');
  assert.equal(settled.decision.referenceAssetId,'asset-reg');
});

test('May Thai stale face calls ensure and settles reused Mai Thai',async t=>{
  const {f,catalogue}=await candidate(t,{winnerName:'May Thai'});
  assert.equal(catalogue.assessment.winner.name,'May Thai');
  const personId='person-mai-thai',factDigest=D('person-mai-thai-refresh');
  const imageBytes=Buffer.from([137,80,78,71,13,10,26,10,2]);
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  let ready=false,ensureCalls=0;
  const people=[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
    canonicalName:'Mai Thai',aliases:[]}];
  const peopleStore={
    getPerson(){return {personId,currentRevision:1,currentReferenceRevision:1,
      revision:{canonicalName:'Mai Thai',aliases:[],factDigest}};},
    readUsAdultPersonSnapshot(){
      if(!ready)return legacySnapshot(personId,factDigest,'Mai Thai');
      const built=personSnapshot('Mai Thai',buffaloModelReference('single_reference_face').digest,personId).personSnapshot;
      const {snapshotDigest,...body}=built;
      const personValue={...body,personFactDigest:factDigest};
      return {...personValue,snapshotDigest:D(personValue)};
    },
    getPersonReferenceProjection(){return legacySnapshot(personId,factDigest,'Mai Thai').referenceProjection;},
    hasReferenceImage(){return false;},
  };
  const refresh=createUsAdultCatalogueBuffaloRefresh({
    peopleStore,operationStore,peopleImagePort:{stageUpload({bytes,actorId,idempotencyKey,provenance}){
      const digestHex=crypto.createHash('sha256').update(bytes).digest('hex');
      const basis={schemaRef:'helix://contracts/domain-types/PeopleSelectedImageHandle/v1',schemaVersion:1,
        uploadId:D({schema:'people.selected-upload@1',actorId,idempotencyKey,digestHex}),
        digestHex,sizeBytes:bytes.length,mediaType:'image/png',provenance};
      return {...basis,handleDigest:D(basis)};
    }},
    workResultReader:{status:()=>({state:'running'})},
    observeProviderSearch(){throw new Error('direct image bytes should refresh without a second provider search');},
    readImageBytes:()=>imageBytes,
  }).refreshBuffaloCatalogueReference;
  const settledPending=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people,
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest,'Mai Thai'),
    registerCataloguePerson:()=>{throw new Error('Must not create May Thai when Mai Thai exists');},
    ensureCatalogueReferenceFeatures(args){
      ensureCalls+=1;
      assert.equal(args.personId,personId);
      assert.equal(args.input.winner.name,'May Thai');
      return refresh({...args,head:args.head});
    },
  })).reconcile(catalogue);
  assert.equal(ensureCalls,1);
  assert.equal(settledPending.kind,'pending');
  assert.equal(settledPending.phase,'us_adult_catalogue_name_bound');
  assert.equal(settledPending.reasonCode,'us_adult_catalogue_reference_features_pending');
  assert.equal(settledPending.winnerName,'May Thai');
  assert.ok(settledPending.workId);
  assert.equal(settledPending.pendingCode,'PEOPLE_BUFFALO_REFRESH_PREP_PENDING');
  const operation=operationStore.get(operationStore.listPendingPage({cursor:null,limit:100})[0].scope.operationId);
  assert.equal(operation.payload.operationKind,'reference_replace');
  assert.equal(operation.payload.canonicalName,'Mai Thai');
  ready=true;
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people,
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest,'Mai Thai'),
    registerCataloguePerson:()=>{throw new Error('Must not create May Thai when Mai Thai exists');},
    ensureCatalogueReferenceFeatures(args){
      ensureCalls+=1;
      return refresh({...args,head:args.head});
    },
  })).reconcile(catalogue);
  assert.equal(ensureCalls,2);
  assert.equal(settled.kind,'settled');
  assert.equal(settled.decision.nameResolution.kind,'reused');
  assert.equal(settled.decision.personSnapshot.canonicalName,'Mai Thai');
  assert.equal(settled.decision.winner.name,'May Thai');
  assert.equal(settled.decision.referenceAssetId,'asset-reg');
});
