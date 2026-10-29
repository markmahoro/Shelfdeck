'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {CAPABILITY}=require('../../../contracts/us-adult-catalogue-work-types');
const {catalogueObservationWork}=require('./us-adult-catalogue-observation-work');
const {readCompletedCatalogueBatches,exactCatalogueResult}=require('./us-adult-catalogue-work-results');
const {readCatalogueObservationResult}=require('./us-adult-catalogue-observation-result');
const RESULT_FIELDS=['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'];
function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function compare(a,b){return Buffer.compare(Buffer.from(a),Buffer.from(b));}

// This is Libra's frozen pre-People request. It cannot create a Person or Cast;
// a later commit must re-read Owner state under an opaque read fence.
function createUsAdultCatalogueDecisionInput(options){
  if(!options?.movieProductionReader||typeof options.movieProductionReader.readFact!=='function'||
    typeof options.movieProductionReader.readRunSnapshot!=='function'||typeof options.movieProductionReader.readWorkspace!=='function'||
    !options.usAdultCatalogueStore||typeof options.usAdultActorChoiceStore?.current!=='function'||!options.workResultReader||
    typeof options.workspaceProductPort?.readArtifactBytes!=='function'||!options.contractValidator)
    throw new TypeError('Catalogue decision input requires the current Libra Owner facts and exact successful Results.');
  function scope(libraRunId){
    const snapshot=options.movieProductionReader.readRunSnapshot(libraRunId),identity=options.movieProductionReader.readFact(libraRunId,'resolved_identity',1),
      historical=options.usAdultCatalogueStore.getByRun(libraRunId);
    if(!snapshot||snapshot.run.state!=='active'||snapshot.spec.contentProfile!=='western_adult'||!identity||!historical)
      fail('A current active US Adult Run, identity and catalogue Basis are required.');
    const basis=options.usAdultCatalogueStore.readForExecution({libraRunId,expectedBasisDigest:historical.basisDigest}),
      workspace=options.movieProductionReader.readWorkspace(basis.workspaceId);
    if(snapshot.run.libraRunId!==basis.libraRunId||snapshot.run.subjectId!==basis.subjectId||
      snapshot.run.executionBasisDigest!==basis.runExecutionBasisDigest||identity.factValue?.identityDigest!==basis.resolvedIdentityDigest||
      identity.factValue?.subjectId!==basis.subjectId||identity.factValue?.contentProfile!=='western_adult'||
      workspace?.state!=='active'||workspace.libraRunId!==libraRunId||workspace.workspaceId!==basis.workspaceId)
      fail('The current Run, identity or Workspace differs from its immutable catalogue Basis.');
    return {snapshot,identity,basis,workspace};
  }
  return Object.freeze({compile({libraRunId,mode}){
    if(typeof libraRunId!=='string'||!libraRunId||!['initial','initial_and_supplement'].includes(mode))fail('One exact Run and completed observation mode are required.');
    const before=scope(libraRunId),{snapshot,basis}=before;
    if(options.usAdultActorChoiceStore.current(basis.subjectId))return Object.freeze({kind:'manual_choice_present'});
    const completedBatches=readCompletedCatalogueBatches(options,snapshot,basis,mode),
      work=catalogueObservationWork({snapshot,basis,completedBatches,validator:options.contractValidator}),
      record=exactCatalogueResult(options,work,CAPABILITY),bytes=options.workspaceProductPort.readArtifactBytes(record.result.observationArtifactHandle).bytes,
      {observation,assessment}=readCatalogueObservationResult({basis,completedBatches,snapshot,validator:options.contractValidator,handle:record.result,bytes});
    const after=scope(libraRunId);
    if(after.basis.basisDigest!==basis.basisDigest||after.identity.factValue.identityDigest!==before.identity.factValue.identityDigest)
      fail('The Owner scope changed while compiling the directory decision input.');
    if(options.usAdultActorChoiceStore.current(basis.subjectId))return Object.freeze({kind:'manual_choice_present'});
    if(assessment.status!=='qualified_candidate')return Object.freeze({kind:'unqualified',status:assessment.status,assessmentDigest:assessment.assessmentDigest});
    const selected=assessment.winner,matches=observation.queries.flatMap(query=>query.result.matches)
      .filter(match=>match.identityKey===selected.identity&&match.uid===selected.uid);
    if(!matches.length||matches.some(match=>match.name!==selected.name)||selected.name.length>200)
      fail('The selected directory identity lost its consistent source name.');
    const aliases=[...new Set(matches.flatMap(match=>match.aliases).map(alias=>alias.trim()).filter(Boolean))].sort(compare);
    if(aliases.length>16||aliases.some(alias=>alias.length>200))fail('The selected directory aliases exceed the complete People query bound.');
    const winner={identityKey:selected.identity,uid:selected.uid,name:selected.name,aliases,groupIds:selected.groupIds,
      coverageStrata:selected.coverageStrata,supportingRepresentativeStrata:selected.supportingRepresentativeStrata},
      input={schema:'libra.us-adult-catalogue-decision-input@1',libraRunId,subjectId:basis.subjectId,
        runExecutionBasisDigest:basis.runExecutionBasisDigest,resolvedIdentityDigest:basis.resolvedIdentityDigest,
        catalogueBasisDigest:basis.basisDigest,observationResultRef:Object.fromEntries(RESULT_FIELDS.map(key=>[key,record[key]])),
        observationHandle:record.result,assessmentPolicyDigest:basis.selectionPolicy.policyDigest,assessmentDigest:assessment.assessmentDigest,
        representativeImagePolicyDigest:basis.representativeImagePolicy.policyDigest,
        winner,expectedChoiceHead:null};
    if(Buffer.byteLength(canonicalJson(input),'utf8')>256*1024)fail('The complete catalogue decision input exceeds its bound.');
    return freeze({kind:'qualified',input:JSON.parse(canonicalJson(input)),inputDigest:canonicalDigest(input)});
  }});
}
module.exports=Object.freeze({createUsAdultCatalogueDecisionInput});
