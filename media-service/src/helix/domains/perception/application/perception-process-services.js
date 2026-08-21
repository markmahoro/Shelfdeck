'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createPerceptionStore } = require('../persistence/perception-store');
const { createPerceptionResolutionInputAssembler } = require('./perception-resolution-input-assembler');
const { buildRuleSnapshot, versionedQueryResult } = require('./perception-resolution-application');
const { deriveTitleYearEvidence } = require('../model/perception-aliases');

const LIMITS = Object.freeze({ globalOpenWorks:256, ownerOpenWorks:256, openEvents:256 });
const ACQUISITION_RESULT = 'helix://contracts/types/PerceptionRecordCommitResult/v1';
const RESOLUTION_RESULT = 'helix://contracts/types/PerceptionResolutionRevision/v1';
const RESOLUTION_INPUT_CONTRACT_REPAIR_CODE = 'P4_CAPABILITY_SCHEMA_REJECTED';
const RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS = 'perception-resolution-input-contract-repair@1';

function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function directSourceId(targetType,targetId){return stable('perception-direct-source-',{targetType,targetId});}
function freeze(value){return Array.isArray(value)?Object.freeze(value.map(freeze)):value&&typeof value==='object'?Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,freeze(v)]))):value;}
function definition(kind,processType,processId,basisDigest,outputContractRef){return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
  workId:stable('perception-'+kind+'-work-',{processType,processId,basisDigest}),ownerDomain:'perception',processType,processId,workKind:kind,
  workObjectiveTypeRef:'helix://perception/work/'+kind+'/v1',workObjectiveVersion:1,executionBasisId:stable('perception-'+kind+'-basis-',{processId,basisDigest}),
  executionBasisDigest:basisDigest,dependencyRefs:Object.freeze([]),priorityClass:'normal_foreground',priorityRevision:1,
  capabilityCatalogScope:'perception',workspaceMaterialScope:Object.freeze([]),idempotencyKey:stable('perception-'+kind+'-key-',{processId,basisDigest}),
  concurrencyScope:processId+'/'+kind,outputContractRef});}
function queryFor(target){const evidence=[];const add=(anchorKind,anchorValue,confidenceClass)=>{if(!anchorValue)return;evidence.push({anchorKind,anchorValue:String(anchorValue),confidenceClass,
  evidenceDigest:canonicalDigest({targetType:target.targetType,targetId:target.targetId,targetRevision:target.targetRevision,anchorKind,anchorValue:String(anchorValue)})});};
  add(target.targetType==='shelf_entry'?'shelf_entry_id':'subject_id',target.targetId,'exact');
  add('provider_identity',target.providerIdentity,'strong');if(target.title&&target.year){
    for(const alias of deriveTitleYearEvidence(target.title+'\0'+target.year,{stripTechnical:true}))add('title_year',alias.anchorValue,'medium');
  }
  evidence.sort((a,b)=>a.anchorKind.localeCompare(b.anchorKind)||a.anchorValue.localeCompare(b.anchorValue));
  const body={queryContract:'perception.rating.resolve@1',queryVersion:1,querySchemaRef:'helix://contracts/domain-types/PerceptionResolutionQuery/v1',factKind:'rating',identityEvidence:evidence};
  return freeze({...body,queryInputDigest:canonicalDigest(body)});}
function queryHandle(query,now){const body={schemaRef:'helix://contracts/types/CanonicalQueryHandle/v1',schemaVersion:1,providerDomain:'perception',consumerDomain:'libra',
  queryContract:query.queryContract,queryVersion:query.queryVersion,typedInputSchemaRef:query.querySchemaRef,typedInput:query,inputDigest:query.queryInputDigest,expiresAtMs:now+30*24*60*60*1000};
  return freeze({...body,fenceDigest:canonicalDigest(body)});}

function createPerceptionProcessServices(options){
  if(!options?.schemaManifest||!options.unitOfWork||!options.workResultReader||typeof options.targetProjectionReader!=='function')throw new TypeError('Perception process services require persistence, Foundation results, and public target projections.');
  const now=options.now||Date.now,store=options.perceptionStore||createPerceptionStore(options),assembler=createPerceptionResolutionInputAssembler({store}),ruleSnapshot=buildRuleSnapshot();
  const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,limits:LIMITS,eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='perception',basisDigest:request.executionBasisDigest,reasonCode:'PERCEPTION_BASIS_STALE'})}});
  function submit(work){return admission.replay(work)||admission.submit(work);}
  function workStatus(workId){return options.workResultReader.status(workId);}
  function succeeded(value){return value?.state==='succeeded'||value?.latestAttempt?.state==='succeeded';}
  function ensureSource(input){let current=store.getSource(input.sourceId);if(!current)return store.registerSource({perceptionSourceId:input.sourceId,sourceKind:input.sourceKind,integrationId:input.integrationId,status:'active',configRevision:input.configRevision});
    if(current.sourceKind!==input.sourceKind||current.integrationId!==input.integrationId||current.configRevision!==input.configRevision){
      if(input.configRevision!==current.configRevision+1)throw Object.assign(new Error('Perception Source revision is stale.'),{code:'PERCEPTION_SOURCE_REVISION_CONFLICT'});
      current=store.reviseSource({perceptionSourceId:input.sourceId,sourceKind:input.sourceKind,integrationId:input.integrationId,status:'active',configRevision:input.configRevision},current.configRevision);
    }return current;}
  function start(input){const existing=store.getAcquisition(input.acquisitionId);if(existing)return existing;const source=ensureSource(input);
    const scope=freeze(input.scope);return store.startAcquisition({perceptionAcquisitionId:input.acquisitionId,perceptionSourceId:source.perceptionSourceId,
      sourceConfigRevision:source.configRevision,scopeSchemaRef:'helix://contracts/types/PerceptionAcquisitionScope/v1',scope,scopeDigest:canonicalDigest(scope),
      initialCursorRevision:source.currentCursorRevision||0,initialCursorValue:null});}
  function acquisitionContext(acquisitionId){const acquisition=store.getAcquisition(acquisitionId);if(!acquisition)return null;const source=store.getSource(acquisition.perceptionSourceId);
    const pageOrdinal=(source.currentCursorRevision||0)-acquisition.initialCursorRevision;const prior=(source.currentCursorRevision||0)>acquisition.initialCursorRevision?store.getCursor(source.perceptionSourceId,source.currentCursorRevision):null;
    return freeze({acquisition,source,scope:JSON.parse(acquisition.scopeJson),pageOrdinal,expectedCursorRevision:source.currentCursorRevision||0,cursorIn:prior?.cursorOut||acquisition.initialCursorValue});}
  function reconcileAcquisition(acquisitionId){const context=acquisitionContext(acquisitionId);if(!context)return freeze({kind:'not_found',acquisitionId});if(context.acquisition.state==='completed')return freeze({kind:'terminal',acquisitionId});
    const basisDigest=canonicalDigest({schema:'perception.acquisition-page-basis@1',acquisitionId,sourceRevision:context.source.configRevision,pageOrdinal:context.pageOrdinal,cursorIn:context.cursorIn,scopeDigest:context.acquisition.scopeDigest});
    const work=definition('acquisition_page','perception_acquisition',acquisitionId,basisDigest,ACQUISITION_RESULT),submitted=submit(work);return freeze({kind:succeeded(workStatus(work.workId))?'ready_to_reconcile':'pending',acquisitionId,workId:work.workId,replayed:submitted.replayed});}
  function target(targetType,targetId){const value=options.targetProjectionReader(targetType,targetId);if(!value)throw Object.assign(new Error('Rating target does not exist.'),{code:'PERCEPTION_TARGET_NOT_FOUND'});return freeze({...value,targetType,targetId});}
  function createRecord(command){const retract=command?.rating===null;if(!command||!['subject','shelf_entry'].includes(command.targetType)||!retract&&(!Number.isSafeInteger(command.rating)||command.rating<1||command.rating>5)||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||typeof command.idempotencyKey!=='string'||!command.idempotencyKey)throw Object.assign(new Error('Rating command is invalid.'),{code:'PERCEPTION_RATING_COMMAND_INVALID'});
    const current=store.findCurrentTargetRating(command.targetType,command.targetId),currentRevision=current?.sourceRecordRevision||0;if(currentRevision!==command.expectedRevision)throw Object.assign(new Error('Rating revision is stale.'),{code:'PERCEPTION_RATING_REVISION_CONFLICT'});
    if(retract&&(!current||current.recordKind==='retraction'||current.rating===null))throw Object.assign(new Error('No direct rating is available to clear.'),{code:'PERCEPTION_DIRECT_RATING_NOT_FOUND'});
    const snapshot=target(command.targetType,command.targetId),revision=currentRevision+1,recordKey='shelfdeck:'+command.targetType+':'+command.targetId;
    const scope=freeze({mode:'direct',target:snapshot,directInput:{targetType:command.targetType,targetId:command.targetId,title:snapshot.title,year:snapshot.year||null,
      providerIdentity:snapshot.providerIdentity||null,rating:command.rating,watched:null,sourceRecordKey:recordKey,sourceRecordRevision:revision,
      sourceRecordDigest:canonicalDigest({recordKey,revision,rating:command.rating,operation:retract?'retract':'set',targetDigest:snapshot.targetDigest}),
      supersedes:!retract&&current?{sourceRecordKey:current.sourceRecordKey,sourceRecordRevision:current.sourceRecordRevision,sourceRecordDigest:current.sourceRecordDigest}:null,
      retracts:retract?{sourceRecordKey:current.sourceRecordKey,sourceRecordRevision:current.sourceRecordRevision,sourceRecordDigest:current.sourceRecordDigest}:null},idempotencyKey:command.idempotencyKey});
    const acquisitionId=stable('perception-direct-acquisition-',{idempotencyKey:command.idempotencyKey,targetType:command.targetType,targetId:command.targetId});
    start({acquisitionId,sourceId:directSourceId(command.targetType,command.targetId),sourceKind:'shelfdeck_direct',integrationId:'shelfdeck-direct-input',configRevision:1,scope});
    const operation=reconcileAcquisition(acquisitionId);return freeze({operationRef:acquisitionId,state:'accepted',targetType:command.targetType,targetId:command.targetId,expectedResultRevision:revision,workId:operation.workId});}
  function requestAcquisition(command){const config=options.readDoubanSourceConfiguration?.();if(!config)throw Object.assign(new Error('Douban integration is not configured.'),{code:'PERCEPTION_DOUBAN_NOT_CONFIGURED'});
    const idempotencyKey=command?.idempotencyKey;if(typeof idempotencyKey!=='string'||!idempotencyKey)throw Object.assign(new Error('Douban sync requires idempotencyKey.'),{code:'PERCEPTION_ACQUISITION_COMMAND_INVALID'});
    const acquisitionId=stable('perception-douban-acquisition-',{sourceId:config.sourceId,idempotencyKey});start({acquisitionId,sourceId:config.sourceId,sourceKind:'douban',integrationId:config.integrationId,configRevision:config.configRevision,
      scope:freeze({mode:'provider',collection:'watched_movies',sourceId:config.sourceId,idempotencyKey})});const operation=reconcileAcquisition(acquisitionId);
    return freeze({operationRef:acquisitionId,state:'accepted',sourceKind:'douban',workId:operation.workId});}
  function resolutionContext(targetType,targetId){const snapshot=target(targetType,targetId),query=queryFor(snapshot),handle=queryHandle(query,now()),assembled=assembler.assemble({queryHandle:handle,ruleSnapshot});return freeze({target:snapshot,queryHandle:handle,...assembled});}
  function ensureResolution(targetType,targetId){const context=resolutionContext(targetType,targetId),existing=store.getResolution(context.query.queryContract,context.query.queryInputDigest);
    if(existing&&existing.recordSetDigest===context.recordSet.recordSetDigest&&existing.ruleDigest===context.ruleSnapshot.ruleDigest)return freeze({kind:'terminal',resolution:existing,queryResult:versionedQueryResult(existing,30*24*60*60*1000)});
    const processId=targetType+':'+targetId,base={queryInputDigest:context.query.queryInputDigest,recordSetDigest:context.recordSet.recordSetDigest,ruleDigest:context.ruleSnapshot.ruleDigest},basisDigest=canonicalDigest(base);
    const priorStatus=workStatus(definition('resolution','perception_resolution',processId,basisDigest,RESOLUTION_RESULT).workId);
    const retryBasisDigest=priorStatus?.state==='failed'&&priorStatus.latestAttempt?.failure_code===RESOLUTION_INPUT_CONTRACT_REPAIR_CODE
      ? canonicalDigest({...base,recoveryBasis:RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS}) : basisDigest;
    const work=definition('resolution','perception_resolution',processId,retryBasisDigest,RESOLUTION_RESULT),submitted=submit(work);return freeze({kind:'pending',workId:work.workId,replayed:submitted.replayed,queryInputDigest:context.query.queryInputDigest});}
  function reconcileResolution(processId){const separator=processId.indexOf(':');return ensureResolution(processId.slice(0,separator),processId.slice(separator+1));}
  function reconcileImpactedSubjectResolutions(acquisitionId,listSubjectPage){
    if(typeof listSubjectPage!=='function')return freeze({matchedSubjectIds:[]});
    const anchorValues=new Set(store.listRecordsForAcquisition(acquisitionId).flatMap((record)=>record.anchors || [])
      .filter((anchor)=>anchor.anchorKind==='title_year').flatMap((anchor)=>deriveTitleYearEvidence(anchor.anchorValue,{providerDelimited:true}).map((item)=>item.anchorValue)));
    if(!anchorValues.size)return freeze({matchedSubjectIds:[]});
    const matched=[];let cursor=null;
    do{const page=listSubjectPage(cursor,100);for(const item of page.items||[]){const snapshot=target('subject',item.subjectId),query=queryFor(snapshot);
      if(query.identityEvidence.some((evidence)=>evidence.anchorKind==='title_year'&&anchorValues.has(evidence.anchorValue))){ensureResolution('subject',item.subjectId);matched.push(item.subjectId);}}
      cursor=page.nextCursor||null;}while(cursor!==null);
    return freeze({matchedSubjectIds:[...new Set(matched)].sort()});
  }
  function resolveDecisionFact(input){const value=ensureResolution(input.targetType,input.targetId);if(value.kind!=='terminal')return value;const r=value.resolution;return freeze({kind:r.resultKind,providerDomain:'perception',contract:{contractRef:r.queryContract,factKind:r.factKind,version:1},inputAnchorsDigest:r.queryInputDigest,revision:r.revision,
    ...(r.resultKind==='found'?{value:r.resolvedValue,evidence:[r.resolvedProvenance]}:{reasonCode:r.reasonCode,evidence:[]}),resolvedAtMs:r.committedAtMs,freshness:{status:'fresh',resolvedAtMs:r.committedAtMs,validForMs:30*24*60*60*1000},resolution:r,queryResult:value.queryResult});}
  function readCurrentRating(targetType,targetId){const context=resolutionContext(targetType,targetId),resolution=store.getResolution(context.query.queryContract,context.query.queryInputDigest),direct=store.findCurrentTargetRating(targetType,targetId);
    if(!resolution||resolution.recordSetDigest!==context.recordSet.recordSetDigest||resolution.ruleDigest!==context.ruleSnapshot.ruleDigest)return freeze({state:'pending',rating:null,sourceKind:null,expectedRevision:direct?.sourceRecordRevision||0});
    const winner=resolution.resultKind==='found'?store.getRecord(resolution.winningPerceptionId):null;
    return freeze({state:'ready',rating:resolution.resultKind==='found'?resolution.resolvedValue.value:null,sourceKind:winner?.sourceKind||null,
      expectedRevision:direct?.sourceRecordRevision||0,resolutionStatus:resolution.resultKind,resolutionRevision:resolution.revision,resolutionDigest:resolution.factDigest});}
  function readCurrentRatings(targetType,targetInputs){const targets=targetInputs.map((item)=>typeof item==='string'?target(targetType,item):freeze({...item,targetType,targetId:item.targetId})),queries=targets.map((item)=>({targetId:item.targetId,query:queryFor(item)})),rows=store.readCurrentResolvedRatings(queries.map((item)=>item.query.queryInputDigest)),byDigest=new Map(rows.map((item)=>[item.queryInputDigest,item])),direct=store.findCurrentTargetRatings(targetType,queries.map((item)=>item.targetId)),values=new Map();
    for(const item of queries){const row=byDigest.get(item.query.queryInputDigest),resolution=row?.resolution;if(!resolution||resolution.ruleDigest!==ruleSnapshot.ruleDigest){values.set(item.targetId,freeze({state:'pending',rating:null,sourceKind:null,expectedRevision:direct.get(item.targetId)?.sourceRecordRevision||0,resolutionStatus:null,resolutionRevision:null,resolutionDigest:null}));continue;}
      values.set(item.targetId,freeze({state:'ready',rating:resolution.resultKind==='found'?resolution.resolvedValue.value:null,sourceKind:row.winner?.sourceKind||null,expectedRevision:direct.get(item.targetId)?.sourceRecordRevision||0,resolutionStatus:resolution.resultKind,resolutionRevision:resolution.revision,resolutionDigest:resolution.factDigest}));}
    return values;}
  return Object.freeze({store,ruleSnapshot,acquisitionContext,resolutionContext,reconcileAcquisition,reconcileResolution,reconcileImpactedSubjectResolutions,createRecord,requestAcquisition,ensureResolution,resolveDecisionFact,
    readCurrentRating,readCurrentRatings,listRecords:(query)=>store.listRecords(query),listAcquisitions:()=>store.listAcquisitions()});
}

module.exports=Object.freeze({createPerceptionProcessServices,queryFor,queryHandle,directSourceId,RESOLUTION_INPUT_CONTRACT_REPAIR_CODE});
