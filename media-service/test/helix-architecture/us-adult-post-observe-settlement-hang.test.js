'use strict';
/**
 * Fixture id: post_qualified_workless_provider_pending
 *
 * Hang class (post-#59 NAS dig / root-cause): after qualified_candidate,
 * ensure/register waits on ThePornDB; provider returns workless
 * PEOPLE_CATALOGUE_PROVIDER_PENDING (HTTP 5xx silent-caught on tip) →
 * settlement pending with workId=null → 0 decisions, 0 ensure Work,
 * Formation productIdentityIssue=null (idle in_progress).
 *
 * RED-first: this compound idle must FAIL on unfixed tip. No product fix here.
 */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultCatalogueSettlementCoordinator}=require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-coordinator');
const {createUsAdultCatalogueDecisionStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-decision-store');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {createPeopleImageOperationStore}=require('../../src/helix/domains/people/persistence/people-image-operation-store');
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

/**
 * Forbidden compound outcome for Happy / merge-ready Drive:
 * pending + PROVIDER_PENDING + workId=null + no decision + no image op + Formation issue null.
 */
function assertPostQualifiedWorklessProviderPendingForbidden({
  settled,decisionStore,operationStore,label,
}){
  const decision=decisionStore.getByRun(settled.libraRunId||'run');
  const openOps=operationStore.listPendingPage({cursor:null,limit:100});
  const observation={workId:'libra-us-adult-catalogue-observation-work-abc',state:'succeeded',events:[]};
  const frames={workId:'libra-us-adult-catalogue-initial-frames-work-abc',state:'succeeded',events:[]};
  const issue=westernAdultProductIdentityIssue({
    basisDigest:'basis',works:[frames,observation],peoplePrepOpen:openOps.length>0,catalogueDecision:Boolean(decision),
  });
  const classification=classifyFormation({run:{state:'active'},works:[frames,observation],issue});
  const worklessPending=settled.kind==='pending'&&!settled.workId&&
    (settled.pendingCode===PROVIDER_PENDING||settled.reasonCode==='us_adult_catalogue_reference_features_pending'||
      settled.reasonCode==='us_adult_catalogue_registration_required');
  const hang=worklessPending&&!decision&&openOps.length===0&&issue==null&&classification==='in_progress';
  assert.equal(hang,false,
    `${FIXTURE_ID} (${label}): tip compound idle — settlement=${settled.kind} workId=${settled.workId||'null'} `+
    `pendingCode=${settled.pendingCode||'null'} decisions=${decision?1:0} openOps=${openOps.length} `+
    `issue=${issue&&issue.reasonCode||'null'} classification=${classification}`);
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
  // Gate: compound idle is forbidden (RED on unfixed tip).
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
  assertPostQualifiedWorklessProviderPendingForbidden({
    settled,decisionStore:options.usAdultCatalogueDecisionStore,operationStore,label:'not_found registration',
  });
});

test('second reconcile after workless PROVIDER_PENDING still forbids compound idle',async t=>{
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
    basisDigest:'basis',
    works:[
      {workId:'libra-us-adult-catalogue-initial-frames-work-abc',state:'succeeded',events:[]},
      {workId:'libra-us-adult-catalogue-observation-work-abc',state:'succeeded',events:[]},
    ],
    peoplePrepOpen:false,catalogueDecision:false,
  });
  assert.match(libraPublic,/eligible\s*=\s*result\.kind\s*===\s*'pending'\s*&&\s*Boolean\(result\.workId\)/);
  assert.match(formation,/Idle post-observe without a decision is no longer automatic registration Attention/);
  const composedHang=!eligible&&issue==null;
  assert.equal(composedHang,false,
    `${FIXTURE_ID}: fairness ineligible + Formation issue null must not be an acceptable Happy idle`);
});
