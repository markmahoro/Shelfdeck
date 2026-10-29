'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {assertRecord}=require('./us-adult-actor-choice');
const {assertCatalogueActorDecision,assertPerson}=require('./us-adult-catalogue-actor-decision');

const SCHEMA='helix://contracts/domain-types/UsAdultActorSelectionCurrent/v1';
const KEYS=['schemaRef','schemaVersion','selectionId','libraRunId','subjectId','runExecutionBasisDigest','resolvedIdentityDigest',
  'selectionOrigin','actorChoiceRecord','personSnapshot','catalogueDecision','referenceAssetId','referenceModelRefDigest','selectionDigest'];
const HASH=/^[a-f0-9]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),id=()=>({type:'string',minLength:1,maxLength:256}),
  ref=name=>({$ref:'helix://contracts/domain-types/'+name+'/v1'}),nullable=value=>({anyOf:[value,{type:'null'}]});
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_CURRENT_ACTOR_SELECTION_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function schema(){
  const properties={schemaRef:{const:SCHEMA},schemaVersion:{const:1},selectionId:digest(),libraRunId:id(),subjectId:id(),
    runExecutionBasisDigest:digest(),resolvedIdentityDigest:digest(),selectionOrigin:{enum:['user_choice','automatic_catalogue']},
    actorChoiceRecord:nullable(ref('UsAdultActorChoiceRecord')),personSnapshot:nullable(ref('UsAdultPersonSnapshot')),
    catalogueDecision:nullable(ref('UsAdultCatalogueActorDecision')),referenceAssetId:id(),referenceModelRefDigest:digest(),selectionDigest:digest()};
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'UsAdultActorSelectionCurrent@1',
    'x-helix-ssotRefs':['6.4.7.1','8.6.18','8.6.20'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':512*1024,
    type:'object',additionalProperties:false,properties,required:Object.keys(properties),allOf:[
      {if:{properties:{selectionOrigin:{const:'user_choice'}}},then:{properties:{actorChoiceRecord:ref('UsAdultActorChoiceRecord'),
        personSnapshot:ref('UsAdultPersonSnapshot'),catalogueDecision:{type:'null'}}},else:{properties:{actorChoiceRecord:{type:'null'},
        personSnapshot:{type:'null'},catalogueDecision:ref('UsAdultCatalogueActorDecision')}}}]};
}
function personOf(selection){
  if(selection?.selectionOrigin==='user_choice')return selection.personSnapshot;
  if(selection?.selectionOrigin==='automatic_catalogue')return selection.catalogueDecision?.personSnapshot;
  fail('A current actor selection must identify its explicit user or directory source.');
}
function selectionId(value){
  if(value.selectionOrigin==='automatic_catalogue')return value.catalogueDecision.decisionId;
  return canonicalDigest({schema:'libra.us-adult-actor-selection-current-id@1',libraRunId:value.libraRunId,
    resolvedIdentityDigest:value.resolvedIdentityDigest,choiceRecordDigest:value.actorChoiceRecord.recordDigest,
    personSnapshotDigest:value.personSnapshot.snapshotDigest,referenceAssetId:value.referenceAssetId,referenceModelRefDigest:value.referenceModelRefDigest});
}
function assertCurrentActorSelection(value){
  if(!exact(value,KEYS)||value.schemaRef!==SCHEMA||value.schemaVersion!==1||!['user_choice','automatic_catalogue'].includes(value.selectionOrigin)||
      !text(value.libraRunId)||!text(value.subjectId)||!text(value.referenceAssetId)||
      !['selectionId','runExecutionBasisDigest','resolvedIdentityDigest','referenceModelRefDigest','selectionDigest'].every(key=>HASH.test(value[key]||'')))
    fail('The current actor selection does not use its complete closed contract.');
  if(value.selectionOrigin==='user_choice'){
    if(value.catalogueDecision!==null||!value.actorChoiceRecord||!value.personSnapshot)fail('Manual selection requires its Choice and current People snapshot only.');
    const choice=assertRecord(value.actorChoiceRecord);
    if(choice.subjectId!==value.subjectId||choice.personSnapshot.personId!==value.personSnapshot.personId)
      fail('The current People snapshot does not match the user\'s selected Person.');
  }else{
    if(value.actorChoiceRecord!==null||value.personSnapshot!==null||!value.catalogueDecision)fail('Automatic selection requires only its directory decision.');
    const decision=assertCatalogueActorDecision(value.catalogueDecision);
    if(decision.libraRunId!==value.libraRunId||decision.subjectId!==value.subjectId||decision.runExecutionBasisDigest!==value.runExecutionBasisDigest||
      decision.resolvedIdentityDigest!==value.resolvedIdentityDigest||decision.referenceAssetId!==value.referenceAssetId||
      decision.referenceModelRefDigest!==value.referenceModelRefDigest)fail('The directory decision belongs to another Run, Person or reference.');
  }
  assertPerson(personOf(value),value.referenceAssetId,value.referenceModelRefDigest);
  const {selectionDigest,...body}=value;
  if(selectionId(value)!==value.selectionId||canonicalDigest(body)!==selectionDigest||Buffer.byteLength(canonicalJson(value))>512*1024)
    fail('The selected actor identity or complete snapshot changed.');
  return value;
}
function build({snapshot,resolvedIdentityDigest,actorChoiceRecord=null,personSnapshot=null,catalogueDecision=null,referenceAssetId}){
  if(snapshot?.spec?.contentProfile!=='western_adult'||snapshot?.run?.state!=='active'||
    !text(snapshot.run.libraRunId)||!text(snapshot.run.subjectId)||!HASH.test(snapshot.run.executionBasisDigest||'')||
    !HASH.test(resolvedIdentityDigest||'')||Boolean(actorChoiceRecord)===Boolean(catalogueDecision))
    fail('The current US Run requires exactly one user Choice or directory decision.');
  const selectionOrigin=actorChoiceRecord?'user_choice':'automatic_catalogue',referenceModelRefDigest=buffaloModelReference('single_reference_face').digest;
  const value={schemaRef:SCHEMA,schemaVersion:1,selectionId:'',libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,
    runExecutionBasisDigest:snapshot.run.executionBasisDigest,resolvedIdentityDigest,selectionOrigin,actorChoiceRecord,
    personSnapshot:actorChoiceRecord?personSnapshot:null,catalogueDecision:catalogueDecision||null,referenceAssetId,referenceModelRefDigest};
  value.selectionId=selectionId(value);
  return freeze(assertCurrentActorSelection(JSON.parse(canonicalJson({...value,selectionDigest:canonicalDigest(value)}))));
}
function actorRelation(value){
  assertCurrentActorSelection(value);const person=personOf(value),automatic=value.selectionOrigin==='automatic_catalogue';
  return Object.freeze({relationId:canonicalDigest({schema:'libra.us-adult-single-actor-relation@1',subjectId:value.subjectId,
    personId:person.personId,selectionDigest:value.selectionDigest}),personId:person.personId,displayName:person.canonicalName,
    displayNameNormalized:person.canonicalName.normalize('NFKC').trim().toLowerCase(),role:'actor',
    source:automatic?'face_catalogue':'user_actor_choice',providerIdentities:Object.freeze([]),
    originEvidenceDigest:automatic?value.catalogueDecision.decisionDigest:value.actorChoiceRecord.recordDigest,
    confidenceClass:automatic?'catalogue_qualified':'user_confirmed'});
}
module.exports=Object.freeze({SCHEMA,schema,build,assertCurrentActorSelection,personOf,actorRelation});
