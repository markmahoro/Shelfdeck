'use strict';
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {createUsAdultCatalogueDecisionInput}=require('../model/us-adult-catalogue-decision-input');
const {buildCatalogueActorDecision}=require('../model/us-adult-catalogue-actor-decision');

function fail(message,code='US_ADULT_CATALOGUE_SETTLEMENT_INVALID'){throw Object.assign(new Error(message),{code});}
function createUsAdultCatalogueSettlementCoordinator(options){
  if(!options?.usAdultCatalogueStore||!options.usAdultCatalogueDecisionStore||!options.movieProductionReader||
    typeof options.usAdultActorChoiceStore?.current!=='function'||!options.workResultReader||
    typeof options.workspaceProductPort?.readArtifactBytes!=='function'||!options.contractValidator||
    typeof options.resolveUsAdultName!=='function'||typeof options.readUsAdultPersonSnapshot!=='function'||
    typeof options.readPersonHead!=='function')
    throw new TypeError('Catalogue settlement requires Libra catalogue stores, People name/snapshot reads and formal Results.');
  const decisionInput=createUsAdultCatalogueDecisionInput(options);
  const buffaloRef=buffaloModelReference('single_reference_face').digest;
  function buffaloAsset(snapshot){
    const own=snapshot.referenceProjection.contributions.find(item=>item.ownerPersonId===snapshot.personId);
    const face=own?.activeFaces.find(item=>item.modelRef===buffaloRef);
    if(!face||!own.activeAssets.some(asset=>asset.referenceAssetId===face.referenceAssetId))return null;
    return face.referenceAssetId;
  }
  return Object.freeze({reconcile(candidate){
    if(!candidate||candidate.kind!=='catalogue_candidate'||!candidate.basis||!candidate.completedBatches)
      fail('Settlement requires an exact qualified catalogue candidate.');
    const existing=options.usAdultCatalogueDecisionStore.getByRun(candidate.libraRunId);
    if(existing)return Object.freeze({kind:'settled',phase:'us_adult_catalogue_decision',libraRunId:candidate.libraRunId,decision:existing});
    if(options.usAdultActorChoiceStore.current(candidate.basis.subjectId))
      return Object.freeze({kind:'manual_choice_present',phase:'us_adult_catalogue_settlement',libraRunId:candidate.libraRunId});
    const compiled=decisionInput.compile({libraRunId:candidate.libraRunId,mode:candidate.completedBatches.mode});
    if(compiled.kind==='manual_choice_present')
      return Object.freeze({kind:'manual_choice_present',phase:'us_adult_catalogue_settlement',libraRunId:candidate.libraRunId});
    if(compiled.kind!=='qualified')
      return Object.freeze({kind:'unresolved',phase:'us_adult_catalogue_settlement',libraRunId:candidate.libraRunId,
        reasonCode:'us_adult_catalogue_unqualified',status:compiled.status||null});
    const resolution=options.resolveUsAdultName({name:compiled.input.winner.name,aliases:compiled.input.winner.aliases,
      expectedLibraryNamesDigest:null});
    if(resolution.kind==='ambiguous')
      return Object.freeze({kind:'unresolved',phase:'us_adult_catalogue_settlement',libraRunId:candidate.libraRunId,
        reasonCode:'us_adult_catalogue_name_ambiguous'});
    if(resolution.kind==='not_found'){
      if(typeof options.registerCataloguePerson!=='function')
        return Object.freeze({kind:'waiting_registration',phase:'us_adult_catalogue_registration',libraRunId:candidate.libraRunId,
          reasonCode:'us_adult_catalogue_registration_required',inputDigest:compiled.inputDigest,
          winnerName:compiled.input.winner.name});
      const registered=options.registerCataloguePerson({input:compiled.input,inputDigest:compiled.inputDigest,resolution,candidate});
      if(registered?.kind&&registered.kind!=='registered')return registered;
      const decision=buildCatalogueActorDecision({input:compiled.input,inputDigest:compiled.inputDigest,resolution,
        registration:registered.registration,personSnapshot:registered.personSnapshot,referenceAssetId:registered.referenceAssetId});
      return Object.freeze({kind:'settled',phase:'us_adult_catalogue_decision',libraRunId:candidate.libraRunId,
        decision:options.usAdultCatalogueDecisionStore.freeze(decision)});
    }
    if(resolution.kind!=='resolved'||resolution.candidates.length!==1)
      fail('People name resolution returned an unexpected non-closed result.');
    const hit=resolution.candidates[0],head=options.readPersonHead(hit.personId);
    if(!head||head.personId!==hit.personId||head.personRevision!==hit.personRevision||head.personFactDigest!==hit.personFactDigest)
      fail('People returned a name hit that no longer matches its public head.','US_ADULT_CATALOGUE_SETTLEMENT_STALE');
    if(!Number.isSafeInteger(head.currentReferenceRevision)||head.currentReferenceRevision<1)
      return Object.freeze({kind:'waiting_registration',phase:'us_adult_catalogue_registration',libraRunId:candidate.libraRunId,
        reasonCode:'us_adult_catalogue_buffalo_reference_required',personId:hit.personId,inputDigest:compiled.inputDigest,
        winnerName:compiled.input.winner.name});
    const personSnapshot=options.readUsAdultPersonSnapshot({personId:hit.personId,expectedPersonRevision:hit.personRevision,
      expectedReferenceRevision:head.currentReferenceRevision});
    const referenceAssetId=buffaloAsset(personSnapshot);
    if(!referenceAssetId)
      return Object.freeze({kind:'waiting_registration',phase:'us_adult_catalogue_registration',libraRunId:candidate.libraRunId,
        reasonCode:'us_adult_catalogue_buffalo_reference_required',personId:hit.personId,inputDigest:compiled.inputDigest,
        winnerName:compiled.input.winner.name});
    const decision=buildCatalogueActorDecision({input:compiled.input,inputDigest:compiled.inputDigest,resolution,
      personSnapshot,referenceAssetId});
    return Object.freeze({kind:'settled',phase:'us_adult_catalogue_decision',libraRunId:candidate.libraRunId,
      decision:options.usAdultCatalogueDecisionStore.freeze(decision)});
  }});
}
module.exports=Object.freeze({createUsAdultCatalogueSettlementCoordinator});
