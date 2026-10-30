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

function personSnapshot(name='Example Performer'){
  const modelRef=buffaloModelReference('single_reference_face').digest,personId='person-registered',referenceAssetId='asset-reg';
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
