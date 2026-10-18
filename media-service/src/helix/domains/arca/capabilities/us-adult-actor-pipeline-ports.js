'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const {CAPS,executionInput,effectClass,resultRef}=require('../model/us-adult-actor-pipeline');
const {executionScope}=require('../model/us-adult-actor-refresh-execution');
const {buildFacts,buildFilePlan}=require('../model/us-adult-actor-products');
const {buildInventoryChange,buildControlChanges}=require('../model/us-adult-actor-inventory-change');
const {renderUsAdultInventoryNfo}=require('../model/aftercare-nfo');
const {physicalIdentityFromInventoryRow,aftercareInventoryCommitId,aftercareInventoryCommitDigest}=require('../model/aftercare-contract');
const {createMaterialControlParticipant,controlScopeDigest}=require('../../../foundation/persistence/material-control');
const stable=(prefix,value)=>prefix+D(value).slice(0,40);
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_PHASE_PROOF_INVALID'});}
function createUsAdultActorPipelinePorts(options){
  const query=options.actorPipelineQuery,reader=options.aftercareContextReader,now=options.now||Date.now;
  function current(execution,action){
    const input=execution.namedInputs,caseId=input?.usAdultActorRefreshScope?.aftercareCaseId||input?.usAdultActorExecutionInput?.aftercareCaseId,
      snapshot=caseId&&query.inspect(execution.ownerScope?.processId,caseId),phase=snapshot?.stages[action],
      definition=options.workResultReader.readDefinition(execution.workId)?.definition;
    if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_shelf_entry'||execution.capabilityRef!==CAPS[action==='unchanged'?'close':action]||
        !phase||execution.workId!==phase.work.workId||canonicalJson(definition)!==canonicalJson(phase.work)||!query.assertAuthority(snapshot.intent.shelfEntryId,caseId))
      fail('Actor phase must execute its exact admitted Work and current Entry authority.');
    if(action==='assets'){
      const scope=executionScope({...snapshot,rootHandleRef:reader.store.aftercareWorkspaceRootSnapshot.rootHandleRef});
      if(canonicalJson(input.usAdultActorRefreshScope)!==canonicalJson(scope)||canonicalJson(input.usAdultActorRefreshSelection)!==canonicalJson(snapshot.selection)||
          canonicalJson(input.arcaUsAdultSourcePrepared)!==canonicalJson(snapshot.source.record.result))fail('Actor assets lost their exact frozen selection or source.');
    }else if(canonicalJson(input.usAdultActorExecutionInput)!==canonicalJson(executionInput(snapshot,action))||
        !['close','unchanged'].includes(action)&&canonicalJson(input.usAdultActorFilePlan)!==canonicalJson(snapshot.plan))
      fail('Actor phase input replaced its exact successful predecessor Results or File Plan.');
    return snapshot;
  }
  function outcome(execution,action,result,at,verification=D(result)){
    const cap=CAPS[action==='unchanged'?'close':action],base='helix://contracts/capabilities/'+cap.replace('@1','/v1/'),digest=D(result),
      value={kind:'succeeded',resultSchemaRef:base+'result',result,evidenceSchemaRef:base+'evidence',evidence:{
        evidenceId:stable('arca-us-phase-evidence-',{eventId:execution.eventId,digest}),evidenceKind:'us_adult_actor_'+action,producerRef:cap,
        basisDigest:options.workResultReader.readDefinition(execution.workId).definition.executionBasisDigest,payloadDigest:digest,observedAtMs:at}};
    if(effectClass(action)!=='pure_observation')value.effectReceipt={schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
      effectReceiptId:stable('arca-us-phase-receipt-',{eventId:execution.eventId}),effectId:D([effectClass(action),execution.idempotencyKey]),
      effectClass:effectClass(action),idempotencyKey:execution.idempotencyKey,commitMarker:stable('arca-us-phase-marker-',{eventId:execution.eventId}),
      externalReceiptRef:null,outputDigest:digest,verificationEvidenceDigest:verification,committedAtMs:at};
    options.contractValidator.validate(value.resultSchemaRef,result);options.contractValidator.validate(value.evidenceSchemaRef,value.evidence);
    if(value.effectReceipt)options.contractValidator.validate(value.effectReceipt.schemaRef,value.effectReceipt);return value;
  }
  function binding(execution,value,snapshot){return {executionReference:{workId:execution.workId,eventAttemptId:execution.eventAttemptId,capabilityRef:execution.capabilityRef,
    shelfEntryId:snapshot.intent.shelfEntryId,intentDigest:snapshot.intent.intentDigest,predecessors:[snapshot.source.record,...snapshot.matching.map(item=>item.record).filter(Boolean),
      ...Object.values(snapshot.stages).map(item=>item.record).filter(Boolean)].map(item=>({workId:item.workId,eventId:item.eventId,resultId:item.resultId,
        capabilityRef:item.capabilityRef,resultSchemaRef:item.resultSchemaRef,resultDigest:item.resultDigest}))},resultId:stable('arca-us-phase-result-',{eventId:execution.eventId}),eventId:execution.eventId,outcomeKind:'succeeded',
    resultSchemaRef:value.resultSchemaRef,result:value.result,evidenceSchemaRef:value.evidenceSchemaRef,evidence:value.evidence,
    effectReceiptId:value.effectReceipt.effectReceiptId,effectReceipt:value.effectReceipt};}
  function fileResult(snapshot,action,receipt,at){const {intent,care,selection,plan}=snapshot,body={
    aftercareCaseId:care.aftercareCaseId,shelfEntryId:intent.shelfEntryId,intentId:intent.intentId,intentDigest:intent.intentDigest,
    selectionDigest:selection.selectionDigest,planDigest:plan.planDigest,action,receipt,receiptDigest:D(receipt)};
    return {schemaRef:'helix://contracts/types/ArcaUsAdultFileReceipt/v1',schemaVersion:1,evidenceId:stable('arca-us-file-evidence-',body),
      evidenceKind:'us_adult_actor_'+action,producerRef:CAPS[action],basisDigest:intent.intentDigest,payloadDigest:D(body),observedAtMs:at,...body};}
  async function assets(execution,snapshot,port){
    const {intent,care,context,selection}=snapshot,facts=buildFacts(context,selection),
      row=context.raw.materials.find(item=>item.role==='metadata_sidecar'),target=reader.sourceTargetBinding(intent.shelfEntryId,row),
      existingBytes=port.readNfo({rootLocation:target.rootLocation,location:row.location,physicalIdentity:physicalIdentityFromInventoryRow(row)}),
      nfo=renderUsAdultInventoryNfo({metadata:facts.metadata,actor:facts.actor,existingBytes}),
      poster=await port.renderPoster({selection,sourceResult:snapshot.source.record.result});
    current(execution,'assets');
    for(const name of ['metadata','cast'])options.contractValidator.validate(facts[name].schemaRef,facts[name]);
    const nfoHandle=port.writeMember('nfo',nfo.bytes),posterHandle=port.writeMember('poster',poster.bytes||poster),
      factsHandle=port.writeMember('facts',Buffer.from(canonicalJson({selection,metadata:facts.metadata,cast:facts.cast}))),
      plan=buildFilePlan({context,selection,outputs:{nfoHandle,posterHandle},inventoryPort:options.inventoryPort,
        sourceTargetBinding:reader.sourceTargetBinding,atMs:now()});
    options.contractValidator.validate(plan.schemaRef,plan);
    const planHandle=port.writeMember('plan',Buffer.from(canonicalJson(plan))),at=now(),body={aftercareCaseId:care.aftercareCaseId,
      shelfEntryId:intent.shelfEntryId,intentId:intent.intentId,intentDigest:intent.intentDigest,selectionDigest:selection.selectionDigest,
      sourceResultDigest:snapshot.source.record.resultDigest,factsHandle,nfoHandle,posterHandle,planHandle,planDigest:plan.planDigest},
      result={schemaRef:'helix://contracts/types/ArcaUsAdultAssetsPrepared/v1',schemaVersion:1,evidenceId:stable('arca-us-assets-',body),
        evidenceKind:'us_adult_actor_assets',producerRef:CAPS.assets,basisDigest:intent.intentDigest,payloadDigest:D(body),observedAtMs:at,...body};
    return outcome(execution,'assets',result,at);
  }
  async function commit(execution,snapshot,port,settings){
    const {intent,care,context,selection,plan,facts}=snapshot,manifest=snapshot.stages.stage.record.result.receipt,
      verification=await port.files.verify(plan,manifest,settings);
    if(D(verification)!==D(snapshot.stages.verify.record.result.receipt))fail('Physical targets changed after final Verification.');
    current(execution,'commit');
    const at=now(),change=buildInventoryChange({context,intent,selection,plan,facts,verification,committedAtMs:at}),
      keys=[...new Set([...context.raw.materials,...change.materials].map(row=>row.material_key))].sort(),projections=[];
    for(let offset=0;offset<keys.length;offset+=500)projections.push(...options.materialControlProjectionPort.getMaterialControlProjections(keys.slice(offset,offset+500)));
    const changes=buildControlChanges({context,change,projections}),controlChangeDigest=controlScopeDigest(changes),request={...change,controlChangeDigest},
      result={schemaRef:'helix://contracts/types/AftercareInventoryCommitReceipt/v1',schemaVersion:1,receiptId:aftercareInventoryCommitId(request),
        receiptKind:'aftercare_inventory_committed',ownerDomain:'arca',scopeType:'shelf_entry',scopeId:intent.shelfEntryId,scopeDigest:care.careBasisDigest,
        effectReceiptRef:stable('arca-us-phase-receipt-',{eventId:execution.eventId}),committedAtMs:at,aftercareCaseId:care.aftercareCaseId,
        shelfEntryId:intent.shelfEntryId,previousInventoryRevision:intent.inventoryRevision,newInventoryRevision:intent.inventoryRevision+1,controlChangeDigest},
      value=outcome(execution,'commit',result,at,aftercareInventoryCommitDigest(request,D(result))),participants=[];
    for(let offset=0;offset<changes.length;offset+=1024){const page=changes.slice(offset,offset+1024),handle={
      schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:stable('arca-us-control-',{eventId:execution.eventId,offset}),
      operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_shelf_entry',processId:intent.shelfEntryId,
      basisRef:{objectType:'us_adult_actor_refresh_intent',objectId:intent.intentId,revision:1,digest:intent.intentDigest},basisDigest:intent.intentDigest,
      canonicalFactSetDigest:D(facts),bindingSetDigest:verification.finalRealityDigest,controlScopeDigest:controlScopeDigest(page),
      expectedControlRevisions:page.map(item=>({materialKey:item.identity.materialKey,revision:item.expectedRevision})),
      receiptContract:{receiptSchemaRef:resultRef('commit'),controlRevisionSetSchemaRef:'arca.control-revision-set@1'},eventFenceDigest:D({workId:execution.workId,eventId:execution.eventId})};
      options.contractValidator.validate(handle.schemaRef,handle);participants.push(createMaterialControlParticipant({...options,
        participantId:'arca_us_actor_control_'+offset,handle,changes:page,authorizedScopeDigest:handle.controlScopeDigest,commitMarker:value.effectReceipt.commitMarker}));}
    reader.store.commitInventory({...request,actorRefreshProof:{intentDigest:intent.intentDigest,careBasisDigest:care.careBasisDigest,
      canonicalIdentityRevision:intent.canonicalIdentityRevision,deckFactRevision:intent.deckFactRevision,standardRevision:care.careBasis.standardRevision,
      placementRevision:care.careBasis.placementRevision,representationDigest:intent.representationDigest},resultBinding:binding(execution,value,snapshot)},participants);return value;
  }
  function close(execution,action,snapshot){
    const {intent,care,stages}=snapshot,unchanged=action==='unchanged',at=now(),
      evidenceDigest=D(unchanged?{intentDigest:intent.intentDigest,completion:snapshot.completion}:
        {intentDigest:intent.intentDigest,commitResultDigest:stages.commit.record.resultDigest,retirementResultDigest:stages.retire.record.resultDigest}),
      body={schemaRef:'helix://contracts/types/AftercareCaseResult/v1',schemaVersion:1,factId:stable('arca-us-case-fact-',{eventId:execution.eventId}),
        ownerDomain:'arca',aggregateType:'aftercare_case',aggregateId:care.aftercareCaseId,revision:1,
        factSchemaRef:'helix://contracts/types/AftercareCaseResult/v1',commitMarker:stable('arca-us-phase-marker-',{eventId:execution.eventId}),committedAtMs:at,
        aftercareCaseId:care.aftercareCaseId,resultState:'resolved',reassessmentDigest:evidenceDigest,
        inventoryEffectRefs:unchanged?[]:[stages.commit.record.result.effectReceiptRef]},result={...body,factDigest:D(body)},
      value=outcome(execution,action,result,at,evidenceDigest);
    reader.store.terminateCase(care.aftercareCaseId,'resolved',unchanged?'actor_match_unchanged':'actor_refresh_completed',evidenceDigest,binding(execution,value,snapshot));return value;
  }
  return Object.freeze(Object.fromEntries(Object.keys(CAPS).map(action=>[CAPS[action],Object.freeze({
    async observeEffectReality(context){
      const fact=['commit','close'].includes(action),committing=action==='commit';
      try{
        const work=options.workResultReader.readDefinition(context.work?.work_id)?.definition,
          caseId=work?.dependencyRefs.find(item=>item.objectType==='aftercare_case')?.objectId,
          phase=action==='close'&&work?.workObjectiveTypeRef==='helix://arca/work/us_adult_actor_unchanged/v1'?'unchanged':action,
          snapshot=caseId&&query.inspect(context.work.process_id,caseId);
        if(!snapshot||context.work.owner_domain!=='arca'||context.work.process_type!=='arca_shelf_entry'||context.event?.work_id!==work.workId||
            context.event.capability_ref!==CAPS[action]||context.effect?.effect_class!==effectClass(phase)||
            canonicalJson(snapshot.stages[phase]?.work)!==canonicalJson(work)||!query.assertAuthority(snapshot.intent.shelfEntryId,caseId))
          fail('Effect recovery is outside its exact Actor Work and current Case authority.');
        if(fact){
          if(snapshot.care.state!=='active'||committing&&snapshot.context.raw.entry.current_inventory_revision!==snapshot.intent.inventoryRevision)
            fail('Uncommitted Actor facts cannot reuse a later Inventory or terminal Case.');
          return {status:committing?'whole_absent':'absent',fenceValid:true,...(!committing?{revisionMatches:false}:{}),
            evidenceDigest:D({schema:'arca.us-adult-fact-recovery@1',intentDigest:snapshot.intent.intentDigest,action,input:executionInput(snapshot,phase)})};
        }
        const port=query.portFor(snapshot),proof=await port.files.observe(snapshot.plan,snapshot.stages.stage?.record?.result.receipt,action,{
          shouldContinue:()=>query.assertAuthority(snapshot.intent.shelfEntryId,caseId)});
        return {status:'forward_required',rollbackDeclared:false,evidenceDigest:D(proof)};
      }catch(error){return {status:'conflict',...(fact?{fenceValid:false,...(!committing?{revisionMatches:false}:{})}:{rollbackDeclared:false}),
        evidenceDigest:D({schema:'arca.us-adult-phase-recovery-conflict@1',action,eventId:context.event?.event_id||null,code:error.code||'ARCA_US_ADULT_RECOVERY_CONFLICT'})};}
    },
    validateInputs(execution){return current(execution,action==='close'&&execution.namedInputs?.usAdultActorExecutionInput?.action==='unchanged'?'unchanged':action);},
    async execute(execution){
      const phase=action==='close'&&execution.namedInputs?.usAdultActorExecutionInput?.action==='unchanged'?'unchanged':action,
        snapshot=current(execution,phase);
      if(phase==='close'||phase==='unchanged')return close(execution,phase,snapshot);
      const port=query.portFor(snapshot,execution),settings={recoveryDecision:execution.recoveryDecision,shouldContinue:()=>{
        execution.assertExecutionActive();return query.assertAuthority(snapshot.intent.shelfEntryId,snapshot.care.aftercareCaseId);}};
      if(phase==='assets')return assets(execution,snapshot,port);
      if(phase==='commit'){
        try{return await commit(execution,snapshot,port,settings);}
        catch(error){if(error.code==='P3_JCS_NON_JSON_VALUE'&&typeof error.details?.path==='string')
          error.message+=' Actor Inventory field: '+error.details.path;throw error;}
      }
      const manifest=snapshot.stages.stage?.record?.result.receipt;let receipt;
      try{receipt=phase==='stage'?await port.files.stage(snapshot.plan,settings):phase==='retire'?
          await port.files.retire(snapshot.plan,manifest,{...settings,inventoryCommitted:true}):await port.files[phase](snapshot.plan,manifest,settings);}
      catch(error){
        if(phase==='publish'&&!execution.recoveryDecision&&error.details?.effectWriteStarted===false&&error.details.boundary==='before_publication'&&
            ['ARCA_US_ADULT_TARGET_CONFLICT','ARCA_US_ADULT_FILE_CHANGED','ARCA_US_ADULT_FILE_ESCAPE'].includes(error.code))
          return {kind:'failed',failureClass:'placement_precondition',code:error.code,message:'Actor publication stopped before changing any files.',
            retryDirective:'never',evidence:{aftercareCaseId:snapshot.care.aftercareCaseId,planDigest:snapshot.plan.planDigest,
              errorCode:error.code,effectWriteStarted:false,boundary:'before_publication'}};
        throw error;
      }
      const at=now();
      return outcome(execution,phase,fileResult(snapshot,phase,receipt,at),at);
    },validateResult(execution,value){
      options.contractValidator.validate(resultRef(action),value.result);
      const snapshot=query.inspect(execution.ownerScope.processId,value.result.aftercareCaseId);
      if(value.result.aftercareCaseId!==snapshot.care.aftercareCaseId)fail('Actor phase Result changed its original Case.');
      if(action==='commit'&&snapshot.context.raw.entry.current_inventory_revision!==snapshot.intent.inventoryRevision+1||
          action==='close'&&snapshot.care.state!=='resolved')fail('Actor commit Result is not backed by its durable Owner facts.');
    },
  })])));
}
module.exports=Object.freeze({createUsAdultActorPipelinePorts});
