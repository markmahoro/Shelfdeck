'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertSourcePrepared}=require('../../../contracts/us-adult-inventory-analysis');
const {MATCH,RESULT,assertPageMatch}=require('../../../contracts/us-adult-inventory-matching');
const {SOURCE,sourceWork}=require('./us-adult-actor-refresh-execution');
const {referencePages}=require('./us-adult-actor-refresh');
const PREFIX='helix://arca/input-projections/UsAdultActorMatch',PROJECTIONS=Object.freeze({
  scope:PREFIX+'Scope/v1',intent:PREFIX+'Intent/v1',source:PREFIX+'Source/v1',page:PREFIX+'Page/v1'});
const REF_FIELDS=['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'];
const resultRef=capability=>'helix://contracts/capabilities/'+capability.replace('@1','/v1/result');
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});}
function matchWork(intent,aftercareCaseId,pageOrdinal,pageDigest,sourceResultDigest){
  if(intent.mode!=='automatic'||!Number.isSafeInteger(pageOrdinal)||pageOrdinal<0||pageOrdinal>=intent.pageCount||
      !/^[a-f0-9]{64}$/.test(pageDigest||'')||!/^[a-f0-9]{64}$/.test(sourceResultDigest||''))fail('Reference Work requires one exact frozen page and source Result.');
  const prior=sourceWork(intent,aftercareCaseId),identity={intentId:intent.intentId,intentDigest:intent.intentDigest,aftercareCaseId,pageOrdinal,pageDigest,sourceResultDigest},
    id=canonicalDigest(identity);
  return Object.freeze({...prior,workId:'arca-us-match-work-'+id,workKind:'us_adult_actor_match',
    workObjectiveTypeRef:'helix://arca/work/us_adult_actor_match/v1',executionBasisId:'arca-us-match-basis-'+id,
    dependencyRefs:[...prior.dependencyRefs,{ownerDomain:'arca',objectType:'supporting_work',objectId:prior.workId,revision:1,digest:intent.intentDigest},
      {ownerDomain:'arca',objectType:'us_adult_reference_page',objectId:String(pageOrdinal),revision:1,digest:pageDigest},
      {ownerDomain:'arca',objectType:'us_adult_source_result',objectId:prior.workId,revision:1,digest:sourceResultDigest}],
    idempotencyKey:'arca-us-match-'+id,concurrencyScope:'arca_shelf_entry/'+intent.shelfEntryId+'/us_adult_actor_match/'+pageOrdinal,
    outputContractRef:RESULT});
}
function assertRecord(record,work,capability){
  if(record?.outcomeKind!=='succeeded'||record.state!=='succeeded'||record.capabilityRef!==capability||record.workId!==work.workId||!record.inputBindings||
      record.resultSchemaRef!==resultRef(capability)||canonicalDigest(record.result)!==record.resultDigest||
      canonicalDigest(record.inputBindings)!==record.inputBindingDigest||REF_FIELDS.some(key=>typeof record[key]!=='string'||!record[key]))
    fail('Actor analysis requires one exact successful immutable Work Result and its actual Plan inputs.');
}
function exactSource(options,intent,aftercareCaseId){
  const work=sourceWork(intent,aftercareCaseId),status=options.workResultReader.status(work.workId),
    definition=options.workResultReader.readDefinition(work.workId)?.definition,
    records=options.workResultReader.read(work.workId).filter(record=>record.capabilityRef===SOURCE&&record.outcomeKind==='succeeded');
  if(status?.state!=='succeeded'||!definition||canonicalJson(definition)!==canonicalJson(work)||records.length!==1)fail('Source Work is not complete with its exact admitted definition.');
  const record=records[0];assertRecord(record,work,SOURCE);
  assertSourcePrepared({intent,aftercareCaseId,result:record.result,validator:options.contractValidator});return record;
}
function completeMatching({intent,aftercareCaseId,pages,sourceRecord,records,contractValidator}){
  if(intent.mode!=='automatic')fail('Automatic match completion cannot replace an explicit actor selection.');
  const frozen=referencePages(pages,contractValidator);
  if(['libraryDigest','personCount','pageCount','pageSetDigest'].some(key=>frozen[key]!==intent[key])||records.length!==intent.pageCount)
    fail('Automatic matching cannot complete a partial or substituted reference library.');
  assertRecord(sourceRecord,sourceWork(intent,aftercareCaseId),SOURCE);
  assertSourcePrepared({intent,aftercareCaseId,result:sourceRecord.result,validator:contractValidator});
  let winner=null;
  const proof=[];
  for(const [pageOrdinal,page]of pages.entries()){
    const record=records[pageOrdinal],work=matchWork(intent,aftercareCaseId,pageOrdinal,page.pageDigest,sourceRecord.resultDigest);
    assertRecord(record,work,MATCH);
    assertPageMatch({intent,aftercareCaseId,pageOrdinal,page,sourceResult:sourceRecord.result,result:record.result,validator:contractValidator});
    const expected={usAdultActorRefreshScope:PROJECTIONS.scope,usAdultActorRefreshIntent:PROJECTIONS.intent,arcaUsAdultSourcePrepared:PROJECTIONS.source,peopleReferenceLibraryPage:PROJECTIONS.page},
      bindings=record.inputBindings.bindings;
    if(!Array.isArray(bindings)||bindings.length!==4||Object.entries(expected).some(([portName,projectionRef])=>{
      const found=bindings.filter(item=>item.portName===portName);
      return found.length!==1||found[0].bindingKind!=='projected_owner_facts'||found[0].ownerDomain!=='arca'||found[0].processType!=='arca_shelf_entry'||
        found[0].processId!==intent.shelfEntryId||found[0].projectionRef!==projectionRef||canonicalJson(found[0].parameters)!==canonicalJson({
          aftercareCaseId,intentId:intent.intentId,pageOrdinal,sourceResultDigest:sourceRecord.resultDigest});
    }))fail('Page Result no longer points to the exact Case, frozen source and reference-page Owner projections.');
    proof.push({pageOrdinal,pageDigest:page.pageDigest,...Object.fromEntries(REF_FIELDS.map(key=>[key,record[key]]))});
    const match=record.result.matches[0];if(!match)continue;
    const order=winner&&(Buffer.compare(Buffer.from(match.personId),Buffer.from(winner.match.personId))||
      Buffer.compare(Buffer.from(match.referenceAssetId),Buffer.from(winner.match.referenceAssetId))||Buffer.compare(Buffer.from(match.faceGroupId),Buffer.from(winner.match.faceGroupId)));
    if(!winner||match.score>winner.match.score||match.score===winner.match.score&&order<0)
      winner={pageOrdinal,personSnapshot:page.items.find(item=>item.personId===match.personId),match,resultRef:proof.at(-1)};
  }
  const body={schema:'arca.us-adult-complete-matching@1',shelfEntryId:intent.shelfEntryId,aftercareCaseId,intentId:intent.intentId,intentDigest:intent.intentDigest,
    sourceResultDigest:sourceRecord.resultDigest,completedPageCount:pages.length,detectedFaceCount:sourceRecord.result.detectedFaceCount,
    resultSetDigest:canonicalDigest({schema:'arca.us-adult-complete-match-results@1',items:proof}),winner};
  return Object.freeze({...body,completionDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({MATCH,RESULT,PROJECTIONS,resultRef,matchWork,assertRecord,exactSource,completeMatching});
