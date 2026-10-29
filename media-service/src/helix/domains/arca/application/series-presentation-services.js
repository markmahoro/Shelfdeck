'use strict';
const path=require('node:path');
const {buildMaintenanceBasis,REQUEST:MAINTENANCE}=require('../../../contracts/series-maintenance-basis');
const {aftercareProviderIdentity}=require('../model/aftercare-provider-identity');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {createSeriesPresentationStore}=require('../persistence/series-presentation-store');
const {createSeriesPresentationWorkspaceStore}=require('../persistence/series-presentation-workspace-store');
const {createSeriesPresentationCommitStore}=require('../persistence/series-presentation-commit-store');
const {packageSeriesBasis,seriesScopeId}=require('../model/series-presentation');
const {createSeriesWorkspaceReclaimStore}=require('../persistence/series-workspace-reclaim-store');
const {OBJECTIVE}=require('../planning/series-presentation-planner');
const {readControlProjections}=require('../persistence/read-control-projections');
const {createSeriesSourceReassessmentFence}=require('../persistence/series-source-reassessment-fence');
const {createSeriesRetryCommandStore}=require('../persistence/series-retry-command-store');
const {createSeriesRetainedRetirementStore}=require('../persistence/series-retained-retirement-store');
const {buildImageSource}=require('../../../contracts/series-image-source');
function createSeriesPresentationServices(options){
  options.aftercareContextReader.store.ensureAftercareWorkspaceRoot();
  const rootSnapshot={...options.aftercareContextReader.store.aftercareWorkspaceRootSnapshot,resolvedRoot:options.aftercareWorkspaceRoot},
    seriesStore=createSeriesPresentationStore(options),retryCommands=createSeriesRetryCommandStore(options),seriesWorkspaceStore=createSeriesPresentationWorkspaceStore({...options,rootSnapshot,seriesStore}),
    seriesIo=options.createSeriesPresentationIo({rootSnapshot}),seriesCommitStore=createSeriesPresentationCommitStore({...options,seriesStore}),retirementStore=createSeriesRetainedRetirementStore({...options,seriesStore}),
    admission=createWorkAdmission({...options,limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256},eligibilityProvider:{check:request=>({
      eligible:request.ownerDomain==='arca'&&request.processType==='arca_series_presentation'&&seriesStore.build(request.processId)?.digest===request.executionBasisDigest&&(request.workKind!=='series_presentation'||seriesStore.readScope(seriesStore.build(request.processId).scopeId)?.active_build_id===request.processId),
      basisDigest:request.executionBasisDigest,reasonCode:'ARCA_SERIES_SCOPE_STALE'})}});
  const readReferences=scope=>works(scope.objectId).flatMap(row=>options.workResultReader.read(row.work_id)).filter(row=>row.outcomeKind==='succeeded'),
    seriesReclaimStore=createSeriesWorkspaceReclaimStore({...options,rootSnapshot,seriesStore,seriesWorkspaceStore,readReferences});
  function works(buildId){return options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_series_presentation',processId:buildId,workKind:'series_presentation'})
    .slice().sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms)||Buffer.compare(Buffer.from(a.work_id),Buffer.from(b.work_id)));}
  function work(scope,generation,reclaim=false){
    const key=canonicalDigest({scopeDigest:scope.digest,generation,reclaim}),id='arca-series-work-'+key.slice(0,40);
    return {schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:id,ownerDomain:'arca',processType:'arca_series_presentation',
      processId:scope.objectId,workKind:reclaim?'series_presentation_reclaim':'series_presentation',workObjectiveTypeRef:reclaim?OBJECTIVE.replace('/series_presentation/','/series_presentation_reclaim/'):OBJECTIVE,workObjectiveVersion:1,executionBasisId:scope.objectId,
      executionBasisDigest:scope.digest,dependencyRefs:[],priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:[],
      idempotencyKey:'arca-series-work-key-'+key,concurrencyScope:'arca_series_presentation/'+scope.scopeId,outputContractRef:'helix://contracts/types/'+(reclaim?'SeriesPresentationWorkspaceReclaimed':'SeriesPresentationReady')+'/v1'};
  }
  function retryCommand(kind,id,body){const raw=retryCommands.command(kind,id,body);if(!raw)return null;return {read:raw.read,participant:(scopeProvider,generation,reclaim=false)=>raw.participant(()=>{const scope=scopeProvider(),definition=work(scope,generation,reclaim);return {scopeId:scope.scopeId,buildId:scope.objectId,scopeDigest:scope.digest,generation,workKind:reclaim?'series_presentation_reclaim':'series_presentation',workId:definition.workId};})};}
  function recordCommand(command,scope,generation){options.unitOfWork.execute([seriesStore.scopeParticipant(scope),command.participant(()=>scope,generation)]);}
  function replayRetry(command){const value=command?.read();if(!value)return null;const scope=seriesStore.build(value.buildId);if(scope?.digest!==value.scopeDigest||work(scope,value.generation,value.workKind==='series_presentation_reclaim').workId!==value.workId)throw new Error('Retry receipt lost its exact immutable Work basis.');if(!options.workResultReader.status(value.workId)&&value.workKind==='series_presentation'&&seriesStore.readScope(scope.scopeId)?.active_build_id!==scope.objectId)return {...value,kind:'superseded',replayed:true};if(value.workKind==='series_presentation_reclaim')reclaim(scope.objectId,{generation:value.generation});else submit(scope,value.generation);return {kind:'series_presentation_pending',scopeId:scope.scopeId,buildId:scope.objectId,workId:value.workId,replayed:true};}
  function submit(scope,generation){const definition=work(scope,generation),result=admission.replay(definition)||admission.submit(definition);
    if(result.kind==='invalid_contract')throw Object.assign(new Error('Shared presentation Work admission failed.'),{code:result.reasonCode});return definition;}
  function reassessmentFence(scope){let fence=createSeriesSourceReassessmentFence(options,scope.objectId);
    try{options.unitOfWork.execute([fence]);fence.sourceWorkspaceFiles=scope.sourceWorkspaceFiles;return fence;}catch(error){if(error.code!=='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')throw error;}
    const sources=works(scope.objectId).flatMap(row=>options.workResultReader.read(row.work_id)).filter(row=>row.outcomeKind==='succeeded'&&row.capabilityRef==='arca.series_presentation.source.observe@1');
    if(!sources.length)return null;const source=sources.at(-1).result;
    try{const absenceDigest=seriesIo.verifyUnmaterialized(scope,source.recipe),proof={workspaceId:scope.objectId+'-assets',rootHandleRef:rootSnapshot.rootHandleRef,absenceDigest,verifyAbsence:()=>seriesIo.verifyUnmaterialized(scope,source.recipe)};
      options.unitOfWork.execute([createSeriesSourceReassessmentFence(options,scope.objectId,{...proof,readOnly:true})]);return createSeriesSourceReassessmentFence(options,scope.objectId,proof);
    }catch(error){if(error.code!=='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')throw error;}
    try{const snapshot=seriesWorkspaceStore.snapshot(scope),registry={registryExists:Boolean(snapshot.registry),members:snapshot.artifacts.map(row=>row.workspaceMaterialHandle)},captured=seriesIo.capturePrepared(scope,source),inherited=scope.sourceWorkspaceFiles.filter(row=>!captured.some(item=>item.artifactKind===row.artifactKind));
      const origins=new Map([[scope.objectId,scope],...inherited.map(item=>[item.originBuildId,seriesStore.build(item.originBuildId)])]);
      const verify=()=>{const observed=seriesIo.observeWrites(scope,source.recipe,{registry});if(observed.status==='conflict'&&!observed.cleanupDeclared)throw Object.assign(new Error('Recovery Workspace conflicts with its frozen recipe.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});for(const item of [...captured,...inherited])seriesIo.readRecoverySource(origins.get(item.originBuildId),item);return canonicalDigest({observed:observed.evidenceDigest,files:[...captured,...inherited]});},proof={workspaceId:scope.objectId+'-assets',rootHandleRef:rootSnapshot.rootHandleRef,absenceDigest:verify(),verifyAbsence:verify,retainWorkspace:true,registeredArtifacts:snapshot.artifacts};
      options.unitOfWork.execute([createSeriesSourceReassessmentFence(options,scope.objectId,{...proof,readOnly:true})]);fence=createSeriesSourceReassessmentFence(options,scope.objectId,proof);fence.sourceWorkspaceFiles=[...captured,...inherited];return fence;
    }catch(error){if(error.code==='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')return null;throw error;}}
  function recoveryInputs(scope,fence,supplied){const supplementalSources=[...scope.supplementalSources.filter(row=>!supplied.some(item=>item.artifactKind===row.artifactKind)),...supplied];return {supplementalSources,sourceWorkspaceFiles:(fence.sourceWorkspaceFiles||[]).filter(row=>!supplied.some(item=>item.artifactKind===row.artifactKind))};}
  function ensure(context,{retry=false,supplementalSources=[],command=null}={}){
    const basis=packageSeriesBasis(context.packageValue);if(!basis)return {kind:'ready',reference:null};
    const scopeId=seriesScopeId(context.shelf.shelfId,basis.sourceObservation.providerKey),current=seriesStore.readScope(scopeId);
    if(!current)throw Object.assign(new Error('Accepted Season has no shared presentation reservation.'),{code:'ARCA_SERIES_RESERVATION_MISSING'});
    if(Number(current.current_version)>0&&!current.active_build_id){const stored=seriesStore.manifest(scopeId,Number(current.current_version)),
      projections=readControlProjections(options.materialControlProjectionPort,stored.value.members.map(row=>row.physicalIdentity.materialKey));
      if(projections.every(row=>row.resultKind==='available'&&row.controlState==='released')){const fresh=seriesStore.admitBuild({scopeId,basis,existingMembers:[]});
        const next=submit(fresh,1);return {kind:'pending',buildId:fresh.objectId,workId:next.workId};}
      let physical;try{physical=seriesIo.currentManifestState(seriesStore.build(stored.value.buildId),stored.value);}catch(error){if(!/^(ARCA_SERIES_|EACCES|EPERM|ENOENT|ENOTCONN|EIO)/.test(error.code||''))throw error;physical='conflict';}
      if(physical!=='healthy'){const fresh=seriesStore.admitBuild({scopeId,basis,existingMembers:stored.value.members}),next=submit(fresh,1);return {kind:'pending',buildId:fresh.objectId,workId:next.workId};}
      return {kind:'ready',reference:{scopeId,sharedVersion:stored.value.revision,manifestDigest:stored.value.digest,verificationDigest:stored.verificationDigest}};}
    const scope=current.active_build_id?seriesStore.build(current.active_build_id):seriesStore.admitBuild({scopeId,basis,existingMembers:[]}),rows=works(scope.objectId),latest=rows.at(-1);
    if(latest&&['failed','cancelled'].includes(latest.state)&&!retry)return {kind:'attention_required',buildId:scope.objectId,workId:latest.work_id};
    if(latest&&!['failed','cancelled'].includes(latest.state)){if(command)recordCommand(command,scope,rows.length);return {kind:'pending',buildId:scope.objectId,workId:latest.work_id};}
    if(latest&&retry){
      const noEffects=reassessmentFence(scope);
      if(noEffects){const imageSourceQualification=supplementalSources.length?scope.imageSourceQualification:(options.resolveSeriesImageSource?.(basis.sourceObservation)||buildImageSource(basis.sourceObservation)),
        fresh=seriesStore.admitBuild({scopeId,basis,existingMembers:scope.existingMembers,replaceFailedBuildId:scope.objectId,
          reassessmentFence:noEffects,imageSourceQualification,...recoveryInputs(scope,noEffects,supplementalSources),command});
        const next=submit(fresh,1);return {kind:'pending',buildId:fresh.objectId,workId:next.workId};
      }
      if(supplementalSources.length)throw Object.assign(new Error('Recover the existing publication before changing its source.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
    }
    if(command)recordCommand(command,scope,rows.length+1);const definition=submit(scope,rows.length+1);return {kind:'pending',buildId:scope.objectId,workId:definition.workId};
  }
  async function verifyReady(context){
    const readiness=ensure(context);if(readiness.kind!=='ready')throw Object.assign(new Error('Required show presentation is not ready.'),{code:'ARCA_SERIES_PRESENTATION_NOT_READY'});
    if(!readiness.reference)return null;
    const reference=readiness.reference,stored=seriesStore.manifest(reference.scopeId,reference.sharedVersion),scope=seriesStore.build(stored.value.buildId);
    if(await seriesIo.verifyManifest(scope,stored.value)!==reference.verificationDigest)throw new Error('Shared verification differs from its committed evidence.');
    const projections=readControlProjections(options.materialControlProjectionPort,stored.value.members.map(member=>member.physicalIdentity.materialKey));
    for(const row of projections)if(row.resultKind!=='available'||row.controlState!=='controlled'||row.ownerDomain!=='arca'||row.ownerScopeType!=='series_presentation'||row.ownerScopeId!==reference.scopeId)
      throw Object.assign(new Error('Show presentation no longer has its formal shared Control.'),{code:'ARCA_SERIES_CONTROL_CHANGED'});
    return {...reference,controls:projections.map(row=>({materialKey:row.materialKey,controlRevision:row.controlRevision,projectionDigest:row.projectionDigest}))};
  }
  function legacyContext(entryId){const c=options.aftercareContextReader.read(entryId);return c?.raw.entry.structure_kind==='season'&&c.raw.identity.provider==='tmdb'?c:null;}
  function maintenanceBasis(context){
    const raw=context.raw,identity=aftercareProviderIdentity(context,{providerId:raw.identity.provider,providerObjectId:raw.identity.provider_key,identityDigest:raw.identity.identity_digest}),
      roots=[...new Set(raw.materials.filter(row=>row.role==='primary_payload').map(row=>path.dirname(path.dirname(row.location))))];
    if(roots.length!==1)throw Object.assign(new Error('Season Inventory does not determine one shared formal root.'),{code:'ARCA_SERIES_PLACEMENT_CONFLICT'});
    const q=options.resolveSeriesImageSource({providerKey:identity.providerKey,originalLanguage:'',language:'zh-CN'});
    return buildMaintenanceBasis({shelfEntryId:context.shelfEntryId,shelfId:raw.shelf.shelf_id,inventoryRevision:Number(raw.entry.current_inventory_revision),
      identityRevision:Number(raw.entry.canonical_identity_revision),identityDigest:raw.identity.identity_digest,inventoryDigest:raw.inventory.representation_digest,rootLocation:roots[0]},identity,q);
  }
  function entryScope(entryId){
    const refs=seriesStore.read('entry_references',{shelf_entry_id:entryId}).filter(row=>row.state==='active');
    if(refs.length>1)throw new Error('Season has ambiguous shared presentation references.');
    if(refs.length)return seriesStore.readScope(refs[0].scope_id);
    const c=legacyContext(entryId);return c?seriesStore.findByIdentity(c.raw.shelf.shelf_id,String(c.raw.identity.provider_key)):null;
  }
  function headForEntry(entryId,hint=null){const current=hint?seriesStore.findByIdentity(hint.shelfId,String(hint.providerKey)):entryScope(entryId);
    if(!current){const c=hint||legacyContext(entryId);return c?canonicalDigest({schema:'arca.series-unregistered-head@1',entryId}):null;}
    const latest=current.active_build_id?works(current.active_build_id).at(-1):null;return canonicalDigest({schema:'arca.series-health-head@1',stateDigest:current.state_digest,workId:latest?.work_id||null,workState:latest?.state||null});}
  async function assessEntry(context){
    const current=entryScope(context.shelfEntryId);
    if(!current)return context.raw.entry.structure_kind==='season'&&context.raw.identity.provider==='tmdb'?{state:'degraded',scopeId:seriesScopeId(context.raw.shelf.shelf_id,String(context.raw.identity.provider_key)),reasonCode:'series_shared_unregistered',requiresIntent:true}:null;
    if(current.active_build_id){const latest=works(current.active_build_id).at(-1);return {state:['failed','cancelled'].includes(latest?.state)?'attention_required':'pending',scopeId:current.scope_id,
      reasonCode:['failed','cancelled'].includes(latest?.state)?'series_shared_preparation_failed':'series_shared_preparation_pending'};}
    if(!Number(current.current_version)||!seriesStore.read('entry_references',{shelf_entry_id:context.shelfEntryId}).some(row=>row.state==='active'))
      return {state:'degraded',scopeId:current.scope_id,reasonCode:'series_shared_unregistered',requiresIntent:true};
    const stored=seriesStore.manifest(current.scope_id,Number(current.current_version)),scope=seriesStore.build(stored.value.buildId);
    const cleanup=failedCleanup(current);if(cleanup)return {state:'attention_required',scopeId:current.scope_id,reasonCode:'series_shared_cleanup_failed'};
    try{const members=await seriesIo.inspectRoot(scope,scope.basis,stored.value);
      return {state:members.length===3?'healthy':'degraded',scopeId:current.scope_id,reasonCode:members.length===3?null:'series_shared_missing'};
    }catch(error){return {state:'attention_required',scopeId:current.scope_id,reasonCode:'series_shared_conflict',conflictCode:error.code||'ARCA_SERIES_CONFLICT'};}
  }
  function needsRegistration(context){return context?.raw.entry.status==='active'&&context.raw.entry.structure_kind==='season'&&context.raw.identity.provider==='tmdb'&&!seriesStore.read('entry_references',{shelf_entry_id:context.shelfEntryId}).some(row=>row.state==='active');}
  function maintainEntry(context,{retry=false,supplementalSources=[],command=null}={}){
    let current=entryScope(context.shelfEntryId);if(!current){if(context.raw.entry.structure_kind!=='season'||context.raw.identity.provider!=='tmdb')return {kind:'not_applicable'};
      current=seriesStore.registerMaintenance(maintenanceBasis(context));}
    const stored=Number(current.current_version)?seriesStore.manifest(current.scope_id,Number(current.current_version)):null;
    const cleanup=failedCleanup(current);if(cleanup)return {kind:'series_presentation_cleanup_pending',workId:reclaim(cleanup.process_id,{retry,command}).workId};
    const prior=stored&&seriesStore.build(stored.value.buildId),basis=prior&&prior.basis.schema!==MAINTENANCE&&seriesStore.read('entry_references',{shelf_entry_id:context.shelfEntryId}).some(row=>row.state==='active')?prior.basis:maintenanceBasis(context),
      scope=current.active_build_id?seriesStore.build(current.active_build_id):seriesStore.admitBuild({scopeId:current.scope_id,basis,existingMembers:stored?.value.members||[],command}),
      rows=works(scope.objectId),latest=rows.at(-1);
    if(latest&&['failed','cancelled'].includes(latest.state)&&!retry)return {kind:'attention_required',scopeId:current.scope_id,workId:latest.work_id};
    if(latest&&!['failed','cancelled'].includes(latest.state)){if(command)recordCommand(command,scope,rows.length);return {kind:'series_presentation_pending',scopeId:current.scope_id,workId:latest.work_id};}
    const recoveryFence=latest&&retry?reassessmentFence(scope):null;
    if(recoveryFence){
      const fresh=seriesStore.admitBuild({scopeId:current.scope_id,basis:scope.basis.schema===MAINTENANCE?maintenanceBasis(context):scope.basis,existingMembers:scope.existingMembers,replaceFailedBuildId:scope.objectId,
        reassessmentFence:recoveryFence,command,...recoveryInputs(scope,recoveryFence,supplementalSources),imageSourceQualification:supplementalSources.length?scope.imageSourceQualification:(options.resolveSeriesImageSource?.(scope.basis.sourceObservation)||scope.imageSourceQualification)}),next=submit(fresh,1);
      return {kind:'series_presentation_pending',scopeId:current.scope_id,workId:next.workId};
    }
    if(supplementalSources.length)throw Object.assign(new Error('Recover the existing file Effects before replacing its source.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
    if(command)recordCommand(command,scope,rows.length+1);const next=submit(scope,rows.length+1);return {kind:'series_presentation_pending',scopeId:current.scope_id,workId:next.workId};
  }
  async function prepareSupplements(context,body){
    const basis=context.packageValue?packageSeriesBasis(context.packageValue):null,current=context.shelfEntryId?entryScope(context.shelfEntryId):basis&&seriesStore.findByIdentity(context.shelf.shelfId,basis.sourceObservation.providerKey),scope=current?.active_build_id&&seriesStore.build(current.active_build_id);
    if(!scope||!Array.isArray(body.supplementalImages)||body.supplementalImages.length>2||new Set(body.supplementalImages.map(item=>item.artifactKind)).size!==body.supplementalImages.length)
      throw Object.assign(new TypeError('Supplement requires the failed original show task and unique image roles.'),{code:'ARCA_SERIES_SUPPLEMENT_INVALID'});
    if(!reassessmentFence(scope))throw Object.assign(new Error('Publication must recover its original prepared bytes.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
    const decoded=[];for(const item of body.supplementalImages){
      if(Object.keys(item).sort().join(',')!=='artifactKind,bytesBase64'||typeof item.bytesBase64!=='string'||item.bytesBase64.length>12*1024*1024)
        throw Object.assign(new TypeError('Show image upload exceeds its bounded format.'),{code:'ARCA_SERIES_SUPPLEMENT_INVALID'});
      const bytes=Buffer.from(item.bytesBase64,'base64');if(bytes.length>8*1024*1024||bytes.toString('base64')!==item.bytesBase64)throw Object.assign(new TypeError('Show image upload encoding is invalid.'),{code:'ARCA_SERIES_SUPPLEMENT_INVALID'});
      await seriesIo.imageBytes(bytes,item.artifactKind);decoded.push({artifactKind:item.artifactKind,bytes});
    }const sources=[];for(const item of decoded)sources.push(await seriesIo.stageSupplement(scope,item.artifactKind,item.bytes,body.idempotencyKey));return sources;
  }
  function issueForEntry(entryId){const current=entryScope(entryId);if(!current)return null;
    if(!current.active_build_id&&!Number(current.current_version))return null;
    const scope=current.active_build_id?seriesStore.build(current.active_build_id):seriesStore.build(seriesStore.manifest(current.scope_id,Number(current.current_version)).value.buildId),
      latest=current.active_build_id?works(scope.objectId).at(-1):failedCleanup(current);
    if(!latest||!['failed','cancelled'].includes(latest.state))return current.active_build_id?{state:'in_progress',canRetry:false,canSupplyImages:false,reasonCode:null}:null;
    let canSupplyImages=false;if(current.active_build_id)canSupplyImages=Boolean(reassessmentFence(scope));
    return {state:'attention_required',canRetry:true,canSupplyImages,reasonCode:current.active_build_id?'series_shared_preparation_failed':'series_shared_cleanup_failed'};
  }
  function reclaimWorks(buildId){return options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_series_presentation',processId:buildId,workKind:'series_presentation_reclaim'})
    .slice().sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms)||String(a.work_id).localeCompare(String(b.work_id)));}
  function reclamationBasis(scope){const refs=readReferences(scope),prepared=refs.find(row=>row.result.schemaRef==='helix://contracts/types/SeriesPresentationAssetsPrepared/v1')?.result||null,sourceObserved=refs.find(row=>row.result.schemaRef==='helix://contracts/types/SeriesPresentationSourceObserved/v1')?.result||null,
    retirementReceipt=retirementStore.read(scope.objectId),version=seriesStore.manifest(scope.scopeId,scope.expectedVersion+1);
    if(retirementReceipt){const body={schemaRef:'helix://contracts/domain-types/SeriesPresentationReclamationBasis/v1',schemaVersion:1,objectId:scope.objectId,revision:scope.revision,scopeDigest:scope.digest,kind:'retired',retirementReceipt,sourceObserved,prepared,ready:null,registeredArtifacts:seriesWorkspaceStore.snapshot(scope).artifacts};const result={...body,digest:canonicalDigest(body)};options.contractValidator.validate(body.schemaRef,result);return result;}
    if(!version)throw Object.assign(new Error('Reclamation is waiting for shared Ready.'),{code:'ARCA_SERIES_RECLAMATION_NOT_READY'});
    const readyScope=seriesStore.build(version.value.buildId),ready=readReferences(readyScope).find(row=>row.result.schemaRef==='helix://contracts/types/SeriesPresentationReady/v1')?.result;
    let ancestor=readyScope;const seen=new Set();while(ancestor.objectId!==scope.objectId&&ancestor.supersedesBuildId){if(seen.has(ancestor.objectId))throw new Error('Shared recovery lineage cycles.');seen.add(ancestor.objectId);ancestor=seriesStore.build(ancestor.supersedesBuildId);if(!ancestor||ancestor.scopeId!==scope.scopeId)throw new Error('Shared recovery lineage changed.');}
    if(!ready||ancestor.objectId!==scope.objectId)throw Object.assign(new Error('Reclamation lacks an exact committed successor lineage.'),{code:'ARCA_SERIES_RECLAMATION_NOT_READY'});
    const body={schemaRef:'helix://contracts/domain-types/SeriesPresentationReclamationBasis/v1',schemaVersion:1,objectId:scope.objectId,revision:scope.revision,scopeDigest:scope.digest,kind:readyScope.objectId===scope.objectId?'committed':'superseded',retirementReceipt:null,sourceObserved,prepared,ready,registeredArtifacts:seriesWorkspaceStore.snapshot(scope).artifacts};
    const result={...body,digest:canonicalDigest(body)};options.contractValidator.validate(body.schemaRef,result);return result;
  }
  function failedCleanup(current){return seriesStore.read('builds',{scope_id:current.scope_id}).map(row=>reclaimWorks(row.build_id).at(-1)).find(row=>row&&['failed','cancelled'].includes(row.state))||null;}
  function reclaim(buildId,{retry=false,command=null,generation=null}={}){const scope=seriesStore.build(buildId),rows=reclaimWorks(buildId),latest=rows.at(-1);
    if(!generation&&latest&&(!retry||!['failed','cancelled'].includes(latest.state))){if(command)options.unitOfWork.execute([seriesStore.reclamationScopeParticipant(scope,reclamationBasis(scope)),command.participant(()=>scope,rows.length,true)]);return {workId:latest.work_id};}
    const next=generation||rows.length+1;if(command)options.unitOfWork.execute([seriesStore.reclamationScopeParticipant(scope,reclamationBasis(scope)),command.participant(()=>scope,next,true)]);
    const definition=work(scope,next,true),result=admission.replay(definition)||admission.submit(definition);
    if(result.kind==='invalid_contract')throw new Error('Shared reclamation Work admission failed.');return definition;}
  function needsRetirement(current){if(!seriesStore.unused(current.scope_id))return false;if(current.active_build_id)return true;if(!Number(current.current_version))return false;const value=seriesStore.manifest(current.scope_id,Number(current.current_version)).value;return readControlProjections(options.materialControlProjectionPort,value.members.map(row=>row.physicalIdentity.materialKey)).some(row=>row.controlState==='controlled'&&row.ownerDomain==='arca'&&row.ownerScopeType==='series_presentation'&&row.ownerScopeId===current.scope_id);}
  function pendingPage(cursor=null,limit=100){return seriesStore.read('scopes').filter(row=>row.scope_id>(cursor||'')&&(row.active_build_id||seriesStore.read('reservations',{scope_id:row.scope_id}).some(item=>item.state==='pending')||needsRetirement(row)))
    .sort((a,b)=>a.scope_id.localeCompare(b.scope_id)).slice(0,limit).map(row=>({cursor:row.scope_id,scope:{scopeId:row.scope_id}}));}
  function reconcileMaintenanceScope(scopeId){const current=seriesStore.readScope(scopeId),scope=current?.active_build_id&&seriesStore.build(current.active_build_id);
    if(current&&needsRetirement(current)){if(scope){const result=options.cancelProcessWorks({ownerDomain:'arca',processType:'arca_series_presentation',processId:scope.objectId,reasonCode:'ARCA_SERIES_NO_COLLECTION_OBLIGATION'});if(result.drainingWorks)return {kind:'draining'};}return retirementStore.retire(current);}
    if(scope){const pending=retryCommands.latestForBuild(scope.objectId);if(pending?.workKind==='series_presentation'&&!options.workResultReader.status(pending.workId)){submit(scope,pending.generation);return {kind:'pending',workId:pending.workId};}if(!works(scope.objectId).length){const definition=submit(scope,1);return {kind:'pending',workId:definition.workId};}}
    if(!scope?.basis.entryBinding)return null;const context=legacyContext(scope.basis.entryBinding.shelfEntryId);return context?maintainEntry(context):null;}
  function reclaimPage(cursor=null,limit=100){const ids=new Set(seriesWorkspaceStore.listActive().map(row=>row.process_id));for(const current of seriesStore.read('scopes'))for(const row of seriesStore.read('builds',{scope_id:current.scope_id}))if(JSON.parse(row.scope_json).supplementalSources.length||retirementStore.read(row.build_id))ids.add(row.build_id);
    return [...ids].filter(id=>id>(cursor||'')&&reclaimWorks(id).at(-1)?.state!=='succeeded').sort().filter(id=>{const scope=seriesStore.build(id);if(!scope||seriesStore.readScope(scope.scopeId)?.active_build_id===id)return false;try{reclamationBasis(scope);return true;}catch(error){if(error.code==='ARCA_SERIES_RECLAMATION_NOT_READY')return false;throw error;}}).slice(0,limit).map(id=>({cursor:id,scope:{buildId:id}}));}
  return Object.freeze({rootSnapshot,seriesStore,seriesWorkspaceStore,seriesIo,seriesCommitStore,seriesReclaimStore,retirementStore,readReferences,reclamationBasis,reclaim,prepareSupplements,issueForEntry,headForEntry,needsRegistration,retryCommand,replayRetry,pendingPage,reclaimPage,reconcileMaintenanceScope,reclaimWorks,works,ensure,verifyReady,entryScope,assessEntry,maintainEntry,canReassess:buildId=>Boolean(reassessmentFence(seriesStore.build(buildId)))});
}
module.exports=Object.freeze({createSeriesPresentationServices});
