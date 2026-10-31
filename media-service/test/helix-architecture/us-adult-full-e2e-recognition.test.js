'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {buildCatalogueActorDecision}=require('../../src/helix/domains/libra/model/us-adult-catalogue-actor-decision');
const {resolveUsAdultName}=require('../../src/helix/domains/people/model/us-adult-name-resolution');
const {buffaloModelReference}=require('../../src/helix/contracts/buffalo-model-reference');
const {CAPABILITY,HANDLE,resultRef}=require('../../src/helix/contracts/us-adult-catalogue-work-types');
const currentSelection=require('../../src/helix/domains/libra/model/us-adult-actor-selection-current');
const {assertRequiredUsAdultActor}=require('../../src/helix/contracts/us-adult-actor-package');
const {createUsAdultCatalogueRegistrationAdmission}=
  require('../../src/helix/domains/people/application/us-adult-catalogue-registration-admission');

function personFixture(name='Example Performer'){
  const modelRef=buffaloModelReference('single_reference_face').digest,personId='person-1',referenceAssetId='asset-1';
  const projectionValue={projectionContract:'people.person-reference-projection@1',personId,personRevision:1,
    currentReferenceRevision:1,contributions:[{ownerPersonId:personId,ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
      activeAssets:[{referenceAssetId,artifactHandleId:'picture',artifactDigest:D('picture')}],
      activeFaces:[{referenceFaceId:'face-1',referenceAssetId,embeddingHandleId:'embedding',embeddingDigest:D('embedding'),modelRef}]}]};
  const projection={...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
  const personValue={schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId,personRevision:1,canonicalName:name,aliases:[],personFactDigest:D('person'),referenceProjection:projection};
  return {personSnapshot:{...personValue,snapshotDigest:D(personValue)},referenceAssetId,personId};
}

function decisionInput(winnerName='Example Performer'){
  const handleValue={schemaRef:HANDLE,schemaVersion:1,analysisId:D('analysis'),libraRunId:'run-1',workspaceId:'workspace-1',
    runExecutionBasisDigest:D('execution'),basisDigest:D('basis'),mode:'initial',completedBatchSetDigest:D('batches'),
    observationSourceSetDigest:D('sources'),modelRefDigest:D('model'),catalogueGenerationDigest:D('generation'),searchPolicyDigest:D('search'),
    clusterParameterDigest:D('clusters'),resultKind:'observed',frameCount:20,faceCount:3,groupCount:1,queryCount:3,
    observationDigest:D('observation-body'),observationArtifactHandle:{artifactKind:'face_catalogue_observation',ownerDomain:'libra',
      ownerScope:{scopeType:'libra_run',scopeId:'run-1'},digestAlgorithm:'sha256',digestHex:D('observation'),sizeBytes:100},outputTargetDigest:D('target')};
  const observationHandle={...handleValue,handleDigest:D(handleValue)};
  const winner={identityKey:'catalogue-person-1',uid:'entry-1',name:winnerName,aliases:[],groupIds:['group-a','group-b'],
    coverageStrata:[0,1,2,3,4],supportingRepresentativeStrata:[0,1,2,3,4]};
  const input={schema:'libra.us-adult-catalogue-decision-input@1',libraRunId:'run-1',subjectId:'subject-1',
    runExecutionBasisDigest:D('execution'),resolvedIdentityDigest:D('identity'),catalogueBasisDigest:D('basis'),
    observationResultRef:{workId:'work',attemptId:'attempt',planId:'plan',eventId:'event',resultId:'result',capabilityRef:CAPABILITY,
      resultSchemaRef:resultRef(CAPABILITY),resultDigest:D(observationHandle),inputBindingDigest:D('input')},observationHandle,
    assessmentPolicyDigest:D('policy'),assessmentDigest:D('assessment'),representativeImagePolicyDigest:D('representative-policy'),winner,expectedChoiceHead:null};
  return {input,inputDigest:D(input)};
}

test('recognition land: registered catalogue decision selects face_catalogue and passes package actor guard',()=>{
  const {personSnapshot,referenceAssetId,personId}=personFixture();
  const {input,inputDigest}=decisionInput();
  const resolution=resolveUsAdultName({name:input.winner.name,aliases:[],people:[]});
  const registration={decisionId:D('registration'),decisionDigest:D('registration-value'),personId,
    catalogueDecisionInputDigest:inputDigest,nameResolutionDigest:resolution.resolutionDigest};
  const catalogueDecision=buildCatalogueActorDecision({input,inputDigest,resolution,registration,personSnapshot,referenceAssetId});
  assert.equal(catalogueDecision.nameResolution.kind,'registered');
  const snapshot={spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run-1',subjectId:'subject-1',
    executionBasisDigest:input.runExecutionBasisDigest}};
  const selection=currentSelection.build({snapshot,resolvedIdentityDigest:input.resolvedIdentityDigest,catalogueDecision,referenceAssetId});
  const relation=currentSelection.actorRelation(selection);
  assert.equal(relation.source,'face_catalogue');
  const relations=[relation];
  const fact={schemaRef:'helix://contracts/types/MediaCastFact/v1',sourceBasisKind:'us_adult_actor',relationCount:1,relations,
    relationsDigest:relation.relationDigest||D(relations)};
  // actorRelation returns frozen relation with relationDigest
  const relationsDigest=D({schema:'libra.media-cast-relations@1',relations});
  const castFact={...fact,relationsDigest};
  const value={
    resolvedIdentitySnapshot:{factValue:{contentProfile:'western_adult',identityKind:'internal_identity',structureKind:'single'}},
    mediaCastSnapshot:{mediaCastFactId:'cast-fact',mediaCastFactRevision:1,factDigest:D('cast'),factValue:castFact,relations,
      relationsDigest:castFact.relationsDigest},
    productFactManifest:{items:[{productFactId:'cast-fact',factRevision:1,factDigest:D('cast'),factKind:'media_cast',factValue:castFact}]},
  };
  // Align digests for guard
  value.mediaCastSnapshot.factDigest=D(castFact);
  value.productFactManifest.items[0].factDigest=value.mediaCastSnapshot.factDigest;
  value.productFactManifest.items[0].factValue=castFact;
  assert.equal(assertRequiredUsAdultActor(value),value);
});

test('Host admission port is injectible and leaves waiting_registration until evidence exists',()=>{
  const admission=createUsAdultCatalogueRegistrationAdmission({
    peopleStore:{readUsAdultPersonSnapshot(){return null;}},
    assembleEvidence:()=>({kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_EVIDENCE_PENDING'}),
    register(){throw new Error('not ready');},
  });
  const result=admission.registerCataloguePerson({
    input:{winner:{name:'Example Performer'}},inputDigest:D('input'),resolution:{kind:'not_found'},candidate:{},
  });
  assert.equal(result.kind,'pending');
  assert.equal(result.reasonCode,'us_adult_catalogue_registration_required');
});

test('name-first reuse: fuzzy name hit reuses personId without face as People match key',()=>{
  const {personSnapshot,referenceAssetId,personId}=personFixture('Examble Performer');
  const {input,inputDigest}=decisionInput('Example Performer');
  const resolution=resolveUsAdultName({
    name:input.winner.name,aliases:[],
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:D('person'),
      canonicalName:'Examble Performer',aliases:[]}],
  });
  assert.equal(resolution.kind,'resolved');
  assert.equal(resolution.candidates[0].personId,personId);
  assert.equal(resolution.candidates[0].matchKind,'light_spelling');
  const catalogueDecision=buildCatalogueActorDecision({input,inputDigest,resolution,personSnapshot,referenceAssetId});
  assert.equal(catalogueDecision.nameResolution.kind,'reused');
  assert.equal(catalogueDecision.personSnapshot.personId,personId);
});

test('happy path shelf contract: face_catalogue cast is the actor fact On-deck shelf video+poster consume',()=>{
  // Isolation gate cannot write NAS shelf files. It does prove the product cast On-deck
  // consumes after catalogue recognize → name reuse/create: face_catalogue source and
  // package actor guard. Host formation-host covers mkv+nfo+poster.jpg when models exist.
  const {personSnapshot,referenceAssetId,personId}=personFixture('Mai Thai');
  const {input,inputDigest}=decisionInput('May Thai');
  const resolution=resolveUsAdultName({
    name:input.winner.name,aliases:[],
    people:[{personId,libraryKind:'us_adult',status:'active',personRevision:1,personFactDigest:D('person'),
      canonicalName:'Mai Thai',aliases:[]}],
  });
  assert.equal(resolution.kind,'resolved');
  assert.equal(resolution.candidates[0].matchKind,'light_spelling');
  const catalogueDecision=buildCatalogueActorDecision({input,inputDigest,resolution,personSnapshot,referenceAssetId});
  assert.equal(catalogueDecision.nameResolution.kind,'reused');
  const snapshot={spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run-1',subjectId:'subject-1',
    executionBasisDigest:input.runExecutionBasisDigest}};
  const selection=currentSelection.build({snapshot,resolvedIdentityDigest:input.resolvedIdentityDigest,catalogueDecision,referenceAssetId});
  const relation=currentSelection.actorRelation(selection);
  assert.equal(relation.source,'face_catalogue');
  assert.equal(relation.personId,personId);
  const relations=[relation];
  const castFact={schemaRef:'helix://contracts/types/MediaCastFact/v1',sourceBasisKind:'us_adult_actor',relationCount:1,relations,
    relationsDigest:D({schema:'libra.media-cast-relations@1',relations})};
  const packageValue={
    resolvedIdentitySnapshot:{factValue:{contentProfile:'western_adult',identityKind:'internal_identity',structureKind:'single'}},
    mediaCastSnapshot:{mediaCastFactId:'cast-fact',mediaCastFactRevision:1,factDigest:D(castFact),factValue:castFact,relations,
      relationsDigest:castFact.relationsDigest},
    productFactManifest:{items:[{productFactId:'cast-fact',factRevision:1,factDigest:D(castFact),factKind:'media_cast',factValue:castFact}]},
  };
  assert.equal(assertRequiredUsAdultActor(packageValue),packageValue);
  assert.equal(packageValue.resolvedIdentitySnapshot.factValue.contentProfile,'western_adult');
  assert.equal(packageValue.mediaCastSnapshot.relations[0].source,'face_catalogue');
});
