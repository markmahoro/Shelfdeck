'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {buffaloModelReference}=require('../../src/helix/contracts/buffalo-model-reference');
const {createUsAdultCatalogueDecisionInput}=require('../../src/helix/domains/libra/model/us-adult-catalogue-decision-input');
const {createUsAdultCatalogueSettlementCoordinator}=require('../../src/helix/domains/libra/application/us-adult-catalogue-settlement-coordinator');
const {createUsAdultCatalogueDecisionStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-decision-store');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {assertRequiredUsAdultActor}=require('../../src/helix/contracts/us-adult-actor-package');
const currentSelection=require('../../src/helix/domains/libra/model/us-adult-actor-selection-current');

function personSnapshot(name='Example Performer', modelRef=buffaloModelReference('single_reference_face').digest){
  const personId='person-registered',referenceAssetId='asset-reg';
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
  const pending=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people,readPersonHead:head,readUsAdultPersonSnapshot:()=>snapshotWithFact(stale.personSnapshot,factDigest),
    registerCataloguePerson:forbidRegister,
  })).reconcile(catalogue);
  assert.equal(pending.kind,'pending');
  assert.equal(pending.phase,'us_adult_catalogue_name_bound');
  assert.equal(pending.reasonCode,'us_adult_catalogue_reference_features_pending');
  assert.equal(pending.personId,personId);
  assert.equal(pending.winnerName,'May Thai');
  assert.notEqual(pending.reasonCode,'us_adult_catalogue_buffalo_reference_required');
  assert.notEqual(pending.kind,'waiting_registration');
});

test('name-bound person without buffalo reference is pending features — not hang-person registration',async t=>{
  const {f,catalogue}=await candidate(t);
  const personId='person-name-bound',factDigest=D('person-fact-bound');
  const settled=createUsAdultCatalogueSettlementCoordinator(settlementOptions(f,{
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:factDigest,
      canonicalName:'Example Performer',aliases:[]}],
    readPersonHead:()=>({personId,personRevision:1,personFactDigest:factDigest,currentReferenceRevision:1}),
    readUsAdultPersonSnapshot:()=>{
      // Active reference exists but not current buffalo_l model — face is not People match key.
      const modelRef='0'.repeat(64),referenceAssetId='asset-legacy';
      const projectionValue={projectionContract:'people.person-reference-projection@1',personId,personRevision:1,
        currentReferenceRevision:1,contributions:[{ownerPersonId:personId,ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
          activeAssets:[{referenceAssetId,artifactHandleId:'picture',artifactDigest:D('picture')}],
          activeFaces:[{referenceFaceId:'face-1',referenceAssetId,embeddingHandleId:'embedding',embeddingDigest:D('embedding'),modelRef}]}]};
      const projection={...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
      const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
        personId,personRevision:1,canonicalName:'Example Performer',aliases:[],personFactDigest:factDigest,referenceProjection:projection};
      return {...personValue,snapshotDigest:D(personValue)};
    },
  })).reconcile(catalogue);
  assert.equal(settled.kind,'pending');
  assert.equal(settled.phase,'us_adult_catalogue_name_bound');
  assert.equal(settled.reasonCode,'us_adult_catalogue_reference_features_pending');
  assert.equal(settled.personId,personId);
  assert.notEqual(settled.reasonCode,'us_adult_catalogue_buffalo_reference_required');
  assert.notEqual(settled.kind,'waiting_registration');
});
