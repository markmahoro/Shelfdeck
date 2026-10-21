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
const {buildImageSource}=require('../../../contracts/series-image-source');
function createSeriesPresentationServices(options){
  options.aftercareContextReader.store.ensureAftercareWorkspaceRoot();
  const rootSnapshot={...options.aftercareContextReader.store.aftercareWorkspaceRootSnapshot,resolvedRoot:options.aftercareWorkspaceRoot},
    seriesStore=createSeriesPresentationStore(options),seriesWorkspaceStore=createSeriesPresentationWorkspaceStore({...options,rootSnapshot,seriesStore}),
    seriesIo=options.createSeriesPresentationIo({rootSnapshot}),seriesCommitStore=createSeriesPresentationCommitStore({...options,seriesStore}),
    admission=createWorkAdmission({...options,limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256},eligibilityProvider:{check:request=>({
      eligible:request.ownerDomain==='arca'&&request.processType==='arca_series_presentation'&&seriesStore.build(request.processId)?.digest===request.executionBasisDigest,
      basisDigest:request.executionBasisDigest,reasonCode:'ARCA_SERIES_SCOPE_STALE'})}});
  const readReferences=scope=>works(scope.objectId).filter(row=>row.state==='succeeded').flatMap(row=>options.workResultReader.read(row.work_id)).filter(row=>row.outcomeKind==='succeeded'),
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
  function submit(scope,generation){const definition=work(scope,generation),result=admission.replay(definition)||admission.submit(definition);
    if(result.kind==='invalid_contract')throw Object.assign(new Error('Shared presentation Work admission failed.'),{code:result.reasonCode});return definition;}
  function reassessmentFence(scope){let fence=createSeriesSourceReassessmentFence(options,scope.objectId);
    try{options.unitOfWork.execute([fence]);return fence;}catch(error){if(error.code!=='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')throw error;}
    const sources=works(scope.objectId).flatMap(row=>options.workResultReader.read(row.work_id)).filter(row=>row.outcomeKind==='succeeded'&&row.capabilityRef==='arca.series_presentation.source.observe@1');
    if(!sources.length)return null;const source=sources.at(-1).result;
    try{const absenceDigest=seriesIo.verifyUnmaterialized(scope,source.recipe),proof={workspaceId:scope.objectId+'-assets',rootHandleRef:rootSnapshot.rootHandleRef,absenceDigest,verifyAbsence:()=>seriesIo.verifyUnmaterialized(scope,source.recipe)};
      options.unitOfWork.execute([createSeriesSourceReassessmentFence(options,scope.objectId,{...proof,readOnly:true})]);return createSeriesSourceReassessmentFence(options,scope.objectId,proof);
    }catch(error){if(error.code==='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')return null;throw error;}}
  function ensure(context,{retry=false,supplementalSources=[]}={}){
    const basis=packageSeriesBasis(context.packageValue);if(!basis)return {kind:'ready',reference:null};
    const scopeId=seriesScopeId(context.shelf.shelfId,basis.sourceObservation.providerKey),current=seriesStore.readScope(scopeId);
    if(!current)throw Object.assign(new Error('Accepted Season has no shared presentation reservation.'),{code:'ARCA_SERIES_RESERVATION_MISSING'});
    if(Number(current.current_version)>0&&!current.active_build_id){const stored=seriesStore.manifest(scopeId,Number(current.current_version)),
      projections=readControlProjections(options.materialControlProjectionPort,stored.value.members.map(row=>row.physicalIdentity.materialKey));
      if(projections.every(row=>row.resultKind==='available'&&row.controlState==='released')){const fresh=seriesStore.admitBuild({scopeId,basis,existingMembers:[]});
        const next=submit(fresh,1);return {kind:'pending',buildId:fresh.objectId,workId:next.workId};}
      return {kind:'ready',reference:{scopeId,sharedVersion:stored.value.revision,manifestDigest:stored.value.digest,verificationDigest:stored.verificationDigest}};}
    const scope=current.active_build_id?seriesStore.build(current.active_build_id):seriesStore.admitBuild({scopeId,basis,existingMembers:[]}),rows=works(scope.objectId),latest=rows.at(-1);
    if(latest&&['failed','cancelled'].includes(latest.state)&&!retry)return {kind:'attention_required',buildId:scope.objectId,workId:latest.work_id};
    if(latest&&!['failed','cancelled'].includes(latest.state))return {kind:'pending',buildId:scope.objectId,workId:latest.work_id};
    if(latest&&retry){
      const noEffects=reassessmentFence(scope);
      if(noEffects){const imageSourceQualification=supplementalSources.length?scope.imageSourceQualification:(options.resolveSeriesImageSource?.(basis.sourceObservation)||buildImageSource(basis.sourceObservation)),
        fresh=seriesStore.admitBuild({scopeId,basis,existingMembers:scope.existingMembers,replaceFailedBuildId:scope.objectId,
          reassessmentFence:noEffects,imageSourceQualification,supplementalSources});
        const next=submit(fresh,1);return {kind:'pending',buildId:fresh.objectId,workId:next.workId};
      }
      if(supplementalSources.length)throw Object.assign(new Error('Recover the existing publication before changing its source.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
    }
    const definition=submit(scope,rows.length+1);return {kind:'pending',buildId:scope.objectId,workId:definition.workId};
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
    const cleanup=reclaimWorks(scope.objectId).at(-1);if(cleanup?.state==='failed')return {state:'attention_required',scopeId:current.scope_id,reasonCode:'series_shared_cleanup_failed'};
    try{const members=await seriesIo.inspectRoot(scope,scope.basis,stored.value);
      return {state:members.length===3?'healthy':'degraded',scopeId:current.scope_id,reasonCode:members.length===3?null:'series_shared_missing'};
    }catch(error){return {state:'attention_required',scopeId:current.scope_id,reasonCode:'series_shared_conflict',conflictCode:error.code||'ARCA_SERIES_CONFLICT'};}
  }
  function maintainEntry(context,{retry=false,supplementalSources=[]}={}){
    let current=entryScope(context.shelfEntryId);if(!current){if(context.raw.entry.structure_kind!=='season'||context.raw.identity.provider!=='tmdb')return {kind:'not_applicable'};
      current=seriesStore.registerMaintenance(maintenanceBasis(context));}
    const stored=Number(current.current_version)?seriesStore.manifest(current.scope_id,Number(current.current_version)):null;
    if(stored&&reclaimWorks(stored.value.buildId).at(-1)?.state==='failed')return {kind:'series_presentation_cleanup_pending',workId:reclaim(stored.value.buildId,{retry}).workId};
    const prior=stored&&seriesStore.build(stored.value.buildId),basis=prior&&prior.basis.schema!==MAINTENANCE&&seriesStore.read('entry_references',{shelf_entry_id:context.shelfEntryId}).some(row=>row.state==='active')?prior.basis:maintenanceBasis(context),
      scope=current.active_build_id?seriesStore.build(current.active_build_id):seriesStore.admitBuild({scopeId:current.scope_id,basis,existingMembers:stored?.value.members||[]}),
      rows=works(scope.objectId),latest=rows.at(-1);
    if(latest&&['failed','cancelled'].includes(latest.state)&&!retry)return {kind:'attention_required',scopeId:current.scope_id,workId:latest.work_id};
    if(latest&&!['failed','cancelled'].includes(latest.state))return {kind:'series_presentation_pending',scopeId:current.scope_id,workId:latest.work_id};
    const recoveryFence=latest&&retry?reassessmentFence(scope):null;
    if(recoveryFence){
      const fresh=seriesStore.admitBuild({scopeId:current.scope_id,basis:scope.basis.schema===MAINTENANCE?maintenanceBasis(context):scope.basis,existingMembers:scope.existingMembers,replaceFailedBuildId:scope.objectId,
        reassessmentFence:recoveryFence,supplementalSources,imageSourceQualification:supplementalSources.length?scope.imageSourceQualification:(options.resolveSeriesImageSource?.(scope.basis.sourceObservation)||scope.imageSourceQualification)}),next=submit(fresh,1);
      return {kind:'series_presentation_pending',scopeId:current.scope_id,workId:next.workId};
    }
    if(supplementalSources.length)throw Object.assign(new Error('Recover the existing file Effects before replacing its source.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
    const next=submit(scope,rows.length+1);return {kind:'series_presentation_pending',scopeId:current.scope_id,workId:next.workId};
  }
  async function prepareSupplements(context,body){
    const basis=context.packageValue?packageSeriesBasis(context.packageValue):null,current=context.shelfEntryId?entryScope(context.shelfEntryId):basis&&seriesStore.findByIdentity(context.shelf.shelfId,basis.sourceObservation.providerKey),scope=current?.active_build_id&&seriesStore.build(current.active_build_id);
    if(!scope||!Array.isArray(body.supplementalImages)||body.supplementalImages.length>2||new Set(body.supplementalImages.map(item=>item.artifactKind)).size!==body.supplementalImages.length)
      throw Object.assign(new TypeError('Supplement requires the failed original show task and unique image roles.'),{code:'ARCA_SERIES_SUPPLEMENT_INVALID'});
    options.unitOfWork.execute([createSeriesSourceReassessmentFence(options,scope.objectId)]);
    const sources=[];for(const item of body.supplementalImages){
      if(Object.keys(item).sort().join(',')!=='artifactKind,bytesBase64'||typeof item.bytesBase64!=='string'||item.bytesBase64.length>12*1024*1024)
        throw Object.assign(new TypeError('Show image upload exceeds its bounded format.'),{code:'ARCA_SERIES_SUPPLEMENT_INVALID'});
      const bytes=Buffer.from(item.bytesBase64,'base64');if(bytes.length>8*1024*1024||bytes.toString('base64')!==item.bytesBase64)throw Object.assign(new TypeError('Show image upload encoding is invalid.'),{code:'ARCA_SERIES_SUPPLEMENT_INVALID'});
      sources.push(await seriesIo.stageSupplement(scope,item.artifactKind,bytes,body.idempotencyKey));
    }return sources;
  }
  function issueForEntry(entryId){const current=entryScope(entryId);if(!current)return null;
    if(!current.active_build_id&&!Number(current.current_version))return null;
    const scope=current.active_build_id?seriesStore.build(current.active_build_id):seriesStore.build(seriesStore.manifest(current.scope_id,Number(current.current_version)).value.buildId),
      latest=(current.active_build_id?works(scope.objectId):reclaimWorks(scope.objectId)).at(-1);
    if(!latest||!['failed','cancelled'].includes(latest.state))return current.active_build_id?{state:'in_progress',canRetry:false,canSupplyImages:false,reasonCode:null}:null;
    let canSupplyImages=false;if(current.active_build_id)try{options.unitOfWork.execute([createSeriesSourceReassessmentFence(options,scope.objectId)]);canSupplyImages=true;}catch(error){if(error.code!=='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')throw error;}
    return {state:'attention_required',canRetry:true,canSupplyImages,reasonCode:current.active_build_id?'series_shared_preparation_failed':'series_shared_cleanup_failed'};
  }
  function reclaimWorks(buildId){return options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_series_presentation',processId:buildId,workKind:'series_presentation_reclaim'})
    .slice().sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms)||String(a.work_id).localeCompare(String(b.work_id)));}
  function reclaim(buildId,{retry=false}={}){const scope=seriesStore.build(buildId),rows=reclaimWorks(buildId),latest=rows.at(-1);
    if(latest&&(!retry||!['failed','cancelled'].includes(latest.state)))return {workId:latest.work_id};
    const definition=work(scope,rows.length+1,true),result=admission.replay(definition)||admission.submit(definition);
    if(result.kind==='invalid_contract')throw new Error('Shared reclamation Work admission failed.');return definition;}
  function pendingPage(cursor=null,limit=100){return seriesStore.read('scopes').filter(row=>row.scope_id>(cursor||'')&&(row.active_build_id||seriesStore.read('reservations',{scope_id:row.scope_id}).some(item=>item.state==='pending')))
    .sort((a,b)=>a.scope_id.localeCompare(b.scope_id)).slice(0,limit).map(row=>({cursor:row.scope_id,scope:{scopeId:row.scope_id}}));}
  function reconcileMaintenanceScope(scopeId){const current=seriesStore.readScope(scopeId),scope=current?.active_build_id&&seriesStore.build(current.active_build_id);
    if(!scope?.basis.entryBinding)return null;const context=legacyContext(scope.basis.entryBinding.shelfEntryId);return context?maintainEntry(context):null;}
  function reclaimPage(cursor=null,limit=100){return seriesWorkspaceStore.listActive().filter(row=>row.process_id>(cursor||'')&&seriesStore.read('version_build',{build_id:row.process_id}))
    .sort((a,b)=>a.process_id.localeCompare(b.process_id)).slice(0,limit).map(row=>({cursor:row.process_id,scope:{buildId:row.process_id}}));}
  return Object.freeze({rootSnapshot,seriesStore,seriesWorkspaceStore,seriesIo,seriesCommitStore,seriesReclaimStore,readReferences,reclaim,prepareSupplements,issueForEntry,headForEntry,pendingPage,reclaimPage,reconcileMaintenanceScope,reclaimWorks,works,ensure,verifyReady,entryScope,assessEntry,maintainEntry});
}
module.exports=Object.freeze({createSeriesPresentationServices});
