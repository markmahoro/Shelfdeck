'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buffaloModelReference } = require('../../../contracts/buffalo-model-reference');
const { CAPABILITY, resultRef } = require('../../../contracts/us-adult-catalogue-work-types');
const { POLICY, queryNames } = require('../../../contracts/us-adult-name-query');
const { assertCatalogueDecisionInput:assertRequest } = require('../../../contracts/us-adult-catalogue-decision-input');

const SCHEMA = 'helix://contracts/domain-types/UsAdultCatalogueActorDecision/v1';
const HASH = /^[a-f0-9]{64}$/;
const DECISION_KEYS = ['schemaRef','schemaVersion','decisionId','libraRunId','subjectId','runExecutionBasisDigest',
  'resolvedIdentityDigest','catalogueAnalysisId','catalogueBasisDigest','catalogueDecisionInputDigest','observationResultRef',
  'observationHandle','assessmentPolicyDigest','assessmentDigest','representativeImagePolicyDigest','winner','nameResolution','personSnapshot','referenceAssetId',
  'referenceModelRefDigest','expectedChoiceHead','decisionDigest'];
const NAME_KEYS = ['kind','policyRef','nameQueryDigest','libraryNamesDigest','resolutionDigest','registrationDecisionId','registrationDecisionDigest'];
const idSchema = () => ({type:'string',minLength:1,maxLength:256});
const digestSchema = () => ({type:'string',pattern:'^[a-f0-9]{64}$'});
const objectSchema = properties => ({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
function schema() {
  const ref = name => ({$ref:'helix://contracts/domain-types/'+name+'/v1'});
  const result = objectSchema({workId:idSchema(),attemptId:idSchema(),planId:idSchema(),eventId:idSchema(),resultId:idSchema(),
    capabilityRef:{const:CAPABILITY},resultSchemaRef:{const:resultRef(CAPABILITY)},resultDigest:digestSchema(),inputBindingDigest:digestSchema()});
  const strata = minimum => ({type:'array',minItems:minimum,maxItems:20,uniqueItems:true,items:{type:'integer',minimum:0,maximum:19}});
  const winner = objectSchema({identityKey:idSchema(),uid:idSchema(),name:{type:'string',minLength:1,maxLength:200},
    aliases:{type:'array',maxItems:16,uniqueItems:true,items:{type:'string',minLength:1,maxLength:200}},
    groupIds:{type:'array',minItems:1,maxItems:1280,uniqueItems:true,items:idSchema()},coverageStrata:strata(3),supportingRepresentativeStrata:strata(2)});
  const nameResolution = objectSchema({kind:{enum:['reused','registered']},policyRef:{const:POLICY},nameQueryDigest:digestSchema(),
    libraryNamesDigest:digestSchema(),resolutionDigest:digestSchema(),registrationDecisionId:nullable(digestSchema()),registrationDecisionDigest:nullable(digestSchema())});
  nameResolution.allOf=[{if:{properties:{kind:{const:'reused'}}},then:{properties:{registrationDecisionId:{type:'null'},registrationDecisionDigest:{type:'null'}}},
    else:{properties:{registrationDecisionId:digestSchema(),registrationDecisionDigest:digestSchema()}}}];
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'UsAdultCatalogueActorDecision@1',
    'x-helix-ssotRefs':['6.4.7.1','8.6.18','8.6.20'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':256*1024,
    ...objectSchema({schemaRef:{const:SCHEMA},schemaVersion:{const:1},decisionId:digestSchema(),libraRunId:idSchema(),subjectId:idSchema(),
      runExecutionBasisDigest:digestSchema(),resolvedIdentityDigest:digestSchema(),catalogueAnalysisId:digestSchema(),catalogueBasisDigest:digestSchema(),
      catalogueDecisionInputDigest:digestSchema(),observationResultRef:result,observationHandle:{$ref:'helix://contracts/types/FaceCatalogueObservationHandle/v1'},
      assessmentPolicyDigest:digestSchema(),assessmentDigest:digestSchema(),representativeImagePolicyDigest:digestSchema(),winner,nameResolution,personSnapshot:ref('UsAdultPersonSnapshot'),
      referenceAssetId:idSchema(),referenceModelRefDigest:digestSchema(),expectedChoiceHead:{type:'null'},decisionDigest:digestSchema()})};
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = value => typeof value === 'string' && HASH.test(value);
function fail(message) { throw Object.assign(new TypeError(message), { code: 'US_ADULT_CATALOGUE_ACTOR_DECISION_INVALID' }); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function assertPerson(person, referenceAssetId, referenceModelRefDigest) {
  const { snapshotDigest, ...snapshot } = person || {}, projection = person?.referenceProjection;
  if (person?.schemaRef !== 'helix://contracts/domain-types/UsAdultPersonSnapshot/v1' || person.schemaVersion !== 1 ||
      person.libraryKind !== 'us_adult' || !text(person.personId) || !Number.isSafeInteger(person.personRevision) || person.personRevision < 1 ||
      !hash(person.personFactDigest) || !hash(snapshotDigest) || canonicalDigest(snapshot) !== snapshotDigest ||
      projection?.personId !== person.personId || projection.personRevision !== person.personRevision ||
      !Array.isArray(projection.contributions) || !hash(projection.projectionDigest) || !text(referenceAssetId) || !hash(referenceModelRefDigest))
    fail('The selected People identity or projection differs from its frozen snapshot.');
  const { projectionRevision, projectionDigest, ...projectionValue } = projection;
  if (!Number.isSafeInteger(projectionRevision) || projectionRevision < 1 || canonicalDigest(projectionValue) !== projectionDigest)
    fail('The frozen People projection is incomplete or corrupt.');
  const own = projection.contributions.filter(item => item.ownerPersonId === person.personId);
  if (own.length !== 1 || !Array.isArray(own[0].activeAssets) || !Array.isArray(own[0].activeFaces) ||
      !own[0].activeAssets.some(asset => asset.referenceAssetId === referenceAssetId) ||
      !own[0].activeFaces.some(face => face.referenceAssetId === referenceAssetId && face.modelRef === referenceModelRefDigest))
    fail('The actor has no matching active reference image and feature in its own People projection.');
  return person;
}
function idOf(value) {
  return canonicalDigest({ schema:'libra.us-adult-catalogue-decision-id@1', libraRunId:value.libraRunId,
    catalogueBasisDigest:value.catalogueBasisDigest, observationResultDigest:value.observationResultRef.resultDigest,
    assessmentDigest:value.assessmentDigest, resolutionDigest:value.nameResolution.resolutionDigest,
    personSnapshotDigest:value.personSnapshot.snapshotDigest, referenceAssetId:value.referenceAssetId,
    referenceModelRefDigest:value.referenceModelRefDigest });
}
function assertCatalogueActorDecision(value) {
  if (!exact(value, DECISION_KEYS) || value.schemaRef !== SCHEMA || value.schemaVersion !== 1 || value.expectedChoiceHead !== null ||
      !hash(value.decisionId) || !hash(value.decisionDigest) || !hash(value.catalogueAnalysisId) ||
      !exact(value.nameResolution, NAME_KEYS) || !['reused','registered'].includes(value.nameResolution.kind) ||
      value.nameResolution.policyRef !== POLICY || !['nameQueryDigest','libraryNamesDigest','resolutionDigest'].every(key => hash(value.nameResolution[key])) ||
      (value.nameResolution.kind === 'reused' && (value.nameResolution.registrationDecisionId !== null || value.nameResolution.registrationDecisionDigest !== null)) ||
      (value.nameResolution.kind === 'registered' && (!hash(value.nameResolution.registrationDecisionId) || !hash(value.nameResolution.registrationDecisionDigest))))
    fail('The directory decision is not an exact typed system decision.');
  const input = { schema:'libra.us-adult-catalogue-decision-input@1',libraRunId:value.libraRunId,subjectId:value.subjectId,
    runExecutionBasisDigest:value.runExecutionBasisDigest,resolvedIdentityDigest:value.resolvedIdentityDigest,catalogueBasisDigest:value.catalogueBasisDigest,
    observationResultRef:value.observationResultRef,observationHandle:value.observationHandle,assessmentPolicyDigest:value.assessmentPolicyDigest,
    assessmentDigest:value.assessmentDigest,representativeImagePolicyDigest:value.representativeImagePolicyDigest,winner:value.winner,expectedChoiceHead:null };
  assertRequest(input, value.catalogueDecisionInputDigest);
  if (value.catalogueAnalysisId !== value.observationHandle.analysisId ||
      value.nameResolution.nameQueryDigest !== canonicalDigest({ policyRef:POLICY, names:queryNames(value.winner.name,value.winner.aliases) }))
    fail('The selected name query or analysis does not belong to the observed identity.');
  assertPerson(value.personSnapshot, value.referenceAssetId, value.referenceModelRefDigest);
  const { decisionDigest, ...body } = value;
  if (idOf(value) !== value.decisionId || canonicalDigest(body) !== decisionDigest || Buffer.byteLength(canonicalJson(value)) > 256 * 1024)
    fail('The directory actor decision identity, digest or size changed.');
  return value;
}
function buildCatalogueActorDecision({ input, inputDigest, resolution, registration = null, personSnapshot, referenceAssetId }) {
  assertRequest(input, inputDigest);
  if (!resolution || resolution.schema !== 'people.us-adult-name-resolution@1' || resolution.policyRef !== POLICY ||
      !['resolved','not_found'].includes(resolution.kind) || !Array.isArray(resolution.candidates) ||
      resolution.kind === 'resolved' && resolution.candidates.length !== 1 || resolution.kind === 'not_found' && resolution.candidates.length !== 0)
    fail('People must return a complete, unambiguous name resolution.');
  const { resolutionDigest, ...resolutionBody } = resolution;
  if (!hash(resolutionDigest) || canonicalDigest(resolutionBody) !== resolutionDigest ||
      resolution.nameQueryDigest !== canonicalDigest({policyRef:POLICY,names:queryNames(input.winner.name,input.winner.aliases)}))
    fail('The complete People name resolution differs from this directory identity.');
  if (resolution.kind === 'resolved') {
    const selected = resolution.candidates[0];
    if (registration !== null || selected.personId !== personSnapshot?.personId || selected.personRevision !== personSnapshot?.personRevision ||
        selected.personFactDigest !== personSnapshot?.personFactDigest)
      fail('A reused actor must match the unique current People result.');
  } else if (!exact(registration, ['decisionId','decisionDigest','personId','catalogueDecisionInputDigest','nameResolutionDigest']) ||
      !hash(registration.decisionId) || !hash(registration.decisionDigest) || registration.personId !== personSnapshot?.personId ||
      registration.catalogueDecisionInputDigest !== inputDigest || registration.nameResolutionDigest !== resolutionDigest)
    fail('A new actor requires its exact People system registration result.');
  const nameResolution = {kind:resolution.kind === 'resolved' ? 'reused' : 'registered',policyRef:POLICY,
    nameQueryDigest:resolution.nameQueryDigest,libraryNamesDigest:resolution.libraryNamesDigest,resolutionDigest,
    registrationDecisionId:registration?.decisionId || null,registrationDecisionDigest:registration?.decisionDigest || null};
  const value = {schemaRef:SCHEMA,schemaVersion:1,decisionId:'',libraRunId:input.libraRunId,subjectId:input.subjectId,
    runExecutionBasisDigest:input.runExecutionBasisDigest,resolvedIdentityDigest:input.resolvedIdentityDigest,
    catalogueAnalysisId:input.observationHandle.analysisId,catalogueBasisDigest:input.catalogueBasisDigest,
    catalogueDecisionInputDigest:inputDigest,observationResultRef:input.observationResultRef,observationHandle:input.observationHandle,
    assessmentPolicyDigest:input.assessmentPolicyDigest,assessmentDigest:input.assessmentDigest,representativeImagePolicyDigest:input.representativeImagePolicyDigest,winner:input.winner,nameResolution,
    personSnapshot,referenceAssetId,referenceModelRefDigest:buffaloModelReference('single_reference_face').digest,expectedChoiceHead:null};
  value.decisionId = idOf(value);
  return freeze(assertCatalogueActorDecision(JSON.parse(canonicalJson({...value,decisionDigest:canonicalDigest(value)}))));
}
module.exports = Object.freeze({SCHEMA,schema,assertCatalogueActorDecision,buildCatalogueActorDecision,assertPerson});
