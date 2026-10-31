'use strict';
/**
 * Fixture id: post_qualified_workless_provider_pending
 *
 * Hang class (post-#59): after qualified_candidate, ensure/register waits on ThePornDB;
 * tip silent-caught provider fail → workless PEOPLE_CATALOGUE_PROVIDER_PENDING →
 * 0 decisions, 0 ensure Work, Formation productIdentityIssue=null (idle analyzing).
 *
 * Product fix (#SD-143): provider fail caches kind:'failed' + wake; registration/ensure
 * fail-closed; Formation surfaces Attention-visible productIdentityIssue. This suite must
 * stay GREEN — forbid the tip compound idle and assert SSOT Work-boundary compliance
 * via fail-closed Attention (or durable people_image_preparation Work).
 */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultCatalogueSettlementCoordinator}=require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-coordinator');
const {createUsAdultCatalogueDecisionStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-decision-store');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {createPeopleImageOperationStore}=require('../../src/helix/domains/people/persistence/people-image-operation-store');
const {preparationWork}=require('../../src/helix/domains/people/application/people-image-operation-coordinator');
const {createUsAdultCatalogueBuffaloRefresh}=require('../../src/helix/domains/people/application/us-adult-catalogue-buffalo-refresh');
const {createUsAdultCatalogueRegistrationAdmission}=
  require('../../src/helix/domains/people/application/us-adult-catalogue-registration-admission');
const {westernAdultProductIdentityIssue,classifyFormation}=require('../../src/helix/domains/libra/application/formation-query');
const {createCatalogueProviderObservationPort}=require('../../src/helix/integrations/us-adult-catalogue-provider-observation');
const {
  recordUsAdultCatalogueSettlementFailure,
  clearUsAdultCatalogueSettlementFailure,
  readUsAdultCatalogueSettlementFailure,
}=require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-failure-memo');

const FIXTURE_ID='post_qualified_workless_provider_pending';
const PROVIDER_PENDING='PEOPLE_CATALOGUE_PROVIDER_PENDING';
const PROVIDER_FAILED='PEOPLE_CATALOGUE_PROVIDER_FAILED';

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

async function qualifiedCandidate(t){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');await f.completeObservation('initial');
  f.options.movieProductionReader.readFact=()=>f.identity;
  const catalogue=f.reconcile();
  assert.equal(catalogue.kind,'catalogue_candidate');
  assert.equal(catalogue.assessment.status,'qualified_candidate');
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

/** Post-failure provider observation shape (cached after tip silent-catch was removed). */
function providerFailed(code=PROVIDER_FAILED){
  return Object.freeze({kind:'failed',code,message:'ThePornDB catalogue provider search failed.'});
}

function postObserveWorks(){
  return [
    {workId:'libra-us-adult-catalogue-initial-frames-work-abc',state:'succeeded',events:[]},
    {workId:'libra-us-adult-catalogue-observation-work-abc',state:'succeeded',events:[]},
  ];
}

function formationSurface({decision,openOps,settled}){
  const settlementFailure=settled?.kind==='failed'
    ?{reasonCode:settled.reasonCode||PROVIDER_FAILED}:null;
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:postObserveWorks(),peoplePrepOpen:openOps.length>0,catalogueDecision:Boolean(decision),
    settlementFailure,
  });
  const classification=classifyFormation({run:{state:'active'},works:postObserveWorks(),issue});
  const analysisState=decision?'completed':(issue?'attention_required':'analyzing');
  return {issue,classification,analysisState};
}

/**
 * Forbidden compound outcome for Happy / merge-ready Drive:
 * pending + PROVIDER_PENDING + workId=null + no decision + no image op + Formation issue null.
 */
function assertPostQualifiedWorklessProviderPendingForbidden({
  settled,decisionStore,operationStore,label,
}){
  const decision=decisionStore.getByRun(settled.libraRunId||'run');
  const openOps=operationStore.listPendingPage({cursor:null,limit:100});
  const {issue,classification,analysisState}=formationSurface({decision,openOps,settled});
  const worklessPending=settled.kind==='pending'&&!settled.workId&&
    (settled.pendingCode===PROVIDER_PENDING||settled.reasonCode==='us_adult_catalogue_reference_features_pending'||
      settled.reasonCode==='us_adult_catalogue_registration_required');
  const hang=worklessPending&&!decision&&openOps.length===0&&issue==null&&classification==='in_progress';
  assert.equal(hang,false,
    `${FIXTURE_ID} (${label}): tip compound idle — settlement=${settled.kind} workId=${settled.workId||'null'} `+
    `pendingCode=${settled.pendingCode||'null'} decisions=${decision?1:0} openOps=${openOps.length} `+
    `issue=${issue&&issue.reasonCode||'null'} classification=${classification} analysisState=${analysisState}`);
}

/**
 * SSOT Work-boundary compliance (People people_image_operations + people_image_preparation).
 * After qualified_candidate, formal registration / ensure image prep must either:
 *   (A) open durable People image op + people_image_preparation workId, or
 *   (B) fail-closed to Attention-visible productIdentityIssue / settlement failed,
 * and must never leave workless PROVIDER_PENDING forever with null issue + in_progress analyzing.
 */
function assertSsotPeopleImageWorkBoundaryCompliance({
  settled,decisionStore,operationStore,label,
}){
  const decision=decisionStore.getByRun(settled.libraRunId||'run');
  const openOps=operationStore.listPendingPage({cursor:null,limit:100});
  const {issue,classification,analysisState}=formationSurface({decision,openOps,settled});

  const worklessProviderForever=settled.kind==='pending'&&settled.workId==null&&
    settled.pendingCode===PROVIDER_PENDING&&!decision&&openOps.length===0;
  assert.equal(worklessProviderForever,false,
    `${FIXTURE_ID} (${label}): SSOT frame — after qualified_candidate, provider fail/waiting must not leave `+
    `settlement as workless ${PROVIDER_PENDING} (workId=null) forever`);

  const durablePeopleImageWork=Boolean(settled.workId)&&typeof settled.workId==='string'&&
    settled.workId.startsWith('people-image-work-')&&openOps.length>0;
  const failClosedAttention=settled.kind==='failed'||(issue!=null&&classification==='attention_required');
  const frameCompliant=durablePeopleImageWork||failClosedAttention||Boolean(decision);
  assert.equal(frameCompliant,true,
    `${FIXTURE_ID} (${label}): SSOT frame — formal registration/ensure image prep must open `+
    `people_image_operations + people_image_preparation Work (durable workId) OR fail-closed to `+
    `Attention-visible productIdentityIssue; got settlement=${settled.kind} workId=${settled.workId||'null'} `+
    `pendingCode=${settled.pendingCode||'null'} openOps=${openOps.length} `+
    `issue=${issue&&issue.reasonCode||'null'} classification=${classification}`);

  const silentIdleAnalyzing=issue==null&&classification==='in_progress'&&analysisState==='analyzing'&&
    !decision&&openOps.length===0&&!settled.workId&&settled.kind!=='failed';
  assert.equal(silentIdleAnalyzing,false,
    `${FIXTURE_ID} (${label}): Formation/UI surface must not stay productIdentityIssue=null + `+
    `in_progress + analyzing for workless provider compound`);
}

test('post-qualified provider failure fail-closes ensure without workless PROVIDER_PENDING idle',async t=>{
  const {f,catalogue}=await qualifiedCandidate(t);
  const personId='person-tia-provider-pending',factDigest=D('person-tia-provider-pending');
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  const peopleStore={
    getPerson(){return {personId,currentRevision:1,currentReferenceRevision:1,
      revision:{canonicalName:'Example Performer',aliases:[]}};},
    readUsAdultPersonSnapshot(){return legacySnapshot(personId,factDigest);},
    getPersonReferenceProjection(){return legacySnapshot(personId,factDigest).referenceProjection;},
    hasReferenceImage(){return false;},
  };
  let providerCalls=0;
  const refresh=createUsAdultCatalogueBuffaloRefresh({
    peopleStore,operationStore,
    peopleImagePort:{stageUpload(){throw new Error('must not stage while provider failed');}},
    workResultReader:{status:()=>({state:'running'})},
    observeProviderSearch:()=>{providerCalls+=1;return providerFailed();},
    readImageBytes:()=>null,
    buildFrameImageProof:()=>({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_FRAME_PROOF_PENDING'}),
  }).refreshBuffaloCatalogueReference;
  const options=settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest),
    ensureCatalogueReferenceFeatures:(args)=>refresh({...args,head:args.head}),
  });
  const settled=createUsAdultCatalogueSettlementCoordinator(options).reconcile(catalogue);
  assert.ok(providerCalls>=1,'ensure must consult catalogue provider observation');
  assert.equal(settled.kind,'failed');
  assert.equal(settled.reasonCode,PROVIDER_FAILED);
  assert.equal(settled.workId,undefined);
  assert.equal(options.usAdultCatalogueDecisionStore.getByRun(catalogue.libraRunId),null);
  assert.equal(operationStore.listPendingPage({cursor:null,limit:100}).length,0);
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'name-bound ensure frame',
  });
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'name-bound ensure',
  });
});

test('post-qualified not_found registration provider failure fail-closes without workless idle',async t=>{
  const {f,catalogue}=await qualifiedCandidate(t);
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  const admission=createUsAdultCatalogueRegistrationAdmission({
    peopleStore:{readUsAdultPersonSnapshot(){return null;}},
    assembleEvidence:()=>({kind:'failed',code:PROVIDER_FAILED}),
    register(){throw new Error('must not register while provider failed');},
  });
  const options=settlementOptions(f,{
    people:[],
    registerCataloguePerson:({input,inputDigest,resolution,candidate})=>
      admission.registerCataloguePerson({input,inputDigest,resolution,candidate}),
  });
  const settled=createUsAdultCatalogueSettlementCoordinator(options).reconcile(catalogue);
  assert.equal(settled.kind,'failed');
  assert.equal(settled.reasonCode,PROVIDER_FAILED);
  assert.ok(!settled.workId);
  assert.equal(options.usAdultCatalogueDecisionStore.getByRun(catalogue.libraRunId),null);
  assert.equal(operationStore.listPendingPage({cursor:null,limit:100}).length,0);
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'not_found registration frame',
  });
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'not_found registration',
  });
});

test('second reconcile after provider failure stays fail-closed (no workless PROVIDER_PENDING forever)',async t=>{
  const {f,catalogue}=await qualifiedCandidate(t);
  const personId='person-tia-retry',factDigest=D('person-tia-retry');
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  const peopleStore={
    getPerson(){return {personId,currentRevision:1,currentReferenceRevision:1,
      revision:{canonicalName:'Example Performer',aliases:[]}};},
    readUsAdultPersonSnapshot(){return legacySnapshot(personId,factDigest);},
    getPersonReferenceProjection(){return legacySnapshot(personId,factDigest).referenceProjection;},
    hasReferenceImage(){return false;},
  };
  const refresh=createUsAdultCatalogueBuffaloRefresh({
    peopleStore,operationStore,
    peopleImagePort:{stageUpload(){throw new Error('must not stage');}},
    workResultReader:{status:()=>({state:'running'})},
    observeProviderSearch:()=>providerFailed('PEOPLE_CATALOGUE_PROVIDER_INVALID'),
    readImageBytes:()=>null,
  }).refreshBuffaloCatalogueReference;
  const options=settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>legacySnapshot(personId,factDigest),
    ensureCatalogueReferenceFeatures:(args)=>refresh({...args,head:args.head}),
  });
  const coordinator=createUsAdultCatalogueSettlementCoordinator(options);
  const first=coordinator.reconcile(catalogue);
  const second=coordinator.reconcile(catalogue);
  assert.equal(first.kind,'failed');
  assert.equal(second.kind,'failed');
  assert.equal(second.reasonCode,'PEOPLE_CATALOGUE_PROVIDER_INVALID');
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled:second,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'second reconcile frame',
  });
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled:second,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'second reconcile',
  });
});

test('Host fairness workId-only eligibility is not Happy when Formation surfaces provider settlement failure',()=>{
  const libraPublic=fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/libra/public/index.js'),'utf8');
  const formation=fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/libra/application/formation-query.js'),'utf8');
  assert.match(libraPublic,/eligible\s*=\s*result\.kind\s*===\s*'pending'\s*&&\s*Boolean\(result\.workId\)/);
  assert.match(formation,/settlementFailure/);
  const workless={kind:'pending',workId:null,pendingCode:PROVIDER_PENDING};
  const eligible=workless.kind==='pending'&&Boolean(workless.workId);
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:postObserveWorks(),peoplePrepOpen:false,catalogueDecision:false,
    settlementFailure:{reasonCode:PROVIDER_FAILED},
  });
  assert.equal(issue?.reasonCode,PROVIDER_FAILED);
  assert.equal(classifyFormation({run:{state:'active'},works:postObserveWorks(),issue}),'attention_required');
  // Tip hang was fairness ineligible + null issue; product fix requires Attention-visible issue.
  const composedHang=!eligible&&issue==null;
  assert.equal(composedHang,false,
    `${FIXTURE_ID}: fairness ineligible + Formation issue null must not be an acceptable Happy idle`);
});

test('SSOT frame: people_image_preparation Work shape is the durable boundary registration/ensure must enter',()=>{
  const operation={operationId:'op-frame-boundary',payloadDigest:D('op-frame-boundary'),
    payload:{operationKind:'catalogue_registration'}};
  const work=preparationWork(operation);
  assert.equal(work.ownerDomain,'people');
  assert.equal(work.processType,'people_image_preparation');
  assert.equal(work.workKind,'people_image_preparation');
  assert.match(work.workId,/^people-image-work-/);
  assert.equal(work.processId,operation.operationId);
  assert.equal(work.dependencyRefs[0].objectType,'people_image_operation');
  assert.equal(work.dependencyRefs[0].ownerDomain,'people');
});

test('SSOT frame: Formation surfaces Attention for provider settlement failure (not null+analyzing)',()=>{
  const settled={kind:'failed',workId:null,reasonCode:PROVIDER_FAILED,
    phase:'us_adult_catalogue_name_bound',libraRunId:'run'};
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled,
    decisionStore:{getByRun:()=>null},
    operationStore:{listPendingPage:()=>[]},
    label:'formation analyzing surface',
  });
  const {issue,classification,analysisState}=formationSurface({
    decision:null,openOps:[],settled,
  });
  assert.equal(issue.reasonCode,PROVIDER_FAILED);
  assert.equal(classification,'attention_required');
  assert.notEqual(analysisState,'analyzing');
});

test('catalogue provider observation caches failure and wakes instead of silent swallow',async()=>{
  let wakes=0;
  const port=createCatalogueProviderObservationPort({
    fetchImpl:async()=>{throw Object.assign(new Error('dial timeout'),{code:'P5_PROVIDER_TRANSPORT_FAILED'});},
    readStashBoxConfiguration:()=>({endpoint:'https://api.theporndb.net/graphql',configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    wake:()=>{wakes+=1;},
    delay:async()=>{},
  });
  const first=port.observeProviderSearch({name:'Tia Ling',aliases:[]});
  assert.equal(first.kind,'waiting');
  assert.equal(first.pendingCode,PROVIDER_PENDING);
  for(let i=0;i<40;i+=1)await new Promise(resolve=>setImmediate(resolve));
  const second=port.observeProviderSearch({name:'Tia Ling',aliases:[]});
  assert.equal(second.kind,'failed');
  assert.equal(second.code,PROVIDER_FAILED);
  assert.ok(wakes>=1,'failure must wake settlement');
});

test('settlement failure memo is Attention-readable for Formation',()=>{
  const runId='run-memo-provider-fail';
  clearUsAdultCatalogueSettlementFailure(runId);
  recordUsAdultCatalogueSettlementFailure({libraRunId:runId,reasonCode:PROVIDER_FAILED});
  assert.equal(readUsAdultCatalogueSettlementFailure({libraRunId:runId}).reasonCode,PROVIDER_FAILED);
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:postObserveWorks(),peoplePrepOpen:false,catalogueDecision:false,
    settlementFailure:readUsAdultCatalogueSettlementFailure({libraRunId:runId}),
  });
  assert.equal(issue.reasonCode,PROVIDER_FAILED);
  clearUsAdultCatalogueSettlementFailure(runId);
  assert.equal(readUsAdultCatalogueSettlementFailure({libraRunId:runId}),null);
});

test('settlement failure memo + provider failure cache survive across process-local rebind (wake/retry durable)',async t=>{
  const {createUsAdultCatalogueSettlementFailureMemo}=
    require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-failure-memo');
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'us-adult-settle-memo-'));
  t.after(()=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{/* ignore */}});
  const first=createUsAdultCatalogueSettlementFailureMemo({persistRoot:root});
  first.recordUsAdultCatalogueSettlementFailure({libraRunId:'run-durable',reasonCode:PROVIDER_FAILED});
  // Simulate process rebind: new memo instance, same durable root — wake/retry across reconcile must still see diagnosis.
  const second=createUsAdultCatalogueSettlementFailureMemo({persistRoot:root});
  assert.equal(second.readUsAdultCatalogueSettlementFailure({libraRunId:'run-durable'}).reasonCode,PROVIDER_FAILED);

  const cacheRoot=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'us-adult-provider-cache-'));
  t.after(()=>{try{fs.rmSync(cacheRoot,{recursive:true,force:true});}catch{/* ignore */}});
  let wakes=0;
  const portA=createCatalogueProviderObservationPort({
    fetchImpl:async()=>{throw Object.assign(new Error('dial timeout'),{code:'P5_PROVIDER_TRANSPORT_FAILED'});},
    readStashBoxConfiguration:()=>({endpoint:'https://api.theporndb.net/graphql',configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    wake:()=>{wakes+=1;},
    cacheRoot,
    delay:async()=>{},
  });
  portA.observeProviderSearch({name:'Tia Ling',aliases:[]});
  for(let i=0;i<40;i+=1)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(wakes>=1);
  const portB=createCatalogueProviderObservationPort({
    fetchImpl:async()=>{throw new Error('must not refetch after durable failure');},
    readStashBoxConfiguration:()=>({endpoint:'https://api.theporndb.net/graphql',configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    cacheRoot,
  });
  const rebound=portB.observeProviderSearch({name:'Tia Ling',aliases:[]});
  assert.equal(rebound.kind,'failed');
  assert.equal(rebound.code,PROVIDER_FAILED);
});

test('first-tick provider waiting is bounded then fail-closed (no forever workless PROVIDER_PENDING)',async()=>{
  let now=1_000_000;
  const port=createCatalogueProviderObservationPort({
    fetchImpl:()=>new Promise(()=>{}), // never settles
    readStashBoxConfiguration:()=>({endpoint:'https://api.theporndb.net/graphql',configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    now:()=>now,
    waitingBoundMs:50,
  });
  const first=port.observeProviderSearch({name:'Hang Actor',aliases:[]});
  assert.equal(first.kind,'waiting');
  assert.equal(first.pendingCode,PROVIDER_PENDING);
  assert.equal(first.workId,undefined);
  now+=51;
  const second=port.observeProviderSearch({name:'Hang Actor',aliases:[]});
  assert.equal(second.kind,'failed');
  assert.equal(second.code,PROVIDER_FAILED);
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled:{kind:'failed',workId:null,reasonCode:second.code,phase:'us_adult_catalogue_name_bound',libraRunId:'run'},
    decisionStore:{getByRun:()=>null},
    operationStore:{listPendingPage:()=>[]},
    label:'bounded first-tick waiting',
  });
});

test('exhausted provider image bytes fail-closed (not forever IMAGE_PENDING)',async t=>{
  const {f}=await qualifiedCandidate(t);
  const personId='person-image-exhausted',factDigest=D('person-image-exhausted');
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  const urlDigest=D('https://cdn.example/tia.jpg');
  const {queryNames}=require('../../src/helix/contracts/us-adult-name-query');
  const candidates=[{providerKey:'perf-1',canonicalName:'Tia Ling',aliases:[],
    images:[{imageId:'img-1',urlDigest,width:200,height:300}]}];
  const queries=queryNames('Tia Ling',[]).map(term=>({term,limit:Math.max(candidates.length+1,1),
    completion:'complete',responseDigest:D(candidates),candidates}));
  const observationBody={schema:'people.us-adult-provider-search-observation@1',provider:'theporndb',queries};
  const observation={...observationBody,observationDigest:D(observationBody)};
  const peopleStore={
    getPerson(){return {personId,currentRevision:1,currentReferenceRevision:0,
      revision:{canonicalName:'Tia Ling',aliases:[]}};},
    readUsAdultPersonSnapshot(){return null;},
    getPersonReferenceProjection(){return null;},
    hasReferenceImage(){return false;},
  };
  let imageReads=0;
  const refresh=createUsAdultCatalogueBuffaloRefresh({
    peopleStore,operationStore,
    peopleImagePort:{stageUpload(){throw new Error('must not stage after image fail');}},
    workResultReader:{status:()=>({state:'running'})},
    observeProviderSearch:()=>observation,
    readImageBytes:()=>{
      imageReads+=1;
      if(imageReads===1)return null; // short inflight wait
      return Object.freeze({kind:'failed',code:'PEOPLE_CATALOGUE_IMAGE_FAILED',
        message:'Provider image bytes are exhausted.'});
    },
  }).refreshBuffaloCatalogueReference;
  const args={
    personId,head:{personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:0},
    input:{winner:{name:'Tia Ling',aliases:[]},libraRunId:'run-img',observationHandle:{mode:'initial'}},
    inputDigest:D('input-img'),candidate:{completedBatches:{mode:'initial'}},
  };
  const first=refresh(args);
  assert.ok(first.kind==='pending'||first.kind==='failed');
  const second=refresh(args);
  assert.equal(second.kind,'failed');
  assert.equal(second.code,'PEOPLE_CATALOGUE_IMAGE_FAILED');
  assert.notEqual(second.pendingCode,'PEOPLE_BUFFALO_REFRESH_IMAGE_PENDING');

  let wakes=0;
  const seedPort=createCatalogueProviderObservationPort({
    fetchImpl:async(url,init)=>{
      if(init?.method==='POST'||String(url).includes('graphql')){
        const body=Buffer.from(JSON.stringify({data:{searchPerformer:[{
          id:'perf-1',name:'Tia Ling',aliases:[],
          images:[{id:'img-1',url:'https://cdn.example/tia.jpg',width:200,height:300}],
        }]}}));
        return {ok:true,status:200,url:String(url),headers:{get:()=>null},
          arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};
      }
      throw Object.assign(new Error('cdn down'),{code:'P5_PROVIDER_TRANSPORT_FAILED'});
    },
    readStashBoxConfiguration:()=>({endpoint:'https://api.theporndb.net/graphql',configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    wake:()=>{wakes+=1;},
    delay:async()=>{},
  });
  seedPort.observeProviderSearch({name:'Tia Ling',aliases:[]});
  for(let i=0;i<40;i+=1)await new Promise(resolve=>setImmediate(resolve));
  const seeded=seedPort.observeProviderSearch({name:'Tia Ling',aliases:[]});
  assert.ok(seeded.queries);
  const digestHex=seeded.queries[0].candidates[0].images[0].urlDigest;
  assert.equal(seedPort.readImageBytes({kind:'provider',urlDigest:digestHex}),null);
  for(let i=0;i<40;i+=1)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(wakes>=1);
  const exhausted=seedPort.readImageBytes({kind:'provider',urlDigest:digestHex});
  assert.equal(exhausted?.kind,'failed');
  assert.equal(exhausted.code,'PEOPLE_CATALOGUE_IMAGE_FAILED');
});

test('Formation Attention for provider settlement failure exposes actionable primaryAction',()=>{
  const {nextAction}=require('../../src/helix/domains/libra/application/formation-query');
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:postObserveWorks(),peoplePrepOpen:false,catalogueDecision:false,
    settlementFailure:{reasonCode:PROVIDER_FAILED},
  });
  assert.equal(issue.reasonCode,PROVIDER_FAILED);
  const action=nextAction(postObserveWorks(),'attention_required',issue,'active',null,null,null,null);
  assert.equal(action.state,'attention_required');
  assert.match(action.label,/外库演员资料准备失败/);
  assert.ok(action.primaryAction,'§9.8.6 Attention items need explicit primaryAction');
  assert.equal(action.primaryAction.action,'choose_us_adult_actor');
  assert.equal(action.primaryAction.label,'选择演员');
  assert.equal(action.primaryAction.targetPage,'formation');
});
