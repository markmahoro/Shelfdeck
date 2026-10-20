'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertRecord}=require('./us-adult-actor-choice');
const {assertCompletion}=require('./us-adult-match-completion');
const {assertUsAdultAnalysisBasis}=require('./us-adult-analysis-basis');
const SCHEMA='helix://contracts/domain-types/UsAdultActorSelectionBasis/v1';
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_ACTOR_SELECTION_INVALID'});}
function selectedPerson(selection){
  if(selection?.selectionOrigin==='user_choice')return selection.actorChoiceRecord?.personSnapshot;
  if(selection?.selectionOrigin==='automatic_match')return selection.matchCompletion?.winner?.personSnapshot;
  fail('Actor selection requires an explicit user choice or completed automatic match.');
}
function selectedAsset(selection){
  const person=selectedPerson(selection),contribution=person?.referenceProjection.contributions.find(item=>item.ownerPersonId===person.personId);
  const asset=contribution?.activeAssets.find(item=>item.referenceAssetId===selection.referenceAssetId);
  if(!asset||!contribution.activeFaces.some(item=>item.referenceAssetId===asset.referenceAssetId))fail('The actor selection has no frozen usable reference image.');
  return asset;
}
function selectionId(value){
  return canonicalDigest({schema:'libra.us-adult-actor-selection-id@1',libraRunId:value.libraRunId,analysisBasisDigest:value.analysisBasisDigest,
    originDigest:value.selectionOrigin==='user_choice'?value.actorChoiceRecord.recordDigest:value.matchCompletion.completionDigest,
    referenceAssetId:value.referenceAssetId});
}
function assertActorSelection(selection){
  if(!selection||selection.schemaRef!==SCHEMA||selection.schemaVersion!==1||
    !['user_choice','automatic_match'].includes(selection.selectionOrigin))fail('Actor selection does not use its exact versioned contract.');
  if(selection.selectionOrigin==='user_choice'){
    if(selection.matchCompletion!==null||!selection.actorChoiceRecord)fail('A user selection must carry only its explicit Owner Intent.');
    assertRecord(selection.actorChoiceRecord);
    if(selection.actorChoiceRecord.subjectId!==selection.subjectId)fail('Actor choice belongs to another Subject.');
  }else{
    if(selection.actorChoiceRecord!==null||!selection.matchCompletion?.winner)fail('Automatic actor selection requires a complete nonempty match.');
    const completion=assertCompletion(selection.matchCompletion);
    if(completion.analysisId!==selection.analysisId||completion.analysisBasisDigest!==selection.analysisBasisDigest||
      completion.libraRunId!==selection.libraRunId||completion.subjectId!==selection.subjectId||
      completion.winner.personMatchEvidence.matches[0].referenceAssetId!==selection.referenceAssetId)fail('Automatic selection crossed its complete analysis result.');
  }
  const person=selectedPerson(selection),{snapshotDigest,...snapshot}=person||{},
    {selectionDigest,...value}=selection;
  if(person?.libraryKind!=='us_adult'||canonicalDigest(snapshot)!==snapshotDigest||selection.selectionId!==selectionId(selection)||
    canonicalDigest(value)!==selectionDigest||Buffer.byteLength(canonicalJson(selection),'utf8')>1024*1024)
    fail('Actor selection Person, identity or digest changed.');
  selectedAsset(selection);return selection;
}
function buildActorSelection({snapshot,analysisBasis,resolvedIdentityDigest,actorChoiceRecord=null,matchCompletion=null}){
  assertUsAdultAnalysisBasis(analysisBasis);
  if(snapshot.spec.contentProfile!=='western_adult'||analysisBasis.libraRunId!==snapshot.run.libraRunId||analysisBasis.subjectId!==snapshot.run.subjectId||
    analysisBasis.runExecutionBasisDigest!==snapshot.run.executionBasisDigest||analysisBasis.resolvedIdentityDigest!==resolvedIdentityDigest)
    fail('Actor selection requires its exact Run, analysis and formal identity.');
  if(!actorChoiceRecord&&!matchCompletion?.winner)return null;
  const selectionOrigin=actorChoiceRecord?'user_choice':'automatic_match',person=actorChoiceRecord?.personSnapshot||matchCompletion.winner.personSnapshot,
    contribution=person.referenceProjection.contributions.find(item=>item.ownerPersonId===person.personId),
    assets=contribution?.activeAssets.filter(asset=>contribution.activeFaces.some(face=>face.referenceAssetId===asset.referenceAssetId&&
      face.modelRef===analysisBasis.referenceModelRefDigest)).sort((a,b)=>Buffer.compare(Buffer.from(a.referenceAssetId),Buffer.from(b.referenceAssetId)))||[],
    referenceAssetId=actorChoiceRecord?assets[0]?.referenceAssetId:matchCompletion.winner.personMatchEvidence.matches[0].referenceAssetId;
  if(!referenceAssetId||!assets.some(item=>item.referenceAssetId===referenceAssetId))fail('The selected actor has no reference image for the frozen model.');
  const value={schemaRef:SCHEMA,schemaVersion:1,selectionId:'',libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,
    runExecutionBasisDigest:snapshot.run.executionBasisDigest,resolvedIdentityDigest,analysisId:analysisBasis.analysisId,analysisBasisDigest:analysisBasis.basisDigest,
    selectionOrigin,actorChoiceRecord,matchCompletion:actorChoiceRecord?null:matchCompletion,referenceAssetId};
  value.selectionId=selectionId(value);
  return Object.freeze(assertActorSelection({...value,selectionDigest:canonicalDigest(value)}));
}
function actorRelation(selection){
  assertActorSelection(selection);const person=selectedPerson(selection),match=selection.matchCompletion?.winner.personMatchEvidence.matches[0];
  return Object.freeze({relationId:canonicalDigest({schema:'libra.us-adult-single-actor-relation@1',subjectId:selection.subjectId,
    personId:person.personId,selectionDigest:selection.selectionDigest}),personId:person.personId,displayName:person.canonicalName,
    displayNameNormalized:person.canonicalName.normalize('NFKC').trim().toLowerCase(),role:'actor',
    source:selection.selectionOrigin==='user_choice'?'user_actor_choice':'face_reference_match',providerIdentities:Object.freeze([]),
    originEvidenceDigest:match?match.evidenceDigest:selection.actorChoiceRecord.recordDigest,confidenceClass:match?match.confidenceClass:'user_confirmed'});
}
module.exports=Object.freeze({SCHEMA,buildActorSelection,assertActorSelection,selectedPerson,selectedAsset,actorRelation});
