'use strict';
/**
 * Fixture id: post_qualified_workless_provider_pending
 *
 * Hang class (post-#59 NAS dig / root-cause): after qualified_candidate,
 * ensure/register waits on ThePornDB; provider returns workless
 * PEOPLE_CATALOGUE_PROVIDER_PENDING (HTTP 5xx / proxy timeout silent-caught on tip) →
 * settlement pending with workId=null → 0 decisions, 0 ensure Work,
 * Formation productIdentityIssue=null (idle in_progress / actor-selection analyzing).
 *
 * SSOT frame (People §6.8.3 / catalogue registration): formal registration / reference
 * ensure image prep must open people_image_operations + people_image_preparation Work
 * (durable workId) OR fail-closed to Attention-visible productIdentityIssue — never
 * silent workless PROVIDER_PENDING forever outside the Work boundary.
 *
 * RED-first: this compound idle + frame breach must FAIL on unfixed tip. No product fix here.
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

const FIXTURE_ID='post_qualified_workless_provider_pending';
const PROVIDER_PENDING='PEOPLE_CATALOGUE_PROVIDER_PENDING';

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

/** Workless ThePornDB wait — tip observeProviderSearch shape (no workId). */
function worklessProviderWaiting(){
  return Object.freeze({kind:'waiting',pendingCode:PROVIDER_PENDING});
}

function postObserveWorks(){
  return [
    {workId:'libra-us-adult-catalogue-initial-frames-work-abc',state:'succeeded',events:[]},
    {workId:'libra-us-adult-catalogue-observation-work-abc',state:'succeeded',events:[]},
  ];
}

function formationSurface({decision,openOps}){
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:postObserveWorks(),peoplePrepOpen:openOps.length>0,catalogueDecision:Boolean(decision),
  });
  const classification=classifyFormation({run:{state:'active'},works:postObserveWorks(),issue});
  // Tip actor-selection: post-qualified catalogue basis present, no decision → analyzing.
  const analysisState=decision?'completed':'analyzing';
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
  const {issue,classification,analysisState}=formationSurface({decision,openOps});
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
 *   (B) fail-closed to Attention-visible productIdentityIssue,
 * and must never leave workless PROVIDER_PENDING forever with null issue + in_progress analyzing.
 */
function assertSsotPeopleImageWorkBoundaryCompliance({
  settled,decisionStore,operationStore,label,
}){
  const decision=decisionStore.getByRun(settled.libraRunId||'run');
  const openOps=operationStore.listPendingPage({cursor:null,limit:100});
  const {issue,classification,analysisState}=formationSurface({decision,openOps});

  const worklessProviderForever=settled.kind==='pending'&&settled.workId==null&&
    settled.pendingCode===PROVIDER_PENDING&&!decision&&openOps.length===0;
  assert.equal(worklessProviderForever,false,
    `${FIXTURE_ID} (${label}): SSOT frame — after qualified_candidate, provider fail/waiting must not leave `+
    `settlement as workless ${PROVIDER_PENDING} (workId=null) forever`);

  const durablePeopleImageWork=Boolean(settled.workId)&&typeof settled.workId==='string'&&
    settled.workId.startsWith('people-image-work-')&&openOps.length>0;
  const failClosedAttention=issue!=null&&classification==='attention_required';
  const frameCompliant=durablePeopleImageWork||failClosedAttention||Boolean(decision);
  assert.equal(frameCompliant,true,
    `${FIXTURE_ID} (${label}): SSOT frame — formal registration/ensure image prep must open `+
    `people_image_operations + people_image_preparation Work (durable workId) OR fail-closed to `+
    `Attention-visible productIdentityIssue; got settlement=${settled.kind} workId=${settled.workId||'null'} `+
    `pendingCode=${settled.pendingCode||'null'} openOps=${openOps.length} `+
    `issue=${issue&&issue.reasonCode||'null'} classification=${classification}`);

  const silentIdleAnalyzing=issue==null&&classification==='in_progress'&&analysisState==='analyzing'&&
    !decision&&openOps.length===0&&!settled.workId;
  assert.equal(silentIdleAnalyzing,false,
    `${FIXTURE_ID} (${label}): Formation/UI surface must not stay productIdentityIssue=null + `+
    `in_progress + analyzing for workless provider compound`);
}

test('post-qualified workless PROVIDER_PENDING must not idle without decision, ensure Work, or Attention',async t=>{
  // Prefer Tia-shape: name-bound reuse without buffalo face (TLII/TTIA).
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
    peopleImagePort:{stageUpload(){throw new Error('must not stage while provider is workless pending');}},
    workResultReader:{status:()=>({state:'running'})},
    observeProviderSearch:()=>{providerCalls+=1;return worklessProviderWaiting();},
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
  // Tip today: pending / reference_features_pending / workId=null / no op.
  assert.equal(settled.kind,'pending');
  assert.equal(settled.reasonCode,'us_adult_catalogue_reference_features_pending');
  assert.equal(settled.pendingCode,PROVIDER_PENDING);
  assert.equal(settled.workId,null);
  assert.equal(options.usAdultCatalogueDecisionStore.getByRun(catalogue.libraRunId),null);
  assert.equal(operationStore.listPendingPage({cursor:null,limit:100}).length,0);
  // Gate: SSOT Work-boundary first, then compound idle forbid (RED on unfixed tip).
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'name-bound ensure frame',
  });
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'name-bound ensure',
  });
});

test('post-qualified not_found registration workless PROVIDER_PENDING must not idle without decision, Work, or Attention',async t=>{
  // Lea-shape: not_found create hits the same provider evidence gate.
  const {f,catalogue}=await qualifiedCandidate(t);
  const operationStore=createPeopleImageOperationStore(f.workspaceOptions);
  const admission=createUsAdultCatalogueRegistrationAdmission({
    peopleStore:{readUsAdultPersonSnapshot(){return null;}},
    assembleEvidence:()=>({kind:'waiting',pendingCode:PROVIDER_PENDING}),
    register(){throw new Error('must not register while provider is workless pending');},
  });
  const options=settlementOptions(f,{
    people:[],
    registerCataloguePerson:({input,inputDigest,resolution,candidate})=>
      admission.registerCataloguePerson({input,inputDigest,resolution,candidate}),
  });
  const settled=createUsAdultCatalogueSettlementCoordinator(options).reconcile(catalogue);
  assert.equal(settled.kind,'pending');
  assert.ok(!settled.workId);
  assert.equal(settled.pendingCode,PROVIDER_PENDING);
  assert.equal(options.usAdultCatalogueDecisionStore.getByRun(catalogue.libraRunId),null);
  assert.equal(operationStore.listPendingPage({cursor:null,limit:100}).length,0);
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'not_found registration frame',
  });
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'not_found registration',
  });
});

test('second reconcile after workless PROVIDER_PENDING still forbids compound idle and frame breach',async t=>{
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
    observeProviderSearch:()=>worklessProviderWaiting(),
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
  assert.equal(first.kind,'pending');
  assert.equal(second.kind,'pending');
  assert.equal(second.workId,null);
  assert.equal(second.pendingCode,PROVIDER_PENDING);
  // Forever: second pass still workless — frame must stay RED until Work or Attention.
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled:second,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'second reconcile frame',
  });
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled:second,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'second reconcile',
  });
});

test('Host fairness workId-only eligibility composes with Formation null issue into hang class',()=>{
  // Tip: eligible = pending && workId; Formation idle post-observe returns null issue.
  const libraPublic=fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/libra/public/index.js'),'utf8');
  const formation=fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/libra/application/formation-query.js'),'utf8');
  const workless={kind:'pending',workId:null,pendingCode:PROVIDER_PENDING};
  const eligible=workless.kind==='pending'&&Boolean(workless.workId);
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:postObserveWorks(),peoplePrepOpen:false,catalogueDecision:false,
  });
  assert.match(libraPublic,/eligible\s*=\s*result\.kind\s*===\s*'pending'\s*&&\s*Boolean\(result\.workId\)/);
  assert.match(formation,/Idle post-observe without a decision is no longer automatic registration Attention/);
  const composedHang=!eligible&&issue==null;
  assert.equal(composedHang,false,
    `${FIXTURE_ID}: fairness ineligible + Formation issue null must not be an acceptable Happy idle`);
});

test('SSOT frame: people_image_preparation Work shape is the durable boundary registration/ensure must enter',()=>{
  // Contract pin (always): once an operation exists, preparationWork is People-owned Supporting Work
  // with durable people-image-work-* id. GREEN settle paths must land pending.workId on this prefix
  // (or fail-closed Attention) — settle tests forbid tip workless PROVIDER_PENDING outside this boundary.
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

test('SSOT frame: Formation null + analyzing must not mask workless provider pending after qualified',()=>{
  // Tip NAS surface for the hang class: productIdentityIssue=null, in_progress, actor-selection analyzing.
  // Gate forbids that surface when settlement is still workless PROVIDER_PENDING (no op / no decision).
  const settled={kind:'pending',workId:null,pendingCode:PROVIDER_PENDING,
    reasonCode:'us_adult_catalogue_reference_features_pending',libraRunId:'run'};
  assertSsotPeopleImageWorkBoundaryCompliance({
    settled,
    decisionStore:{getByRun:()=>null},
    operationStore:{listPendingPage:()=>[]},
    label:'formation analyzing surface',
  });
});
