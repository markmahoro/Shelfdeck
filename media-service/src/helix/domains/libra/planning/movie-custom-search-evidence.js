'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertStandardAcceptanceSpec}=require('../model/custom-acceptance-spec');
const external=require('../model/external-material-contracts');
const {buildMediaRequirement}=require('../model/media-production-contracts');
const {externalSearchSelectionWork}=require('./external-material-work');
const {productStructure}=require('./external-material-planner');

const QUERY='libra.external_material.query.prepare@1';
const SEARCH='libra.external_material.search@1';
const SELECT='libra.external_material.candidate.select@1';
const IDENTITY='libra.product_identity.evidence.observe@1';
const DIGEST=/^[a-f0-9]{64}$/;
const schema=capability=>'helix://contracts/capabilities/'+capability.replace('@1','/v1')+'/result';
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const same=(left,right)=>canonicalJson(left)===canonicalJson(right);
const literal=(portName,value)=>({portName,bindingKind:'literal',value});
const eventResult=(portName,eventId,resultSchemaRef)=>({portName,bindingKind:'event_result',eventId,resultSchemaRef});
function fail(){throw Object.assign(new Error('Movie external search evidence does not match its exact Owner Work and Run.'),
  {code:'LIBRA_CUSTOM_SEARCH_EVIDENCE_INVALID'});}
function requireValue(value){if(!value)fail();}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function finish(value){const copy=JSON.parse(canonicalJson(value));return freeze({...copy,observationDigest:canonicalDigest(copy)});}
function readLiteral(row,name){
  const bindings=row.inputBindings?.bindings;
  requireValue(Array.isArray(bindings));
  const matches=bindings.filter(item=>item.portName===name);
  requireValue(matches.length===1&&matches[0].bindingKind==='literal'&&Object.hasOwn(matches[0],'value'));
  return matches[0].value;
}
function exactBindings(row,expected){
  requireValue(row.inputBindings?.schemaRef==='helix://foundation/types/EventInputBindingSet/v1'&&
    row.inputBindings.schemaVersion===1&&same(row.inputBindings.bindings,expected));
}
function resultRef(row){return {workId:row.workId,eventId:row.eventId,eventAttemptId:row.eventAttemptId,
  resultId:row.resultId,resultDigest:row.resultDigest};}

// A recorded search is a bounded observation. It neither proves provider-wide
// coverage nor authorizes a target change, acquisition, or collection commit.
// Callers must fence this read together with the remaining current Owner view.
function readMovieCustomSearchEvidence({libraRunId,movieProductionReader,workResultReader,acquisitionCandidateEvidenceStore}){
  if(typeof libraRunId!=='string'||!libraRunId||typeof movieProductionReader?.readRunSnapshot!=='function'||
      typeof movieProductionReader?.readFact!=='function'||typeof workResultReader?.status!=='function'||
      typeof workResultReader?.readDefinition!=='function'||typeof workResultReader?.read!=='function'||
      typeof workResultReader?.listWorks!=='function'||typeof acquisitionCandidateEvidenceStore?.read!=='function')
    throw new TypeError('Movie search evidence requires exact Libra and Foundation Owner readers.');
  const snapshot=movieProductionReader.readRunSnapshot(libraRunId),spec=assertStandardAcceptanceSpec(snapshot?.spec),run=snapshot?.run;
  requireValue(run?.libraRunId===libraRunId&&run.subjectId===spec.subjectId&&run.acceptanceSpecId===spec.acceptanceSpecId&&
    DIGEST.test(run.executionBasisDigest||'')&&spec.contentProfile==='movie'&&spec.structureKind==='single'&&
    spec.productScope?.scopeKind==='single'&&Array.isArray(spec.productScope.episodeKeys)&&spec.productScope.episodeKeys.length===0&&
    Array.isArray(snapshot.episodeClaims)&&snapshot.episodeClaims.length===0);
  const work=externalSearchSelectionWork(snapshot),status=workResultReader.status(work.workId),base={
    libraRunId,acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,
    runExecutionBasisDigest:run.executionBasisDigest,workId:work.workId,coverage:'unknown'};
  if(!status)return finish({...base,status:'evidence_pending',reasonCode:'search_not_started',workState:null});
  requireValue(status.work_id===work.workId&&status.owner_domain==='libra'&&status.process_type==='libra_run'&&
    status.process_id===libraRunId&&status.work_kind===work.workKind&&status.basis_digest===work.executionBasisDigest&&
    ['admitted','ready','running','blocked','succeeded','failed','cancelled'].includes(status.state));
  if(status.state!=='succeeded')return finish({...base,status:'evidence_pending',reasonCode:'search_not_succeeded',workState:status.state});
  const attemptId=status.latestAttempt?.attempt_id,definition=workResultReader.readDefinition(work.workId);
  requireValue(typeof attemptId==='string'&&attemptId.length>0&&status.latestAttempt.state==='succeeded'&&
    definition?.workId===work.workId&&definition.definitionDigest===canonicalDigest(work)&&same(definition.definition,work));
  const planId=stable('libra-external-material-plan-',{workId:work.workId,attempt:attemptId}),
    rows=workResultReader.read(work.workId).filter(row=>row.attemptId===attemptId);
  requireValue(rows.length===3&&rows.every(row=>row.workId===work.workId&&row.planId===planId&&row.planRevision===1&&
    row.state==='succeeded'&&row.outcomeKind==='succeeded'&&DIGEST.test(row.planDigest||'')&&
    typeof row.eventAttemptId==='string'&&row.eventAttemptId.length>0&&typeof row.resultId==='string'&&row.resultId.length>0&&
    row.resultSchemaRef===schema(row.capabilityRef)&&row.resultDigest===canonicalDigest(row.result)&&
    row.inputBindingDigest===canonicalDigest(row.inputBindings))&&
    new Set(rows.map(row=>row.eventId)).size===3&&new Set(rows.map(row=>row.planDigest)).size===1);
  const one=(capability,eventPrefix,nodeId)=>{
    const found=rows.filter(row=>row.capabilityRef===capability);
    requireValue(found.length===1&&found[0].eventId===stable(eventPrefix,{attempt:attemptId})&&found[0].nodeId===nodeId);
    return found[0];
  };
  const query=one(QUERY,'libra-external-query-event-','external_query'),
    search=one(SEARCH,'libra-external-search-event-','external_search'),
    selection=one(SELECT,'libra-external-select-event-','external_candidate_selection');
  const fact=movieProductionReader.readFact(libraRunId,'resolved_identity',1),identity=fact?.factValue,
    observation=readLiteral(query,'productIdentityEvidenceObservation'),handle=readLiteral(search,'integrationHandle');
  requireValue(fact?.factKind==='resolved_identity'&&fact.factRevision===1&&identity?.subjectId===run.subjectId&&
    identity.contentProfile==='movie'&&DIGEST.test(identity.identityDigest||'')&&fact.factDigest===identity.identityDigest&&
    handle?.integrationType==='moviepilot'&&handle.allowedOperation===SEARCH&&typeof handle.integrationId==='string'&&
    handle.integrationId.length>0&&Number.isSafeInteger(handle.configRevision)&&handle.configRevision>0);
  const identityWorks=workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:libraRunId,workKind:'product_identity'});
  requireValue(Array.isArray(identityWorks));
  const identityRows=identityWorks.flatMap(item=>{
    requireValue(item.owner_domain==='libra'&&item.process_type==='libra_run'&&item.process_id===libraRunId&&
      item.work_kind==='product_identity'&&typeof item.work_id==='string'&&item.work_id.length>0);
    return workResultReader.read(item.work_id).filter(row=>row.capabilityRef===IDENTITY&&row.outcomeKind==='succeeded'&&
      same(row.result,observation)).map(row=>({workId:item.work_id,row}));
  });
  requireValue(identityRows.length===1&&identityRows[0].row.workId===identityRows[0].workId&&
    identityRows[0].row.state==='succeeded'&&identityRows[0].row.resultSchemaRef===schema(IDENTITY)&&
    typeof identityRows[0].row.resultId==='string'&&identityRows[0].row.resultId.length>0&&
    identityRows[0].row.resultDigest===canonicalDigest(observation));
  const structure=productStructure(snapshot),requirement=buildMediaRequirement(spec),policy=external.buildAcquisitionPolicy(handle);
  exactBindings(query,[literal('resolvedProductIdentity',identity),literal('productIdentityEvidenceObservation',observation),
    literal('productStructure',structure),literal('mediaRequirement',requirement),literal('acquisitionPolicy',policy)]);
  const rebuiltQuery=external.buildAcquisitionQuery({resolvedProductIdentity:identity,productIdentityEvidenceObservation:observation,
    productStructure:structure,mediaRequirement:requirement,acquisitionPolicy:policy,
    executionContext:{libraRunId,runExecutionBasisDigest:run.executionBasisDigest},producedAtMs:query.result.producedAtMs});
  requireValue(same(query.result,rebuiltQuery));
  exactBindings(search,[eventResult('acquisitionQuery',query.eventId,schema(QUERY)),literal('integrationHandle',handle)]);
  const record=search.result;
  requireValue(record?.libraRunId===libraRunId&&record.runExecutionBasisDigest===run.executionBasisDigest&&
    record.searchWorkId===work.workId&&record.searchEventId===search.eventId&&record.searchEventAttemptId===search.eventAttemptId&&
    record.queryDigest===rebuiltQuery.queryDigest&&record.integrationId===handle.integrationId&&record.configRevision===handle.configRevision);
  const candidates=external.assertCandidates(acquisitionCandidateEvidenceStore.read(record,libraRunId));
  requireValue(record.payloadDigest===canonicalDigest(candidates)&&record.candidateCount===candidates.candidates.length&&
    record.candidateSetDigest===candidates.candidateSetDigest&&candidates.queryDigest===rebuiltQuery.queryDigest&&
    candidates.integrationId===handle.integrationId&&candidates.configRevision===handle.configRevision&&
    candidates.candidates.every(item=>item.integrationId===handle.integrationId&&item.configRevision===handle.configRevision));
  const criteria=external.buildSelectionCriteria({revision:1,queryDigest:rebuiltQuery.queryDigest});
  exactBindings(selection,[eventResult('candidates',search.eventId,schema(SEARCH)),literal('selectionCriteria',criteria)]);
  requireValue(same(selection.result,external.selectCandidate({candidates,selectionCriteria:criteria,producedAtMs:selection.result.producedAtMs})));
  return finish({...base,status:'observed',reasonCode:null,workState:status.state,
    queryResultRef:resultRef(query),searchResultRef:resultRef(search),selectionResultRef:resultRef(selection),
    candidateRecord:record,candidateEvidence:candidates,selection:selection.result,
    outputAtContractMaximum:candidates.candidates.length===100});
}

module.exports=Object.freeze({readMovieCustomSearchEvidence});
