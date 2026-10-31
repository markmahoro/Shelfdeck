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

function personSnapshot(name='Example Performer',personId='person-registered'){
  const modelRef=buffaloModelReference('single_reference_face').digest,referenceAssetId='asset-reg';
  const projectionValue={projectionContract:'people.person-reference-projection@1',personId,personRevision:1,
    currentReferenceRevision:1,contributions:[{ownerPersonId:personId,ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
      activeAssets:[{referenceAssetId,artifactHandleId:'picture',artifactDigest:D('picture')}],
      activeFaces:[{referenceFaceId:'face-1',referenceAssetId,embeddingHandleId:'embedding',embeddingDigest:D('embedding'),modelRef}]}]};
  const projection={...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
  const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId,personRevision:1,canonicalName:name,aliases:[],personFactDigest:D('person'),referenceProjection:projection};
  return {personSnapshot:{...personValue,snapshotDigest:D(personValue)},referenceAssetId,personId};
}

async function candidate(t){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial');
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
    refreshBuffaloCatalogueReference:extra.refreshBuffaloCatalogueReference,
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

function peopleRow({personId,name,aliases=[]}){
  return {personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:D('person-'+personId),
    canonicalName:name,aliases};
}

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

function legacySnapshot(personId,factDigest){
  const modelRef='0'.repeat(64),referenceAssetId='asset-legacy';
  const projectionValue={projectionContract:'people.person-reference-projection@1',personId,personRevision:1,
    currentReferenceRevision:1,contributions:[{ownerPersonId:personId,ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
      activeAssets:[{referenceAssetId,artifactHandleId:'picture',artifactDigest:D('picture')}],
      activeFaces:[{referenceFaceId:'face-1',referenceAssetId,embeddingHandleId:'embedding',embeddingDigest:D('embedding'),modelRef}]}]};
  const projection={...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
  const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId,personRevision:1,canonicalName:'Example Performer',aliases:[],personFactDigest:factDigest,referenceProjection:projection};
  return {...personValue,snapshotDigest:D(personValue)};
}

test('unwired stale buffalo reference stays waiting_registration',async t=>{
  const {f,catalogue}=await candidate(t);
  const personId='person-stale-unwired',factDigest=D('person-fact-unwired');
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest),
  })).reconcile(catalogue);
  assert.equal(settled.kind,'waiting_registration');
  assert.equal(settled.reasonCode,'us_adult_catalogue_buffalo_reference_required');
});

test('wired stale buffalo refresh is pending work then settled, not a permanent stall',async t=>{
  const {f,catalogue}=await candidate(t);
  const personId='person-stale',factDigest=D('person-fact-stale');
  const imageBytes=Buffer.from([137,80,78,71,13,10,26,10,1]);
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  let ready=false;
  const peopleStore={
    getPerson(){return {personId,currentRevision:1,currentReferenceRevision:1,
      revision:{canonicalName:'Example Performer',aliases:[]}};},
    readUsAdultPersonSnapshot(){
      if(!ready)return legacySnapshot(personId,factDigest);
      const built=personSnapshot('Example Performer',personId).personSnapshot;
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
  const coordinator=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest),
    refreshBuffaloCatalogueReference:refresh,
  }));
  const pending=coordinator.reconcile(catalogue);
  assert.equal(pending.kind,'pending');
  assert.notEqual(pending.kind,'waiting_registration');
  assert.equal(pending.reasonCode,'us_adult_catalogue_buffalo_reference_required');
  assert.equal(pending.pendingCode,'PEOPLE_BUFFALO_REFRESH_PREP_PENDING');
  assert.ok(pending.workId);
  const page=operationStore.listPendingPage({cursor:null,limit:100});
  assert.equal(page.length,1);
  const operation=operationStore.get(page[0].scope.operationId);
  assert.equal(operation.payload.operationKind,'reference_replace');
  assert.equal(D(operation.payload.faceModelRef),D(buffaloModelReference('single_reference_face')));
  const again=coordinator.reconcile(catalogue);
  assert.equal(again.kind,'pending');
  assert.equal(operationStore.listPendingPage({cursor:null,limit:100}).length,1);
  ready=true;
  const settled=coordinator.reconcile(catalogue);
  assert.equal(settled.kind,'settled');
  assert.notEqual(settled.kind,'waiting_registration');
  assert.equal(settled.decision.nameResolution.kind,'reused');
  assert.equal(settled.decision.referenceAssetId,'asset-reg');
  const compiled=createUsAdultCatalogueDecisionInput(f.options).compile({libraRunId:'run',mode:'initial'});
  const selection=currentSelection.build({
    snapshot:{spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run',subjectId:f.args.snapshot.run.subjectId,
      executionBasisDigest:compiled.input.runExecutionBasisDigest}},
    resolvedIdentityDigest:compiled.input.resolvedIdentityDigest,
    catalogueDecision:settled.decision,referenceAssetId:settled.decision.referenceAssetId,
  });
  assert.equal(currentSelection.actorRelation(selection).source,'face_catalogue');
});
