'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest:D } = require('../../src/helix/contracts/canonical-json');
const { CAPABILITY, HANDLE, resultRef } = require('../../src/helix/contracts/us-adult-catalogue-work-types');
const { buffaloModelReference } = require('../../src/helix/contracts/buffalo-model-reference');
const { resolveUsAdultName } = require('../../src/helix/domains/people/model/us-adult-name-resolution');
const { buildCatalogueActorDecision, assertCatalogueActorDecision } = require('../../src/helix/domains/libra/model/us-adult-catalogue-actor-decision');
const { buildRecord } = require('../../src/helix/domains/libra/model/us-adult-actor-choice');
const currentSelection = require('../../src/helix/domains/libra/model/us-adult-actor-selection-current');

function fixture() {
  const projectionValue = { projectionContract:'people.person-reference-projection@1',personId:'person-1',personRevision:1,
    currentReferenceRevision:1,contributions:[{ownerPersonId:'person-1',ownerReferenceRevision:1,referenceSetDigest:D('set'),inheritedReadOnly:false,
      activeAssets:[{referenceAssetId:'asset-1',artifactHandleId:'picture',artifactDigest:D('picture')}],
      activeFaces:[{referenceFaceId:'face-1',referenceAssetId:'asset-1',embeddingHandleId:'embedding',embeddingDigest:D('embedding'),
        modelRef:buffaloModelReference('single_reference_face').digest}]}]};
  const projection = {...projectionValue,projectionRevision:1,projectionDigest:D(projectionValue)};
  const personValue = {schemaRef:'helix://contracts/domain-types/UsAdultPersonSnapshot/v1',schemaVersion:1,libraryKind:'us_adult',
    personId:'person-1',personRevision:1,canonicalName:'Example Performer',aliases:[],personFactDigest:D('person'),referenceProjection:projection};
  const personSnapshot = {...personValue,snapshotDigest:D(personValue)};
  const handleValue = {schemaRef:HANDLE,schemaVersion:1,analysisId:D('analysis'),libraRunId:'run-1',workspaceId:'workspace-1',
    runExecutionBasisDigest:D('execution'),basisDigest:D('basis'),mode:'initial',completedBatchSetDigest:D('batches'),
    observationSourceSetDigest:D('sources'),modelRefDigest:D('model'),catalogueGenerationDigest:D('generation'),searchPolicyDigest:D('search'),
    clusterParameterDigest:D('clusters'),resultKind:'observed',frameCount:20,faceCount:3,groupCount:1,queryCount:3,
    observationDigest:D('observation-body'),observationArtifactHandle:{artifactKind:'face_catalogue_observation',ownerDomain:'libra',
      ownerScope:{scopeType:'libra_run',scopeId:'run-1'},digestAlgorithm:'sha256',digestHex:D('observation'),sizeBytes:100},outputTargetDigest:D('target')};
  const observationHandle = {...handleValue,handleDigest:D(handleValue)};
  const winner = {identityKey:'catalogue-person-1',uid:'entry-1',name:'Example Performer',aliases:[],groupIds:['group-a','group-b'],
    coverageStrata:[0,1,2,3,4],supportingRepresentativeStrata:[0,1,2,3,4]};
  const input = {schema:'libra.us-adult-catalogue-decision-input@1',libraRunId:'run-1',subjectId:'subject-1',
    runExecutionBasisDigest:D('execution'),resolvedIdentityDigest:D('identity'),catalogueBasisDigest:D('basis'),
    observationResultRef:{workId:'work',attemptId:'attempt',planId:'plan',eventId:'event',resultId:'result',capabilityRef:CAPABILITY,
      resultSchemaRef:resultRef(CAPABILITY),resultDigest:D(observationHandle),inputBindingDigest:D('input')},observationHandle,
    assessmentPolicyDigest:D('policy'),assessmentDigest:D('assessment'),representativeImagePolicyDigest:D('representative-policy'),winner,expectedChoiceHead:null};
  const inputDigest = D(input), people = [{personId:personSnapshot.personId,libraryKind:'us_adult',status:'active',personRevision:1,
    personFactDigest:personSnapshot.personFactDigest,canonicalName:personSnapshot.canonicalName,aliases:[]}];
  const resolution = resolveUsAdultName({name:winner.name,aliases:winner.aliases,people});
  return {input,inputDigest,personSnapshot,resolution,referenceAssetId:'asset-1'};
}
test('a qualified Observation and uniquely matched People snapshot produce a distinct directory actor decision', () => {
  const f = fixture(), decision = buildCatalogueActorDecision(f);
  assert.equal(decision.nameResolution.kind, 'reused');
  assert.equal(decision.winner.supportingRepresentativeStrata.length, 5);
  assert.equal(decision.referenceModelRefDigest, buffaloModelReference('single_reference_face').digest);
  assert.deepEqual(buildCatalogueActorDecision(f), decision);
  assert.equal(assertCatalogueActorDecision(decision), decision);
  assert.equal(Object.isFrozen(decision.personSnapshot), true);
});
test('a no-match resolution requires a system registration tied to this exact input and name result', () => {
  const f = fixture(), resolution = resolveUsAdultName({name:f.input.winner.name,aliases:[],people:[]});
  assert.throws(() => buildCatalogueActorDecision({...f,resolution}), {code:'US_ADULT_CATALOGUE_ACTOR_DECISION_INVALID'});
  const registration = {decisionId:D('registration'),decisionDigest:D('registration-value'),personId:f.personSnapshot.personId,
    catalogueDecisionInputDigest:f.inputDigest,nameResolutionDigest:resolution.resolutionDigest};
  const decision = buildCatalogueActorDecision({...f,resolution,registration});
  assert.equal(decision.nameResolution.kind, 'registered');
  assert.equal(decision.nameResolution.registrationDecisionId, registration.decisionId);
  assert.throws(() => buildCatalogueActorDecision({...f,resolution,registration:{...registration,catalogueDecisionInputDigest:D('wrong')}}),
    {code:'US_ADULT_CATALOGUE_ACTOR_DECISION_INVALID'});
});
test('ambiguous People, substituted actor, stale model and modified decision are rejected', () => {
  const f = fixture(), other = {personId:'person-2',libraryKind:'us_adult',status:'active',personRevision:1,
    personFactDigest:D('other'),canonicalName:'Example Performer',aliases:[]};
  const ambiguous = resolveUsAdultName({name:f.input.winner.name,people:[other,{...other,personId:'person-1'}]});
  assert.throws(() => buildCatalogueActorDecision({...f,resolution:ambiguous}), {code:'US_ADULT_CATALOGUE_ACTOR_DECISION_INVALID'});
  assert.throws(() => buildCatalogueActorDecision({...f,referenceAssetId:'unknown'}), {code:'US_ADULT_CATALOGUE_ACTOR_DECISION_INVALID'});
  const decision = buildCatalogueActorDecision(f);
  assert.throws(() => assertCatalogueActorDecision({...decision,referenceModelRefDigest:D('legacy-128')}), {code:'US_ADULT_CATALOGUE_ACTOR_DECISION_INVALID'});
  assert.throws(() => assertCatalogueActorDecision({...decision,subjectId:'different'}), {code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});
});
test('a changed Result or malformed temporal evidence is not reinterpreted as a valid choice', () => {
  const f = fixture();
  assert.throws(() => buildCatalogueActorDecision({...f,input:{...f.input,expectedChoiceHead:'manual'}}), {code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});
  const input = {...f.input,observationResultRef:{...f.input.observationResultRef,resultDigest:D('different')}};
  assert.throws(() => buildCatalogueActorDecision({...f,input,inputDigest:D(input)}), {code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});
  const duplicate = {...f.input,winner:{...f.input.winner,supportingRepresentativeStrata:[0,0]}};
  assert.throws(() => buildCatalogueActorDecision({...f,input:duplicate,inputDigest:D(duplicate)}), {code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});
});
test('manual selection works without a catalogue decision and retains the exact chosen Person', () => {
  const f=fixture(),snapshot={spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run-1',subjectId:'subject-1',
    stateRevision:1,executionBasisDigest:f.input.runExecutionBasisDigest}};
  const actorChoiceRecord=buildRecord({snapshot,personSnapshot:f.personSnapshot,actorId:'admin',body:{personId:'person-1',
    expectedPersonRevision:1,expectedReferenceRevision:1,expectedChoiceRevision:0,expectedRunStateRevision:1,idempotencyKey:'manual-choice'}});
  const selection=currentSelection.build({snapshot,resolvedIdentityDigest:f.input.resolvedIdentityDigest,actorChoiceRecord,
    personSnapshot:f.personSnapshot,referenceAssetId:'asset-1'});
  assert.equal(selection.catalogueDecision,null);
  assert.equal(currentSelection.actorRelation(selection).source,'user_actor_choice');
  assert.equal(currentSelection.actorRelation(selection).originEvidenceDigest,actorChoiceRecord.recordDigest);
  assert.throws(()=>currentSelection.build({snapshot,resolvedIdentityDigest:f.input.resolvedIdentityDigest,actorChoiceRecord,
    personSnapshot:{...f.personSnapshot,personId:'other'},referenceAssetId:'asset-1'}),{code:'US_ADULT_CURRENT_ACTOR_SELECTION_INVALID'});
});
test('automatic selection uses the directory decision as its exact retained source and never claims a user match', () => {
  const f=fixture(),snapshot={spec:{contentProfile:'western_adult'},run:{state:'active',libraRunId:'run-1',subjectId:'subject-1',
    executionBasisDigest:f.input.runExecutionBasisDigest}},catalogueDecision=buildCatalogueActorDecision(f);
  const selection=currentSelection.build({snapshot,resolvedIdentityDigest:f.input.resolvedIdentityDigest,catalogueDecision,referenceAssetId:'asset-1'});
  assert.equal(selection.selectionId,catalogueDecision.decisionId);
  assert.equal(currentSelection.actorRelation(selection).source,'face_catalogue');
  assert.equal(currentSelection.actorRelation(selection).originEvidenceDigest,catalogueDecision.decisionDigest);
  assert.throws(()=>currentSelection.build({snapshot:{...snapshot,run:{...snapshot.run,state:'discarded'}},
    resolvedIdentityDigest:f.input.resolvedIdentityDigest,catalogueDecision,referenceAssetId:'asset-1'}),
    {code:'US_ADULT_CURRENT_ACTOR_SELECTION_INVALID'});
});
