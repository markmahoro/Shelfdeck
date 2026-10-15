'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createJavCorrectionAssetsPreparation}=require('./jav-correction-assets-preparation');
const {CAPABILITY,SCOPE_SCHEMA,RESULT_SCHEMA,SOURCE_CAPABILITY,SOURCE_SCHEMA,STAGE_CAPABILITY,PUBLISH_CAPABILITY,VERIFY_CAPABILITY,javCorrectionPublishWorkId,javCorrectionAssetsWorkId,javCorrectionFilesWorkId,buildJavCorrectionScope,buildJavCorrectionSourceVerified,assertJavCorrectionVerifiedSource}=require('../model/jav-correction-execution-contract');
const {createStagedManifestStore}=require('../persistence/staged-manifest-store');
const {createInventoryVerificationStore}=require('../persistence/inventory-verification-store');
const {createJavCorrectionCommitStore}=require('../persistence/jav-correction-commit-store');
const {javCorrectionVerifyWorkId}=require('../model/jav-correction-execution-contract');
const {correctionCommitWorkId}=require('../model/jav-correction-commit-contract');
const {CAPABILITY:COMMIT_CAPABILITY,SCHEMA:COMMIT_SCHEMA}=require('../model/jav-correction-commit-contract');
const {CAPABILITY:RETIREMENT_CAPABILITY}=require('../model/jav-correction-retirement-contract');
const {createJavCorrectionRetirementPort}=require('./jav-correction-retirement-port');
const {CAPABILITY:RECLAIM_CAPABILITY}=require('../model/jav-correction-workspace-reclaim-contract');
const {createJavCorrectionWorkspaceReclaimPort}=require('./jav-correction-workspace-reclaim-port');
const {buildJavCorrectionProposal}=require('../model/jav-identity-correction');
const {buildJavCorrectionMetadata,verifyJavCorrectionNfo}=require('../model/jav-correction-metadata');
const {assertJavCoverDerivation}=require('../../../contracts/jav-cover-derivation');
const {buildJavSelectedSource}=require('../../../contracts/jav-selected-source');
const {RECOVERY_SOURCE_PROJECTION,readJavCorrectionSourceResult}=require('../model/jav-correction-source-result');
const BASE='helix://contracts/capabilities/';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const stable=(name,value)=>name+canonicalDigest(value).slice(0,40);
function createJavCorrectionCapabilityPorts(options) {
  const now=options.now||Date.now,validator=options.contractValidator;
  function recordFor(execution) {
    const scope=execution.namedInputs?.javCorrectionScope;validator.validate(SCOPE_SCHEMA,scope);
    const record=options.correctionStore.get(scope.correctionId),expected=record&&buildJavCorrectionScope(record,options.rootSnapshot.rootHandleRef);
    if(!expected||canonicalDigest(expected)!==canonicalDigest(scope)||execution.ownerScope?.domain!=='arca'||
        execution.ownerScope.processType!=='arca_jav_identity_correction'||execution.ownerScope.processId!==scope.correctionId)
      fail('ARCA_JAV_CORRECTION_SCOPE_STALE','Correction execution does not match its current exact admission.');
    options.assertCurrentCorrectionScope(record,scope);return {record,scope};
  }
  function sourceHandle(record,operationId) {
    const q=record.proof.proposal.sourceQualification,source=q.sourceSnapshot.sources[q.sourceOrdinal];
    const handle=options.resolveJavSourceHandle({siteRef:source.siteRef,operationId,...(operationId===CAPABILITY?{artifactKind:'fanart'}:{})});
    if(!handle||handle.integrationType!=='jav_source'||handle.allowedOperation!==operationId||
        ['integrationId','configRevision','siteRef','authMode','endpointProfileDigest','networkRouteDigest'].some(key=>handle[key]!==source[key]))
      fail('ARCA_JAV_CORRECTION_SOURCE_STALE','Correction Integration Handle differs from its frozen selected source.');
    return handle;
  }
  function preparedMembers(prepared) {
    return [{kind:'metadata',bytes:Buffer.from(canonicalJson(prepared.metadata),'utf8')},{kind:'nfo',bytes:prepared.nfo.bytes},
      ...prepared.pictures.map(item=>({kind:item.artifactKind,bytes:item.bytes}))];
  }
  async function prepareBytes(record,q,handle,operationId) {
    const service=createJavCorrectionAssetsPreparation({deriveJavCoverBytes:options.deriveJavCoverBytes,acquireQualifiedCover:async()=>{
      const fresh=await options.acquireJavCover({siteRef:handle.siteRef,operationId,integrationHandle:sourceHandle(record,operationId),
        input:{queryAnchor:q.sourceSnapshot.queryAnchor,qualifiedObservation:q.observation,artifactKind:'fanart'},timeoutMs:30000});
      return {coverBytes:fresh.coverBytes,observation:q.observation};
    }});
    return service.prepare(record);
  }
  function outcome(capabilityRef,result,scope,effectClass=null,execution=null) {
    const at=result.observedAtMs??execution?.effectOccurredAtMs??now(),evidence={evidenceId:stable('arca-correction-evidence-',{capabilityRef,result}),evidenceKind:'jav_identity_correction',
      producerRef:capabilityRef,basisDigest:scope.digest,payloadDigest:canonicalDigest(result),observedAtMs:at},
      value={kind:'succeeded',resultSchemaRef:BASE+capabilityRef.replace('@1','/v1/result'),result,
        evidenceSchemaRef:BASE+capabilityRef.replace('@1','/v1/evidence'),evidence};
    if(effectClass)value.effectReceipt={schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
      effectReceiptId:stable('arca-correction-effect-receipt-',{eventId:execution.eventId}),effectId:canonicalDigest([effectClass,execution.idempotencyKey]),
      effectClass,idempotencyKey:execution.idempotencyKey,commitMarker:stable('arca-correction-effect-marker-',{eventId:execution.eventId}),externalReceiptRef:null,
      outputDigest:canonicalDigest(result),verificationEvidenceDigest:canonicalDigest(evidence),committedAtMs:at};
    return Object.freeze(value);
  }
  const sourcePort=Object.freeze({validateInputs:recordFor,async execute(execution) {
    const {record,scope}=recordFor(execution),handle=sourceHandle(record,SOURCE_CAPABILITY),q=record.proof.proposal.sourceQualification;
    const observation=await options.observeJavSource({siteRef:handle.siteRef,operationId:SOURCE_CAPABILITY,integrationHandle:handle,
      input:{queryAnchor:q.sourceSnapshot.queryAnchor,resourceKey:q.observation.resourceKey},timeoutMs:30000});
    recordFor(execution);const prepared=await prepareBytes(record,{...q,observation},handle,SOURCE_CAPABILITY);
    recordFor(execution);const result=buildJavCorrectionSourceVerified(record,scope,observation,now(),options.workspaceIo.describe(preparedMembers(prepared)));validator.validate(SOURCE_SCHEMA,result);
    return outcome(SOURCE_CAPABILITY,result,scope);
  },validateResult(execution,value){validator.validate(SOURCE_SCHEMA,value.result);assertJavCorrectionVerifiedSource(recordFor(execution).record,execution.namedInputs.javCorrectionScope,value.result);}});
  const assetsPort=Object.freeze({validateInputs(execution){const {record,scope}=recordFor(execution);validator.validate(SOURCE_SCHEMA,execution.namedInputs.javCorrectionSourceVerified);
    assertJavCorrectionVerifiedSource(record,scope,execution.namedInputs.javCorrectionSourceVerified);sourceHandle(record,CAPABILITY);},
  async execute(execution) {
    const {record,scope}=recordFor(execution),verified=assertJavCorrectionVerifiedSource(record,scope,execution.namedInputs.javCorrectionSourceVerified),
      handle=sourceHandle(record,CAPABILITY),q=verified.qualification,prepared=await prepareBytes(record,q,handle,CAPABILITY),workspace=options.workspaceStore;
    if(canonicalDigest(options.workspaceIo.describe(preparedMembers(prepared)))!==canonicalDigest(verified.byteExpectations))
      fail('ARCA_JAV_CORRECTION_ASSET_RECIPE_CHANGED','Correction bytes differ from the frozen source recipe.');
    recordFor(execution);workspace.ensure(record.correctionId,record.admissionDigest);
    const write=(kind,bytes)=>{const value=options.workspaceIo.write({correctionId:record.correctionId,admissionDigest:record.admissionDigest,kind,bytes,
      recoveryDecision:execution.recoveryDecision,
      shouldContinue:()=>{recordFor(execution);return typeof execution.shouldContinue!=='function'||execution.shouldContinue()===true;}});
      workspace.register(record.correctionId,record.admissionDigest,value.workspaceMaterialHandle,value.artifactHandle);return value;},
      metadata=write('metadata',Buffer.from(canonicalJson(prepared.metadata),'utf8')),nfo=write('nfo',prepared.nfo.bytes),
      artifacts=[{artifactKind:'nfo',...nfo,coverDerivation:null},...prepared.pictures.map(picture=>({artifactKind:picture.artifactKind,...write(picture.artifactKind,picture.bytes),coverDerivation:picture.derivation}))],
      payload={correctionId:record.correctionId,admissionDigest:record.admissionDigest,confirmedProposalDigest:verified.confirmedProposalDigest,
        actualProposalDigest:verified.actualProposalDigest,sourceObservationDigest:q.observation.observationDigest,metadataFactDigest:prepared.metadata.factDigest,
        metadataHandle:metadata.workspaceMaterialHandle,artifacts},payloadDigest=canonicalDigest(payload),result={schemaRef:RESULT_SCHEMA,schemaVersion:1,
        evidenceId:stable('arca-correction-prepared-',payload),evidenceKind:'jav_correction_assets_prepared',producerRef:CAPABILITY,basisDigest:scope.digest,
        payloadDigest,observedAtMs:now(),...payload};
    recordFor(execution);validator.validate(RESULT_SCHEMA,result);return outcome(CAPABILITY,result,scope,'workspace_write',execution);
  },async observeEffectReality(context) {
    try {
      if(context.work?.owner_domain!=='arca'||context.work.process_type!=='arca_jav_identity_correction'||context.event?.capability_ref!==CAPABILITY||
          context.event.work_id!==context.work.work_id||context.node?.capability_ref!==CAPABILITY||context.effect?.effect_class!=='workspace_write')
        fail('ARCA_JAV_CORRECTION_RECOVERY_SCOPE_INVALID','Correction recovery context differs from its exact Work and Event.');
      const bindings=JSON.parse(context.node.input_bindings_json).bindings,
        binding=bindings.find(item=>item.portName==='javCorrectionSourceVerified'),record=options.correctionStore.get(context.work.process_id),
        scope=buildJavCorrectionScope(record,options.rootSnapshot.rootHandleRef),
        recovered=binding?.bindingKind==='projected_owner_facts'&&binding.projectionRef===RECOVERY_SOURCE_PROJECTION&&record.recoveryIntent?.sourceResultReference,
        source=recovered?readJavCorrectionSourceResult({...options,record,scope}):null,
        rows=source?[source]:options.workResultReader.read(context.work.work_id).filter(item=>item.eventId===binding?.eventId&&item.outcomeKind==='succeeded'),
        verified=rows.length===1?rows[0].result:null;
      if((!recovered&&(binding?.bindingKind!=='projected_event_result'||binding?.resultSchemaRef!==BASE+SOURCE_CAPABILITY.replace('@1','/v1/result')))||
          binding?.parameters?.expectedScopeDigest!==scope.digest||rows.length!==1||rows[0]?.capabilityRef!==SOURCE_CAPABILITY||
          rows[0]?.resultSchemaRef!==BASE+SOURCE_CAPABILITY.replace('@1','/v1/result'))
        fail('ARCA_JAV_CORRECTION_RECOVERY_SCOPE_INVALID','Recovery source is not the exact frozen successful predecessor Event.');
      validator.validate(SOURCE_SCHEMA,verified);assertJavCorrectionVerifiedSource(record,scope,verified);options.assertCurrentCorrectionScope(record,scope);
      return options.workspaceIo.observe({correctionId:record.correctionId,byteExpectations:verified.byteExpectations,
        registry:options.workspaceStore.inspect(record.correctionId,record.admissionDigest)});
    } catch(error) {
      return {status:'conflict',cleanupDeclared:false,evidenceDigest:canonicalDigest({schema:'arca.jav-correction-workspace-recovery-conflict@1',
        correctionId:context.work?.process_id||null,eventId:context.event?.event_id||null,reasonCode:error.code||'ARCA_JAV_CORRECTION_RECOVERY_INVALID'})};
    }
  },validateResult(execution,value){validator.validate(RESULT_SCHEMA,value.result);const {record,scope}=recordFor(execution),result=value.result,
      verified=assertJavCorrectionVerifiedSource(record,scope,execution.namedInputs.javCorrectionSourceVerified),
      q=verified.qualification,proposal=buildJavCorrectionProposal({basis:record.proof.basis,...q}),
      metadata=buildJavCorrectionMetadata({correctionId:record.correctionId,admissionDigest:record.admissionDigest,basis:record.proof.basis,proposal}),
      selected=buildJavSelectedSource(q),payload=Object.fromEntries(['correctionId','admissionDigest','confirmedProposalDigest','actualProposalDigest',
        'sourceObservationDigest','metadataFactDigest','metadataHandle','artifacts'].map(key=>[key,result[key]]));
    if(result.correctionId!==record.correctionId||result.admissionDigest!==record.admissionDigest||result.basisDigest!==scope.digest||
        result.confirmedProposalDigest!==verified.confirmedProposalDigest||result.actualProposalDigest!==verified.actualProposalDigest||
        result.sourceObservationDigest!==q.observation.observationDigest||result.metadataFactDigest!==metadata.factDigest||
        result.payloadDigest!==canonicalDigest(payload)||result.evidenceId!==stable('arca-correction-prepared-',payload)||
        result.metadataHandle.relativePath!=='metadata/metadata.json'||result.artifacts.map(item=>item.artifactKind).join(',')!=='nfo,poster,fanart')
      fail('ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID','Prepared assets must conserve the frozen source Result and exact ordered artifacts.');
    options.workspaceStore.resolve(record.correctionId,record.admissionDigest,result.metadataHandle);
    const handles=[result.metadataHandle,...result.artifacts.map(item=>item.workspaceMaterialHandle)];
    if(handles.some((handle,index)=>handle.digestHex!==verified.byteExpectations[index].byteDigest||handle.sizeBytes!==verified.byteExpectations[index].sizeBytes))
      fail('ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID','Prepared bytes differ from the frozen source recipe.');
    for(const item of result.artifacts) {
      const resolved=options.workspaceStore.resolve(record.correctionId,record.admissionDigest,item.workspaceMaterialHandle),artifact=item.artifactHandle,
        handle=item.workspaceMaterialHandle;
      if(artifact.artifactKind!==item.artifactKind||artifact.ownerDomain!=='arca'||artifact.ownerScope.scopeType!=='jav_identity_correction'||
          artifact.ownerScope.scopeId!==record.correctionId||artifact.digestHex!==handle.digestHex||artifact.sizeBytes!==handle.sizeBytes||
          artifact.storageRef!==resolved.location.split('\\').join('/')||artifact.provenanceRef.objectType!=='jav_identity_correction'||
          artifact.provenanceRef.objectId!==record.correctionId||artifact.provenanceRef.digest!==record.admissionDigest||
          handle.relativePath!=={nfo:'nfo/movie.nfo',poster:'poster/poster.jpg',fanart:'fanart/fanart.jpg'}[item.artifactKind])
        fail('ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID','Prepared artifact bytes and provenance differ from their registered Workspace material.');
      if(item.artifactKind==='nfo') {
        if(item.coverDerivation!==null)fail('ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID','NFO must not claim cover derivation.');
      } else {
        const derivation=assertJavCoverDerivation(item.coverDerivation);
        if(derivation.kind!==item.artifactKind||derivation.javSelectedSource.bindingDigest!==selected.bindingDigest||
            derivation.sourceObservationDigest!==q.observation.observationDigest||derivation.outputDigest!==handle.digestHex)
          fail('ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID','Prepared image derivation differs from its exact frozen source and output.');
      }
    }
  }});
  const stageStore=options.formalFiles?createStagedManifestStore(options):null,
    stagePlan=execution=>{const {record,scope}=recordFor(execution);return {record,scope,plan:options.filePlanPreparation.prepare(record.correctionId,javCorrectionAssetsWorkId(scope,record))};},
    stagePort=Object.freeze({validateInputs:stagePlan,async execute(execution) {
      const {record,scope,plan}=stagePlan(execution),staged=await options.formalFiles.stage(plan,{shouldContinue:()=>{
        recordFor(execution);execution.assertExecutionActive?.();return true;
      }}),raw=options.correctionContextReader.read(record.correctionId).context.raw,
        stagedMembers=staged.members.map(member=>{
          const planned=plan.members[member.ordinal],row=raw.materials.find(row=>row.material_key===planned.original.physicalIdentity.materialKey);
          return {sourceMaterialKey:planned.source.kind==='correction_artifact'?planned.source.workspaceMaterialHandle.materialKey:planned.original.physicalIdentity.materialKey,
            physicalIdentity:member.physicalIdentity,role:member.role,endpointId:member.endpointId,location:member.location,bindingRevision:1,
            fullByteDigest:member.byteDigest,episodeClaims:{...JSON.parse(row.episode_claims_json),episodeClaimSetDigest:row.episode_claim_set_digest}};
        }),body={schemaRef:'helix://contracts/types/StagedInventoryManifest/v1',schemaVersion:1,manifestId:stable('arca-jav-correction-staged-',{eventId:execution.eventId}),
          manifestKind:'staged_inventory',ownerDomain:'arca',memberCount:stagedMembers.length,membersDigest:canonicalDigest({schema:'arca.staged-inventory-members@1',items:stagedMembers}),
          publishedAtMs:execution.effectOccurredAtMs??now(),targetCommitSlotId:stable('arca-jav-correction-slot-',{correctionId:record.correctionId,planDigest:plan.planDigest}),
          stagedMembers,sourceProductManifestDigest:plan.planDigest},manifest={...body,manifestDigest:canonicalDigest(body)};
      recordFor(execution);const result=stageStore.save(execution,manifest,plan);return outcome(STAGE_CAPABILITY,{...result},scope,'material_commit',execution);
    },validateResult(execution,value){const {plan}=stagePlan(execution);validator.validate('helix://contracts/types/StagedInventoryManifestRecord/v1',value.result);
      const manifest=stageStore.resolve(value.result);
      if(manifest.sourceProductManifestDigest!==plan.planDigest||manifest.memberCount!==plan.members.length)
        fail('ARCA_JAV_CORRECTION_STAGE_RESULT_INVALID','Stage Result does not conserve its complete frozen File Plan.');
    },observeEffectReality:context=>observeFilesReality(context,false)});
  function completedStage(c) {
    const workId=javCorrectionFilesWorkId(c.scope,c.plan.planDigest,c.record),status=options.workResultReader.status(workId);
    if(status?.state!=='succeeded'||status.owner_domain!=='arca'||status.process_type!=='arca_jav_identity_correction'||status.process_id!==c.record.correctionId)
      fail('ARCA_JAV_CORRECTION_STAGE_NOT_READY','Publication requires the exact completed staging Work.');
    const rows=options.workResultReader.read(workId).filter(item=>item.capabilityRef===STAGE_CAPABILITY&&item.outcomeKind==='succeeded');
    if(rows.length!==1)fail('ARCA_JAV_CORRECTION_STAGE_NOT_READY','Publication requires one exact successful stage Result.');
    const manifest=stageStore.resolve(rows[0].result);
    if(manifest.sourceProductManifestDigest!==c.plan.planDigest)fail('ARCA_JAV_CORRECTION_STAGE_NOT_READY','Staged Manifest differs from the frozen File Plan.');
    return {...c,manifest};
  }
  const publicationPlan=execution=>completedStage(stagePlan(execution));
  async function observeFilesReality(context,publishing){
    try{
      const capability=publishing?PUBLISH_CAPABILITY:STAGE_CAPABILITY,kind=publishing?'jav_correction_publish':'jav_correction_files',
        c=options.correctionContextReader.read(context.work?.process_id),work=options.workResultReader.status(context.work?.work_id);
      if(!c||work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==c.record.correctionId||work.work_kind!==kind||
          work.basis_digest!==c.scope.digest||context.event?.work_id!==context.work.work_id||context.event.capability_ref!==capability||
          context.node?.capability_ref!==capability||context.effect?.effect_class!=='material_commit')throw new Error('File recovery scope mismatch.');
      const plan=options.filePlanPreparation.prepare(c.record.correctionId,javCorrectionAssetsWorkId(c.scope,c.record)),
        expected=publishing?javCorrectionPublishWorkId(c.scope,plan.planDigest,c.record):javCorrectionFilesWorkId(c.scope,plan.planDigest,c.record);
      if(context.work.work_id!==expected)throw new Error('File recovery Work differs from its admitted lineage.');
      const controls={shouldContinue:()=>{options.correctionContextReader.assertCurrent(c.record,c.scope);return true;},recoveryDecision:'continue_forward'};
      if(publishing)await options.formalFiles.preflightPublish(plan,completedStage({...c,plan}).manifest,controls);
      else await options.formalFiles.preflightStage(plan,controls);
      return {status:'forward_required',rollbackDeclared:false,evidenceDigest:canonicalDigest({correctionId:c.record.correctionId,scopeDigest:c.scope.digest,
        planDigest:plan.planDigest,workId:context.work.work_id,eventId:context.event.event_id})};
    }catch(error){return {status:'conflict',rollbackDeclared:false,evidenceDigest:canonicalDigest({schema:'arca.jav-correction-file-recovery-conflict@1',
      workId:context.work?.work_id||null,eventId:context.event?.event_id||null,reasonCode:error.code||'ARCA_JAV_CORRECTION_FILE_PLAN_INVALID'})};}
  }
  const publishPort=Object.freeze({validateInputs:publicationPlan,async execute(execution) {
    const {record,scope,plan,manifest}=publicationPlan(execution),final=await options.formalFiles.publish(plan,manifest,{recoveryDecision:execution.recoveryDecision,
      shouldContinue:()=>{recordFor(execution);execution.assertExecutionActive?.();return true;}}),
      bindings=final.members.map(item=>({materialKey:item.physicalIdentity.materialKey,endpointId:item.endpointId,location:item.location,bindingRevision:item.bindingRevision})),
      result={schemaRef:'helix://contracts/types/PlacementSwitchReceipt/v1',schemaVersion:1,receiptId:stable('arca-jav-correction-placement-',{eventId:execution.eventId}),
        receiptKind:'jav_correction_placement_published',ownerDomain:'arca',scopeType:'jav_identity_correction',scopeId:record.correctionId,scopeDigest:plan.planDigest,
        effectReceiptRef:stable('arca-correction-effect-receipt-',{eventId:execution.eventId}),committedAtMs:execution.effectOccurredAtMs??now(),
        targetCommitSlotId:manifest.targetCommitSlotId,finalBindingSetDigest:canonicalDigest(bindings),
        replacedInputSetDigest:canonicalDigest(plan.members.filter(item=>item.source.kind==='correction_artifact').map(item=>item.original.physicalIdentity.materialKey)),transactionRevision:record.stateRevision};
    recordFor(execution);validator.validate(result.schemaRef,result);return outcome(PUBLISH_CAPABILITY,result,scope,'material_commit',execution);
  },validateResult(execution,value){const {record,plan,manifest}=publicationPlan(execution);validator.validate('helix://contracts/types/PlacementSwitchReceipt/v1',value.result);
    if(value.result.scopeId!==record.correctionId||value.result.scopeType!=='jav_identity_correction'||value.result.scopeDigest!==plan.planDigest||value.result.targetCommitSlotId!==manifest.targetCommitSlotId)
      fail('ARCA_JAV_CORRECTION_PUBLICATION_RESULT_INVALID','Publication Receipt differs from its exact correction and staged Manifest.');
  },observeEffectReality:context=>observeFilesReality(context,true)});
  const verificationStore=options.formalFiles?createInventoryVerificationStore(options):null;
  function completedPublication(c) {
    const workId=javCorrectionPublishWorkId(c.scope,c.plan.planDigest,c.record),status=options.workResultReader.status(workId),
      rows=options.workResultReader.read(workId).filter(item=>item.capabilityRef===PUBLISH_CAPABILITY&&item.outcomeKind==='succeeded');
    if(status?.state!=='succeeded'||status.owner_domain!=='arca'||status.process_type!=='arca_jav_identity_correction'||status.process_id!==c.record.correctionId||rows.length!==1)
      fail('ARCA_JAV_CORRECTION_PUBLICATION_NOT_READY','Final verification requires the exact completed publication Work.');
    const publication=rows[0].result;validator.validate('helix://contracts/types/PlacementSwitchReceipt/v1',publication);
    if(publication.scopeId!==c.record.correctionId||publication.scopeType!=='jav_identity_correction'||publication.scopeDigest!==c.plan.planDigest||publication.targetCommitSlotId!==c.manifest.targetCommitSlotId)
      fail('ARCA_JAV_CORRECTION_PUBLICATION_NOT_READY','Final verification publication Receipt differs from its exact File Plan.');
    return {...c,publication};
  }
  const verificationPlan=execution=>completedPublication(publicationPlan(execution));
  async function observeFactReality(context,committing){
    try{
      const capability=committing?COMMIT_CAPABILITY:VERIFY_CAPABILITY,kind=committing?'jav_correction_commit':'jav_correction_verify',
        c=options.correctionContextReader.read(context.work?.process_id),work=options.workResultReader.status(context.work?.work_id);
      if(!c||work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==c.record.correctionId||work.work_kind!==kind||
          work.basis_digest!==c.scope.digest||context.event?.work_id!==context.work.work_id||context.event.capability_ref!==capability||
          context.node?.capability_ref!==capability||context.effect?.effect_class!==(committing?'responsibility_control_commit':'domain_fact_commit'))throw new Error('Fact recovery scope mismatch.');
      const plan=options.filePlanPreparation.prepare(c.record.correctionId,javCorrectionAssetsWorkId(c.scope,c.record)),
        expected=committing?correctionCommitWorkId(c.scope,plan.planDigest,c.record):javCorrectionVerifyWorkId(c.scope,plan.planDigest,c.record);
      if(context.work.work_id!==expected)throw new Error('Fact recovery Work differs from its admitted lineage.');
      const prepared=committing?options.inventoryPreparation.prepare(c.record.correctionId,now()):completedPublication(completedStage({...c,plan})),
        controls={shouldContinue:()=>{options.correctionContextReader.assertCurrent(c.record,c.scope);return true;}},
        final=await options.formalFiles.verify(prepared.plan,prepared.manifest,controls);
      if(committing&&final.finalRealityDigest!==prepared.verification.finalRealityDigest)throw new Error('Final files differ from committed verification.');
      if(!committing){
        const nfo=await options.formalFiles.readVerifiedNfo(plan,prepared.manifest,controls),source=readJavCorrectionSourceResult({...options,record:c.record,scope:c.scope}).result;
        assertJavCorrectionVerifiedSource(c.record,c.scope,source);
        verifyJavCorrectionNfo(nfo,{javCode:c.record.proof.proposal.newJavCode,title:source.qualification.observation.descriptiveEntries.find(item=>item.key==='title')?.value});
      }
      return {status:committing?'whole_absent':'absent',...(!committing?{revisionMatches:false}:{}),fenceValid:true,evidenceDigest:canonicalDigest({scopeDigest:c.scope.digest,planDigest:plan.planDigest,
        workId:context.work.work_id,eventId:context.event.event_id,finalRealityDigest:final.finalRealityDigest})};
    }catch(error){return {status:'conflict',...(!committing?{revisionMatches:false}:{}),fenceValid:false,evidenceDigest:canonicalDigest({schema:'arca.jav-correction-fact-recovery-conflict@1',
      workId:context.work?.work_id||null,eventId:context.event?.event_id||null,reasonCode:error.code||'ARCA_JAV_CORRECTION_FILE_DRIFT'})};}
  }
  const verifyPort=Object.freeze({validateInputs:verificationPlan,async execute(execution) {
    const {record,scope,plan,manifest,publication}=verificationPlan(execution);let saved=verificationStore.readEvent(execution.eventId);
    if(!saved) {
      const shouldContinue=()=>{recordFor(execution);execution.assertExecutionActive?.();return true;},
        final=await options.formalFiles.verify(plan,manifest,{shouldContinue}),
        nfo=await options.formalFiles.readVerifiedNfo(plan,manifest,{shouldContinue}),
        source=readJavCorrectionSourceResult({...options,record,scope}).result;
      assertJavCorrectionVerifiedSource(record,scope,source);
      const semantics=verifyJavCorrectionNfo(nfo,{javCode:record.proof.proposal.newJavCode,
        title:source.qualification.observation.descriptiveEntries.find(item=>item.key==='title')?.value});
      const bindings=final.members.map(item=>({materialKey:item.physicalIdentity.materialKey,endpointId:item.endpointId,location:item.location,bindingRevision:item.bindingRevision})),
        finalBindingSetDigest=canonicalDigest(bindings),at=execution.effectOccurredAtMs??now();
      if(finalBindingSetDigest!==publication.finalBindingSetDigest)
        fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Final bindings differ from their successful publication Receipt.');
      const value={schemaRef:'helix://contracts/types/FinalProductVerification/v1',schemaVersion:1,
        verificationId:stable('arca-jav-correction-verification-',{eventId:execution.eventId}),verificationKind:'final_product',basisDigest:scope.digest,
        result:'passed',reasonCodes:[],evidenceRefs:[manifest.manifestId,publication.receiptId],verifiedAtMs:at,finalBindingSetDigest,
        productManifestDigest:plan.planDigest,relatedDispositionSetDigest:record.proof.basis.relatedSetDigest,
        verifiedMaterialKeys:final.members.map(item=>item.physicalIdentity.materialKey),
        targetContainmentDigest:canonicalDigest({target:plan.target,locations:final.members.map(item=>item.location)}),finalRealityDigest:final.finalRealityDigest,
        memberEvidence:final.members.map(item=>({sourceProductMaterialKey:item.sourceMaterialKey,role:item.role,
          verificationKind:item.role==='metadata_sidecar'?'readable_nfo':'exact_package_identity',actualPhysicalIdentity:item.physicalIdentity,observedAtMs:at,
          semanticEvidenceDigest:canonicalDigest({fullByteDigest:item.fullByteDigest,...(item.role==='metadata_sidecar'?semantics:{})})}))};
      recordFor(execution);saved=verificationStore.commit(execution,value);
    }
    const result=saved.record,value=outcome(VERIFY_CAPABILITY,result,scope,'domain_fact_commit',execution),at=saved.committedAtMs;
    return {...value,resultSchemaRef:result.schemaRef,effectReceipt:{...value.effectReceipt,
      effectReceiptId:stable('arca-effect-receipt-',{eventId:execution.eventId}),commitMarker:stable('arca-effect-marker-',{eventId:execution.eventId}),
      verificationEvidenceDigest:canonicalDigest(result),committedAtMs:at}};
  },validateResult(execution,value){const {scope,plan}=verificationPlan(execution);validator.validate('helix://contracts/types/FinalProductVerificationRecord/v1',value.result);
    const verification=verificationStore.resolve(value.result);
    if(value.result.processType!=='arca_jav_identity_correction'||value.result.processId!==scope.correctionId||verification.basisDigest!==scope.digest||
        verification.result!=='passed'||verification.productManifestDigest!==plan.planDigest||verification.memberEvidence.length!==plan.members.length)
      fail('ARCA_JAV_CORRECTION_VERIFICATION_RESULT_INVALID','Final Verification does not conserve the complete current correction scope.');
  },observeEffectReality:context=>observeFactReality(context,false)});
  const commitStore=options.formalFiles?createJavCorrectionCommitStore(options):null,commitPort=Object.freeze({validateInputs(execution){
    validator.validate(SCOPE_SCHEMA,execution.namedInputs?.javCorrectionScope);
    const prior=commitStore.readEvent(execution);
    if(prior){if(prior.result.scopeId!==execution.ownerScope.processId||prior.result.scopeDigest!==execution.namedInputs.javCorrectionScope.digest)
      fail('ARCA_JAV_CORRECTION_SCOPE_STALE','Committed correction belongs to another execution scope.');}
    else recordFor(execution);
  },async execute(execution){
    const prior=commitStore.readEvent(execution);if(prior)return prior;
    const {record}=recordFor(execution),prepared=options.inventoryPreparation.prepare(record.correctionId,execution.effectOccurredAtMs??now()),
      final=await options.formalFiles.verify(prepared.plan,prepared.manifest,{shouldContinue:()=>{recordFor(execution);execution.assertExecutionActive?.();return true;}});
    if(final.finalRealityDigest!==prepared.verification.finalRealityDigest)fail('ARCA_JAV_CORRECTION_FILE_DRIFT','Final correction files changed after independent verification.');
    recordFor(execution);return commitStore.commit(execution,prepared);
  },validateResult(execution,value){validator.validate(COMMIT_SCHEMA,value.result);const saved=commitStore.readEvent(execution);
    if(!saved||canonicalDigest(saved.result)!==canonicalDigest(value.result)||value.result.scopeId!==execution.ownerScope.processId||
        value.result.scopeDigest!==execution.namedInputs.javCorrectionScope.digest)
      fail('ARCA_JAV_CORRECTION_COMMIT_RESULT_INVALID','Correction Receipt is not the exact atomic committed Result.');
  },observeEffectReality:context=>observeFactReality(context,true)});
  return Object.freeze({[SOURCE_CAPABILITY]:sourcePort,[CAPABILITY]:assetsPort,[STAGE_CAPABILITY]:stagePort,[PUBLISH_CAPABILITY]:publishPort,[VERIFY_CAPABILITY]:verifyPort,[COMMIT_CAPABILITY]:commitPort,
    [RETIREMENT_CAPABILITY]:options.retirementIo?createJavCorrectionRetirementPort(options):null,
    [RECLAIM_CAPABILITY]:options.workspaceReclaimIo?createJavCorrectionWorkspaceReclaimPort(options):null});
}
module.exports=Object.freeze({createJavCorrectionCapabilityPorts});
