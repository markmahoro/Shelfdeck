'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createPerceptionStore } = require('../persistence/perception-store');
const { createPerceptionResolutionInputAssembler } = require('./perception-resolution-input-assembler');
const { buildRuleSnapshot, versionedQueryResult } = require('./perception-resolution-application');
const { deriveTitleEvidence, normalizeAlias, titleAssociationAliases } = require('../model/perception-aliases');
const { createPerceptionAcquisitionAutomation } = require('./perception-acquisition-automation');
const { proveLegacyPeriodicAcquisition } = require('../model/legacy-acquisition-origin');
const {assertJavPerceptionContinuity,DIRECT_POLICY}=require('../../../contracts/jav-perception-continuity');
const {resolutionBasis,matchesResolutionBasis,RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS}=require('../model/perception-resolution-fence');

const LIMITS = Object.freeze({ globalOpenWorks:256, ownerOpenWorks:256, openEvents:256 });
const ACQUISITION_RESULT = 'helix://contracts/types/PerceptionRecordCommitResult/v1';
const RESOLUTION_RESULT = 'helix://contracts/types/PerceptionResolutionRevision/v1';
const RESOLUTION_INPUT_CONTRACT_REPAIR_CODE = 'P4_CAPABILITY_SCHEMA_REJECTED';

function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function directSourceId(targetType,targetId,factKind='rating'){return stable('perception-direct-source-',factKind==='rating'?{targetType,targetId}:{targetType,targetId,factKind});}
function resolutionTarget(processId){const factKind=processId.startsWith('watched/')?'watched':'rating',value=factKind==='watched'?processId.slice(8):processId,
  separator=value.indexOf(':');if(separator<1||!['subject','shelf_entry'].includes(value.slice(0,separator))||!value.slice(separator+1))throw new TypeError('Resolution process target is invalid.');
  return {targetType:value.slice(0,separator),targetId:value.slice(separator+1),factKind};}
function freeze(value){return Array.isArray(value)?Object.freeze(value.map(freeze)):value&&typeof value==='object'?Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,freeze(v)]))):value;}
function definition(kind,processType,processId,basisDigest,outputContractRef){return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
  workId:stable('perception-'+kind+'-work-',{processType,processId,basisDigest}),ownerDomain:'perception',processType,processId,workKind:kind,
  workObjectiveTypeRef:'helix://perception/work/'+kind+'/v1',workObjectiveVersion:1,executionBasisId:stable('perception-'+kind+'-basis-',{processId,basisDigest}),
  executionBasisDigest:basisDigest,dependencyRefs:Object.freeze([]),priorityClass:'normal_foreground',priorityRevision:1,
  capabilityCatalogScope:'perception',workspaceMaterialScope:Object.freeze([]),idempotencyKey:stable('perception-'+kind+'-key-',{processId,basisDigest}),
  concurrencyScope:processId+'/'+kind,outputContractRef});}
function queryFor(target,factKind='rating'){if(!['rating','watched'].includes(factKind))throw new TypeError('Perception query fact kind is invalid.');const evidence=[];const add=(anchorKind,anchorValue,confidenceClass)=>{if(!anchorValue)return;evidence.push({anchorKind,anchorValue:String(anchorValue),confidenceClass,
  evidenceDigest:canonicalDigest({targetType:target.targetType,targetId:target.targetId,targetRevision:target.targetRevision,anchorKind,anchorValue:String(anchorValue)})});};
  add(target.targetType==='shelf_entry'?'shelf_entry_id':'subject_id',target.targetId,'exact');
  let directTargetScope;
  if(target.javPerceptionContinuity){const proof=assertJavPerceptionContinuity(target.javPerceptionContinuity,target);
    add('subject_id',proof.acceptedSubjectOrigin.subjectId,'exact');
    directTargetScope={policyRef:DIRECT_POLICY,shelfEntryId:target.targetId,acceptedSubjectId:proof.acceptedSubjectOrigin.subjectId,continuityDigest:proof.continuityDigest};
  }
  add('provider_identity',target.providerIdentity,'strong');if(target.title){
    for(const alias of titleAssociationAliases(target.title))add('title',alias,'medium');
  }
  evidence.sort((a,b)=>a.anchorKind.localeCompare(b.anchorKind)||a.anchorValue.localeCompare(b.anchorValue));
  const body={queryContract:'perception.'+factKind+'.resolve@1',queryVersion:1,querySchemaRef:'helix://contracts/domain-types/PerceptionResolutionQuery/v1',factKind,identityEvidence:evidence,
    ...(directTargetScope?{directTargetScope}: {})};
  return freeze({...body,queryInputDigest:canonicalDigest(body)});}
function queryHandle(query,now,consumerDomain){const domain=consumerDomain==='arca'?'arca':'libra';
  const body={schemaRef:'helix://contracts/types/CanonicalQueryHandle/v1',schemaVersion:1,providerDomain:'perception',consumerDomain:domain,
  queryContract:query.queryContract,queryVersion:query.queryVersion,typedInputSchemaRef:query.querySchemaRef,typedInput:query,inputDigest:query.queryInputDigest,expiresAtMs:now+30*24*60*60*1000};
  return freeze({...body,fenceDigest:canonicalDigest(body)});}

function createPerceptionProcessServices(options){
  if(!options?.schemaManifest||!options.unitOfWork||!options.workResultReader||typeof options.targetProjectionReader!=='function')throw new TypeError('Perception process services require persistence, Foundation results, and public target projections.');
  const now=options.now||Date.now,store=options.perceptionStore||createPerceptionStore(options),assembler=createPerceptionResolutionInputAssembler({store}),ruleSnapshot=buildRuleSnapshot();
  const resumeIntent=options.acquisitionResumeIntent;
  if(!resumeIntent?.findCommand||!resumeIntent.hasResume||!resumeIntent.request)throw new TypeError('Perception process services require the Owner acquisition resume command.');
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
      sourceConfigRevision:source.configRevision,scopeSchemaRef:'helix://contracts/types/PerceptionAcquisitionScope/v1',scope,scopeDigest:canonicalDigest(scope)});}
  function acquisitionContext(acquisitionId){const acquisition=store.getAcquisition(acquisitionId);if(!acquisition)return null;const source=store.getSource(acquisition.perceptionSourceId);
    const pageOrdinal=(source.currentCursorRevision||0)-acquisition.initialCursorRevision;const prior=(source.currentCursorRevision||0)>acquisition.initialCursorRevision?store.getCursor(source.perceptionSourceId,source.currentCursorRevision):null;
    return freeze({acquisition,source,scope:JSON.parse(acquisition.scopeJson),pageOrdinal,expectedCursorRevision:source.currentCursorRevision||0,cursorIn:prior?.cursorOut||acquisition.initialCursorValue});}
  function reconcileAcquisition(acquisitionId){const context=acquisitionContext(acquisitionId);if(!context)return freeze({kind:'not_found',acquisitionId});
    if(['completed','failed'].includes(context.acquisition.state))return freeze({kind:'terminal',acquisitionId,state:context.acquisition.state});
    const basisDigest=canonicalDigest({schema:'perception.acquisition-page-basis@1',acquisitionId,sourceRevision:context.source.configRevision,pageOrdinal:context.pageOrdinal,cursorIn:context.cursorIn,scopeDigest:context.acquisition.scopeDigest});
    const work=definition('acquisition_page','perception_acquisition',acquisitionId,basisDigest,ACQUISITION_RESULT);
    const status=workStatus(work.workId);
    if(status?.state==='failed'){
      const failed=store.failAcquisition(acquisitionId);
      return freeze({kind:'terminal',acquisitionId,state:failed?.state||'failed',workId:work.workId});
    }
    const submitted=submit(work);return freeze({kind:succeeded(workStatus(work.workId))?'ready_to_reconcile':'pending',acquisitionId,workId:work.workId,replayed:submitted.replayed});}
  function target(targetType,targetId){const value=options.targetProjectionReader(targetType,targetId);if(!value)throw Object.assign(new Error('Rating target does not exist.'),{code:'PERCEPTION_TARGET_NOT_FOUND'});return freeze({...value,targetType,targetId});}
  function createRecord(command){const factKind=command&&Object.hasOwn(command,'watched')?'watched':'rating',value=command?.[factKind],retract=value===null,
    suffix=factKind==='rating'?'RATING':'WATCHED',required=['targetType','targetId','expectedRevision',factKind,'idempotencyKey'];
    if(!command||Object.keys(command).sort().join(',')!==required.sort().join(',')||!['subject','shelf_entry'].includes(command.targetType)||
        typeof command.targetId!=='string'||!command.targetId||command.targetId.length>256||!retract&&(factKind==='rating'?(!Number.isSafeInteger(value)||value<1||value>5):typeof value!=='boolean')||
        !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||typeof command.idempotencyKey!=='string'||!command.idempotencyKey||command.idempotencyKey.length>256)
      throw Object.assign(new Error('Direct perception command is invalid.'),{code:'PERCEPTION_'+suffix+'_COMMAND_INVALID'});
    const acquisitionIdentity={idempotencyKey:command.idempotencyKey,targetType:command.targetType,targetId:command.targetId,...(factKind==='watched'?{factKind}: {})},
      acquisitionId=stable('perception-direct-acquisition-',acquisitionIdentity),requestDigest=canonicalDigest(command),existing=store.getAcquisition(acquisitionId);
    if(existing){const prior=JSON.parse(existing.scopeJson);if(prior.requestDigest!==requestDigest)throw Object.assign(new Error('Direct input retry differs from its accepted command.'),{code:'PERCEPTION_DIRECT_INPUT_IDEMPOTENCY_CONFLICT'});
      const operation=reconcileAcquisition(acquisitionId),first=options.workResultReader.listWorks({ownerDomain:'perception',processType:'perception_acquisition',processId:acquisitionId,workKind:'acquisition_page'})
        .sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms)||a.work_id.localeCompare(b.work_id))[0];
      return freeze({operationRef:acquisitionId,state:'accepted',targetType:command.targetType,targetId:command.targetId,expectedResultRevision:prior.directInput.sourceRecordRevision,workId:first?.work_id||operation.workId});}
    const current=store.findCurrentTargetRating(command.targetType,command.targetId,factKind),currentRevision=current?.sourceRecordRevision||0;
    if(currentRevision!==command.expectedRevision)throw Object.assign(new Error('Direct perception revision is stale.'),{code:'PERCEPTION_'+suffix+'_REVISION_CONFLICT'});
    if(retract&&(!current||current.recordKind==='retraction'||(factKind==='rating'?current.rating:current.watchedState)===null))throw Object.assign(new Error('No direct input is available to clear.'),{code:'PERCEPTION_DIRECT_'+suffix+'_NOT_FOUND'});
    const snapshot=target(command.targetType,command.targetId),revision=currentRevision+1,recordKey='shelfdeck:'+(factKind==='watched'?'watched:':'')+command.targetType+':'+command.targetId;
    const scope=freeze({mode:'direct',target:snapshot,directInput:{targetType:command.targetType,targetId:command.targetId,title:snapshot.title,year:snapshot.year||null,
      providerIdentity:snapshot.providerIdentity||null,rating:factKind==='rating'?value:null,watched:factKind==='watched'?value:null,sourceRecordKey:recordKey,sourceRecordRevision:revision,
      sourceRecordDigest:canonicalDigest({recordKey,revision,[factKind]:value,operation:retract?'retract':'set',targetDigest:snapshot.targetDigest}),
      supersedes:!retract&&current?{sourceRecordKey:current.sourceRecordKey,sourceRecordRevision:current.sourceRecordRevision,sourceRecordDigest:current.sourceRecordDigest}:null,
      retracts:retract?{sourceRecordKey:current.sourceRecordKey,sourceRecordRevision:current.sourceRecordRevision,sourceRecordDigest:current.sourceRecordDigest}:null},idempotencyKey:command.idempotencyKey,requestDigest});
    start({acquisitionId,sourceId:directSourceId(command.targetType,command.targetId,factKind),sourceKind:'shelfdeck_direct',integrationId:'shelfdeck-direct-input',configRevision:1,scope});
    const operation=reconcileAcquisition(acquisitionId);return freeze({operationRef:acquisitionId,state:'accepted',targetType:command.targetType,targetId:command.targetId,expectedResultRevision:revision,workId:operation.workId});}
  function requestAcquisition(command,{executionOrigin='manual',actorId='admin'}={}){const config=options.readDoubanSourceConfiguration?.();if(!config)throw Object.assign(new Error('Douban integration is not configured.'),{code:'PERCEPTION_DOUBAN_NOT_CONFIGURED'});
    const idempotencyKey=command?.idempotencyKey;if(!command||Object.keys(command).join(',')!=='idempotencyKey'||typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>128)throw Object.assign(new Error('Douban sync requires idempotencyKey.'),{code:'PERCEPTION_ACQUISITION_COMMAND_INVALID'});
    if(executionOrigin==='manual'){
      const prior=resumeIntent.findCommand(actorId,idempotencyKey);
      if(prior){
        if(prior.request_digest!==canonicalDigest(command))throw Object.assign(new Error('同步继续请求与原命令不同。'),{code:'PERCEPTION_RESUME_COMMAND_CONFLICT'});
        const operation=reconcileAcquisition(prior.perception_acquisition_id);
        return freeze({operationRef:prior.perception_acquisition_id,state:'accepted',sourceKind:'douban',workId:operation.workId||null});
      }
    }
    const acquisitionId=stable('perception-douban-acquisition-',{sourceId:config.sourceId,idempotencyKey});
    if(executionOrigin==='manual'&&!store.getAcquisition(acquisitionId)){
      const active=store.listAcquisitions().find(item=>item.perceptionSourceId===config.sourceId&&item.state==='active');
      if(active){
        if(active.sourceConfigRevision!==config.configRevision)throw Object.assign(new Error('同步配置已变化，不能沿旧配置继续。'),{code:'PERCEPTION_RESUME_BASIS_CONFLICT'});
        resumeIntent.request(active,command,actorId);
        const operation=reconcileAcquisition(active.perceptionAcquisitionId);
        return freeze({operationRef:active.perceptionAcquisitionId,state:'accepted',sourceKind:'douban',workId:operation.workId||null});
      }
    }
    const existing=store.getAcquisition(acquisitionId);let scope;
    if(existing)scope=JSON.parse(existing.scopeJson);
    else {const source=store.getSource(config.sourceId),head=source?.currentCursorRevision?store.getCursor(config.sourceId,source.currentCursorRevision):null,
      headAcquisition=head?store.getAcquisition(head.perceptionAcquisitionId):null;
      scope=head?.hasMore&&headAcquisition?.state==='failed'&&headAcquisition.sourceConfigRevision===config.configRevision
        ? JSON.parse(headAcquisition.scopeJson)
        : freeze({mode:'provider',executionOrigin,collection:'watched_movies',sourceId:config.sourceId,
          acquisitionWindow:freeze({kind:'full_snapshot',openedAtMs:now()})});
      scope=freeze(scope);}
    const acquisition=start({acquisitionId,sourceId:config.sourceId,sourceKind:'douban',integrationId:config.integrationId,configRevision:config.configRevision,scope});
    if(executionOrigin==='manual'&&acquisition.state==='active'&&scope.executionOrigin!=='manual'&&!resumeIntent.hasResume(acquisitionId))resumeIntent.request(acquisition,command,actorId);
    const operation=reconcileAcquisition(acquisitionId);
    return freeze({operationRef:acquisitionId,state:'accepted',sourceKind:'douban',workId:operation.workId});}
  function resolutionContext(targetType,targetId,factKind='rating'){const snapshot=target(targetType,targetId),query=queryFor(snapshot,factKind),handle=queryHandle(query,now(),targetType==='shelf_entry'?'arca':'libra'),assembled=assembler.assemble({queryHandle:handle,ruleSnapshot});return freeze({target:snapshot,queryHandle:handle,...assembled});}
  function resolutionProcessContext(processId){const value=resolutionTarget(processId);return resolutionContext(value.targetType,value.targetId,value.factKind);}
  function ensureResolution(targetType,targetId,factKind='rating'){return ensureResolutionContext(resolutionContext(targetType,targetId,factKind),targetType,targetId,factKind);}
  function ensureTargetResolutions(targetType,targetId){
    const snapshot=target(targetType,targetId),factKinds=['rating','watched'],at=now(),contexts=assembler.assemblePair({ruleSnapshot,
      queryHandles:factKinds.map(kind=>queryHandle(queryFor(snapshot,kind),at,targetType==='shelf_entry'?'arca':'libra'))});
    return freeze(Object.fromEntries(contexts.map((context,index)=>[factKinds[index],ensureResolutionContext(context,targetType,targetId,factKinds[index])])));
  }
  function resolutionWork(context,targetType,targetId,factKind){const processId=(factKind==='watched'?'watched/':'')+targetType+':'+targetId,base=resolutionBasis(context);
    return {base,processId,work:definition('resolution','perception_resolution',processId,canonicalDigest(base),RESOLUTION_RESULT)};}
  function repairResolutionWork(value){return definition('resolution','perception_resolution',value.processId,
    canonicalDigest({...value.base,recoveryBasis:RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS}),RESOLUTION_RESULT);}
  function terminalResolutionWork(status){
    if(status?.state==='failed')return {kind:'failed',reasonCode:status.latestAttempt?.failure_code||'resolution_failed'};
    if(status?.state==='cancelled')return {kind:'cancelled',reasonCode:'resolution_cancelled'};
    return null;
  }
  function ensureResolutionContext(context,targetType,targetId,factKind){const existing=store.getResolution(context.query.queryContract,context.query.queryInputDigest);
    if(existing&&existing.recordSetDigest===context.recordSet.recordSetDigest&&existing.ruleDigest===context.ruleSnapshot.ruleDigest)return freeze({kind:'terminal',resolution:existing,queryResult:versionedQueryResult(existing,30*24*60*60*1000)});
    const value=resolutionWork(context,targetType,targetId,factKind),priorStatus=workStatus(value.work.workId),repair=priorStatus?.state==='failed'&&priorStatus.latestAttempt?.failure_code===RESOLUTION_INPUT_CONTRACT_REPAIR_CODE,
      work=repair?repairResolutionWork(value):value.work,status=repair?workStatus(work.workId):priorStatus,terminal=terminalResolutionWork(status);
    if(terminal)return freeze({...terminal,workId:work.workId,queryInputDigest:context.query.queryInputDigest});
    const submitted=submit(work);return freeze({kind:'pending',workId:work.workId,replayed:submitted.replayed,queryInputDigest:context.query.queryInputDigest});}
  function reconcileResolution(processId){const value=resolutionTarget(processId);return ensureResolution(value.targetType,value.targetId,value.factKind);}
  function supersededResolutionDisposition(processId,workId){
    const status=workStatus(workId);if(!status||Number(status.latestAttempt?.ordinal||0)>=3)return 'failed';
    let context;try{context=resolutionProcessContext(processId);}catch(error){if(error?.code==='PERCEPTION_TARGET_NOT_FOUND')return 'failed';throw error;}
    if(!matchesResolutionBasis(resolutionBasis(context),status.basis_digest))return 'failed';
    const current=store.getResolution(context.query.queryContract,context.query.queryInputDigest);
    return current&&current.recordSetDigest===context.recordSet.recordSetDigest&&current.ruleDigest===context.ruleSnapshot.ruleDigest?'failed':'replan';
  }
  function reconcileSupersededResolution(processId){
    try{return reconcileResolution(processId);}catch(error){if(error?.code==='PERCEPTION_TARGET_NOT_FOUND')return freeze({kind:'target_unavailable'});throw error;}
  }
  function reconcileImpactedSubjectResolutions(acquisitionId,listSubjectPage){
    if(typeof listSubjectPage!=='function')return freeze({matchedSubjectIds:[]});
    const anchorValues=new Set(store.listRecordsForAcquisition(acquisitionId).flatMap((record)=>(record.anchors || []).flatMap((anchor)=>
      anchor.anchorKind==='title'?[anchor.anchorValue]:anchor.anchorKind==='title_year'
        ? deriveTitleEvidence(anchor.anchorValue,{providerDelimited:true}).map((item)=>item.anchorValue):[])).map(normalizeAlias));
    if(!anchorValues.size)return freeze({matchedSubjectIds:[]});
    const matched=[];let cursor=null;
    do{const page=listSubjectPage(cursor,100);for(const item of page.items||[]){const snapshot=target('subject',item.subjectId),query=queryFor(snapshot);
      if(query.identityEvidence.some((evidence)=>evidence.anchorKind==='title'&&anchorValues.has(normalizeAlias(evidence.anchorValue)))){ensureResolution('subject',item.subjectId);matched.push(item.subjectId);}}
      cursor=page.nextCursor||null;}while(cursor!==null);
    return freeze({matchedSubjectIds:[...new Set(matched)].sort()});
  }
  function resolveDecisionFact(input){const value=ensureResolution(input.targetType,input.targetId);if(value.kind!=='terminal')return value;const r=value.resolution;return freeze({kind:r.resultKind,providerDomain:'perception',contract:{contractRef:r.queryContract,factKind:r.factKind,version:1},inputAnchorsDigest:r.queryInputDigest,revision:r.revision,
    ...(r.resultKind==='found'?{value:r.resolvedValue,evidence:[r.resolvedProvenance]}:{reasonCode:r.reasonCode,evidence:[]}),resolvedAtMs:r.committedAtMs,freshness:{status:'fresh',resolvedAtMs:r.committedAtMs,validForMs:30*24*60*60*1000},resolution:r,queryResult:value.queryResult});}
  function currentResolution(context,resolution){return Boolean(resolution&&resolution.queryInputDigest===context.query.queryInputDigest&&
    resolution.recordSetDigest===context.recordSet.recordSetDigest&&resolution.ruleDigest===context.ruleSnapshot.ruleDigest);}
  function ratingProjection(context,resolution,winner,direct,status){
    if(!currentResolution(context,resolution)){const terminal=terminalResolutionWork(status);return freeze({state:terminal?.kind||'pending',rating:null,sourceKind:null,
      expectedRevision:direct?.sourceRecordRevision||0,resolutionStatus:null,reasonCode:terminal?.reasonCode||'resolution_pending',resolutionRevision:null,resolutionDigest:null});}
    return freeze({state:'ready',rating:resolution.resultKind==='found'?resolution.resolvedValue.value:null,sourceKind:winner?.sourceKind||null,
      expectedRevision:direct?.sourceRecordRevision||0,resolutionStatus:resolution.resultKind,reasonCode:resolution.reasonCode||null,resolutionRevision:resolution.revision,resolutionDigest:resolution.factDigest});
  }
  function readCurrentRating(targetType,targetId){const context=resolutionContext(targetType,targetId),resolution=store.getResolution(context.query.queryContract,context.query.queryInputDigest),direct=store.findCurrentTargetRating(targetType,targetId);
    let status=null;if(!currentResolution(context,resolution)){const value=resolutionWork(context,targetType,targetId,'rating'),base=workStatus(value.work.workId);
      status=base?.state==='failed'&&base.latestAttempt?.failure_code===RESOLUTION_INPUT_CONTRACT_REPAIR_CODE?workStatus(repairResolutionWork(value).workId):base;}
    const winner=resolution?.resultKind==='found'&&currentResolution(context,resolution)?store.getRecord(resolution.winningPerceptionId):null;
    return ratingProjection(context,resolution,winner,direct,status);}
  function readCurrentRatings(targetType,targetInputs){
    if(!Array.isArray(targetInputs)||typeof options.workResultReader.statusMany!=='function')throw new TypeError('Batched Rating projections require the bounded Work status reader.');
    const values=new Map();
    for(let offset=0;offset<targetInputs.length;offset+=100){
      const targets=targetInputs.slice(offset,offset+100).map(item=>typeof item==='string'?target(targetType,item):freeze({...item,targetType,targetId:item.targetId})),
        handles=targets.map(item=>queryHandle(queryFor(item),now(),targetType==='shelf_entry'?'arca':'libra')),
        contexts=assembler.assembleBatch({queryHandles:handles,ruleSnapshot}),rows=store.readCurrentResolvedRatings(contexts.map(item=>item.query.queryInputDigest)),
        byDigest=new Map(rows.map(item=>[item.queryInputDigest,item])),direct=store.findCurrentTargetRatings(targetType,targets.map(item=>item.targetId)),
        entries=contexts.map((context,index)=>{const row=byDigest.get(context.query.queryInputDigest),value=resolutionWork(context,targetType,targets[index].targetId,'rating');return {context,row,value,targetId:targets[index].targetId};}),
        unresolved=entries.filter(item=>!currentResolution(item.context,item.row?.resolution)),statuses=options.workResultReader.statusMany(unresolved.map(item=>item.value.work.workId)),
        repairs=unresolved.filter(item=>{const status=statuses.get(item.value.work.workId);return status?.state==='failed'&&status.latestAttempt?.failure_code===RESOLUTION_INPUT_CONTRACT_REPAIR_CODE;}),
        repairStatuses=options.workResultReader.statusMany(repairs.map(item=>repairResolutionWork(item.value).workId));
      for(const item of entries){const base=statuses.get(item.value.work.workId),status=base?.state==='failed'&&base.latestAttempt?.failure_code===RESOLUTION_INPUT_CONTRACT_REPAIR_CODE
        ?repairStatuses.get(repairResolutionWork(item.value).workId):base;
        values.set(item.targetId,ratingProjection(item.context,item.row?.resolution,item.row?.winner,direct.get(item.targetId),status));}
    }
    return values;}
  function readCurrentWatched(targetType,targetId){const context=resolutionContext(targetType,targetId,'watched'),
    resolution=store.getResolution(context.query.queryContract,context.query.queryInputDigest),direct=store.findCurrentTargetRating(targetType,targetId,'watched');
    if(!currentResolution(context,resolution)){
      const value=resolutionWork(context,targetType,targetId,'watched'),base=workStatus(value.work.workId),status=base?.state==='failed'&&base.latestAttempt?.failure_code===RESOLUTION_INPUT_CONTRACT_REPAIR_CODE
        ?workStatus(repairResolutionWork(value).workId):base,terminal=terminalResolutionWork(status);
      return freeze({state:terminal?.kind||'pending',watchedState:null,sourceKind:null,expectedRevision:direct?.sourceRecordRevision||0,
        resolutionStatus:null,reasonCode:terminal?.reasonCode||'resolution_pending',resolutionRevision:null,resolutionDigest:null});
    }
    const winner=resolution.resultKind==='found'?store.getRecord(resolution.winningPerceptionId):null;
    return freeze({state:'ready',watchedState:resolution.resultKind==='found'?resolution.resolvedValue.value:null,sourceKind:winner?.sourceKind||null,
      expectedRevision:direct?.sourceRecordRevision||0,resolutionStatus:resolution.resultKind,reasonCode:resolution.reasonCode||null,resolutionRevision:resolution.revision,resolutionDigest:resolution.factDigest});
  }
  const periodicAcquisition = createPerceptionAcquisitionAutomation({
    now, readDoubanSourceConfiguration: options.readDoubanSourceConfiguration,
    listAcquisitions: () => store.listAcquisitions(), requestAcquisition:command=>requestAcquisition(command,{executionOrigin:'periodic'}),
  });
  function acquisitionSchedulingClass(acquisitionId){
    const item=store.getAcquisition(acquisitionId);if(!item)throw new TypeError('Acquisition scheduling requires a known process.');
    const scope=JSON.parse(item.scopeJson);
    if(scope.mode==='direct')return 'normal';
    if(Object.hasOwn(scope,'executionOrigin')&&!['manual','periodic'].includes(scope.executionOrigin))throw Object.assign(new Error('Acquisition execution origin is invalid.'),{code:'PERCEPTION_ACQUISITION_ORIGIN_REQUIRED'});
    if(resumeIntent.hasResume(acquisitionId))return 'normal';
    const executionOrigin=scope.executionOrigin||proveLegacyPeriodicAcquisition(item,store.listAcquisitions())?.executionOrigin;
    if(!['manual','periodic'].includes(executionOrigin))throw Object.assign(new Error('Acquisition execution origin is missing.'),{code:'PERCEPTION_ACQUISITION_ORIGIN_REQUIRED'});
    return executionOrigin==='periodic'?'maintenance':'normal';
  }
  function syncState(){const config=options.readDoubanSourceConfiguration?.();if(!config)return freeze({latest:null,activeCount:0,
    completionState:'not_started',lastCursorOut:null,cursorRevision:0,committedPageCount:0,recordCount:0});
    const items=store.listAcquisitions().filter((item)=>item.perceptionSourceId===config.sourceId),latest=items[0]||null,
      activeCount=items.filter((item)=>item.state==='active').length,source=store.getSource(config.sourceId),
      cursor=source?.currentCursorRevision?store.getCursor(config.sourceId,source.currentCursorRevision):null,
      latestCursor=cursor?.perceptionAcquisitionId===latest?.perceptionAcquisitionId?cursor:null;
    const completionState=!latest?'not_started':activeCount>0?'in_progress':latest.state==='completed'&&!latestCursor?.hasMore?'complete':'incomplete';
    return freeze({latest,activeCount,completionState,lastCursorOut:latestCursor?.cursorOut||latest?.initialCursorValue||null,
      cursorRevision:source?.currentCursorRevision||0,committedPageCount:latest?Math.max(0,(source?.currentCursorRevision||0)-latest.initialCursorRevision):0,
      recordCount:store.countRecordsForSource(config.sourceId)});}
  return Object.freeze({store,ruleSnapshot,acquisitionContext,resolutionContext,resolutionProcessContext,reconcileAcquisition,reconcileResolution,reconcileSupersededResolution,supersededResolutionDisposition,reconcileImpactedSubjectResolutions,createRecord,requestAcquisition,ensureResolution,ensureTargetResolutions,resolveDecisionFact,
    readCurrentRating,readCurrentRatings,readCurrentWatched,listRecords:(query)=>store.listRecords(query),listAcquisitions:()=>store.listAcquisitions(),
    syncState,periodicAcquisition,acquisitionSchedulingClass});
}

module.exports=Object.freeze({createPerceptionProcessServices,queryFor,queryHandle,directSourceId,resolutionBasis,matchesResolutionBasis,RESOLUTION_INPUT_CONTRACT_REPAIR_CODE});
