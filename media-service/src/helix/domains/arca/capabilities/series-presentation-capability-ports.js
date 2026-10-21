'use strict';

const crypto=require('node:crypto');
const {seriesOutcome:outcome}=require('../model/series-presentation-outcome');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {renderSeriesNfo}=require('../../../contracts/series-presentation-basis');
const {CAPS,assertSeriesScope,buildSharedManifest}=require('../model/series-presentation');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const type=name=>'helix://contracts/types/'+name+'/v1';
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

function createSeriesPresentationCapabilityPorts(options){
  const store=options.seriesStore,io=options.seriesIo,workspace=options.seriesWorkspaceStore,validator=options.contractValidator,now=options.now||Date.now;
  function scopeFor(execution){
    const scope=assertSeriesScope(execution.namedInputs?.seriesPresentationScope),frozen=store.build(scope.objectId),current=store.readScope(scope.scopeId);
    validator.validate(scope.schemaRef,scope);
    if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_series_presentation'||execution.ownerScope.processId!==scope.objectId||
        frozen?.digest!==scope.digest||current?.active_build_id!==scope.objectId||Number(current.current_version)!==scope.expectedVersion)
      fail('ARCA_SERIES_SCOPE_STALE','Shared preparation lost its exact active build.');
    return scope;
  }
  function predecessor(execution,name,scope){
    const value=execution.namedInputs['seriesPresentation'+name];validator.validate(type('SeriesPresentation'+name),value);
    if(value.scopeId!==scope.scopeId||value.buildId!==scope.objectId||value.scopeDigest!==scope.digest||value.basisDigest!==scope.digest)
      fail('ARCA_SERIES_PREDECESSOR_STALE','Shared preparation predecessor belongs to another build.');
    return value;
  }
  function evidence(ref,name,scope,payload){
    const body={scopeId:scope.scopeId,buildId:scope.objectId,scopeDigest:scope.digest,...payload};
    return {schemaRef:type('SeriesPresentation'+name),schemaVersion:1,evidenceId:stable('arca-series-evidence-',{ref,body}),
      evidenceKind:'series_presentation_'+name,producerRef:ref,basisDigest:scope.digest,payloadDigest:canonicalDigest(body),observedAtMs:now(),...body};
  }
  async function acquire(scope,kind,operationId,imagePath=null){
    const supplied=scope.supplementalSources.find(source=>source.artifactKind===kind);
    if(supplied){const locator='user-upload:'+supplied.uploadId;
      if(imagePath&&imagePath!==locator)fail('ARCA_SERIES_ASSET_SOURCE_CHANGED','Selected user input changed its exact locator.');
      return {resultKind:'acquired',bytes:io.readSupplement(scope,supplied),imagePath:locator,normalized:true,width:supplied.width,height:supplied.height};}
    if(!imagePath||imagePath==='local:'+kind){const local=await io.readLocalSource(scope,kind,{required:Boolean(imagePath)});
      if(local)return {resultKind:'acquired',...local};
      if(imagePath)fail('ARCA_SERIES_ASSET_SOURCE_CHANGED','Frozen local show material disappeared.');}
    const value=await options.fetchSeriesPresentationArtifact({operationId,source:scope.imageSourceQualification,artifactKind:kind,...(imagePath?{imagePath}:{})});
    if(value?.resultKind!=='acquired'||!Buffer.isBuffer(value.bytes)||typeof value.imagePath!=='string')
      fail('ARCA_SERIES_REQUIRED_ASSET_UNAVAILABLE','A required show image is unavailable.');
    return value;
  }
  function reusable(execution,ref){
    const rows=options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_series_presentation',processId:execution.ownerScope.processId,workKind:'series_presentation'});
    const results=rows.filter(row=>row.work_id!==execution.workId).flatMap(row=>options.workResultReader.read(row.work_id)).filter(row=>row.capabilityRef===ref&&row.outcomeKind==='succeeded');
    if(!results.length)return null;const value=results.at(-1).result;
    if(value.scopeDigest!==execution.namedInputs.seriesPresentationScope.digest)fail('ARCA_SERIES_PREDECESSOR_STALE','Retry source differs from the frozen build.');
    return value;
  }
  const ports={};
  ports[CAPS.source]={validateInputs:scopeFor,async execute(execution){
    const scope=scopeFor(execution),prior=reusable(execution,CAPS.source);
    if(prior)return outcome(CAPS.source,prior,scope,execution);
    const maintenance=require('../../../contracts/series-maintenance-basis');
    const retainedMembers=await io.inspectRoot(scope,scope.basis,scope.existingMembers.length?{members:scope.existingMembers}:null),recipe=[],missing=
      ['nfo','poster','fanart'].filter(kind=>!retainedMembers.some(member=>member.artifactKind===kind)),observedBasis=scope.basis.schema===maintenance.REQUEST&&missing.includes('nfo')?maintenance.observeMaintenanceBasis(scope.basis,await options.fetchSeriesPresentationMetadata(scope.basis)):scope.basis;
    for(const kind of missing){
      let bytes,sourcePath=null,sourceByteDigest=null,width=null,height=null;
      if(kind==='nfo'){const local=await io.readLocalSource(scope,kind);if(local){bytes=local.bytes;sourcePath=local.imagePath;sourceByteDigest=hash(bytes);}else bytes=renderSeriesNfo(observedBasis);}
      else {const value=await acquire(scope,kind,CAPS.source),normalized=value.normalized?value:await io.imageBytes(value.bytes,kind);
        bytes=normalized.bytes;width=normalized.width;height=normalized.height;sourcePath=value.imagePath;sourceByteDigest=hash(value.sourceBytes||value.bytes);}
      recipe.push({artifactKind:kind,sourcePath,sourceByteDigest,byteDigest:hash(bytes),sizeBytes:bytes.length,width,height,
        nfoProviderKey:kind==='nfo'?scope.basis.sourceObservation.providerKey:null});
    }
    scopeFor(execution);return outcome(CAPS.source,evidence(CAPS.source,'SourceObserved',scope,{observedBasis,recipe,recipeDigest:canonicalDigest(recipe),retainedMembers}),scope,execution);
  },validateResult(execution,value){const scope=scopeFor(execution),result=value.result;validator.validate(type('SeriesPresentationSourceObserved'),result);
    if(result.recipeDigest!==canonicalDigest(result.recipe)||canonicalJson([...result.recipe.map(item=>item.artifactKind),...result.retainedMembers.map(item=>item.artifactKind)].sort())!==canonicalJson(['fanart','nfo','poster']))
      fail('ARCA_SERIES_RECIPE_INVALID','Show source recipe does not conserve the missing roles.');}};
  ports[CAPS.assets]={validateInputs(execution){const scope=scopeFor(execution);predecessor(execution,'SourceObserved',scope);},async execute(execution){
    const scope=scopeFor(execution),source=predecessor(execution,'SourceObserved',scope),artifacts=[],prior=reusable(execution,CAPS.assets);
    if(prior){for(const item of prior.artifacts)workspace.resolve(scope,item.workspaceMaterialHandle);return outcome(CAPS.assets,prior,scope,execution,'workspace_write');}
    workspace.ensure(scope);
    for(const recipe of source.recipe){
      let bytes;if(recipe.artifactKind==='nfo'){if(recipe.sourcePath){const local=await io.readLocalSource(scope,'nfo',{required:true});if(!local||hash(local.bytes)!==recipe.sourceByteDigest)fail('ARCA_SERIES_ASSET_SOURCE_CHANGED','Frozen local show document changed.');bytes=local.bytes;}else bytes=renderSeriesNfo(source.observedBasis);}
      else {const value=await acquire(scope,recipe.artifactKind,CAPS.assets,recipe.sourcePath);
        if(value.imagePath!==recipe.sourcePath||hash(value.sourceBytes||value.bytes)!==recipe.sourceByteDigest)fail('ARCA_SERIES_ASSET_SOURCE_CHANGED','Selected show image bytes changed.');
        bytes=value.normalized?value.bytes:(await io.imageBytes(value.bytes,recipe.artifactKind)).bytes;}
      if(hash(bytes)!==recipe.byteDigest||bytes.length!==recipe.sizeBytes)fail('ARCA_SERIES_ASSET_RECIPE_CHANGED','Show artifact differs from its frozen recipe.');
      scopeFor(execution);const value=io.writeWorkspace(scope,recipe.artifactKind,bytes,{...execution,shouldContinue:()=>{scopeFor(execution);return execution.shouldContinue?.()!==false;}});
      workspace.register(scope,value);artifacts.push(value);
    }
    return outcome(CAPS.assets,evidence(CAPS.assets,'AssetsPrepared',scope,{recipeDigest:source.recipeDigest,retainedMembers:source.retainedMembers,artifacts}),scope,execution,'workspace_write');
  },validateResult(execution,value){const scope=scopeFor(execution),source=predecessor(execution,'SourceObserved',scope),result=value.result;
    validator.validate(type('SeriesPresentationAssetsPrepared'),result);
    if(result.recipeDigest!==source.recipeDigest||canonicalJson(result.artifacts.map(item=>item.artifactKind))!==canonicalJson(source.recipe.map(item=>item.artifactKind))||canonicalJson(result.retainedMembers)!==canonicalJson(source.retainedMembers))fail('ARCA_SERIES_ASSETS_INVALID','Prepared show artifacts changed their exact recipe.');
    for(const item of result.artifacts){workspace.resolve(scope,item.workspaceMaterialHandle);const recipe=source.recipe.find(row=>row.artifactKind===item.artifactKind);
      if(recipe.byteDigest!==item.workspaceMaterialHandle.digestHex||recipe.sizeBytes!==item.workspaceMaterialHandle.sizeBytes)fail('ARCA_SERIES_ASSETS_INVALID','Prepared show bytes changed.');}}};
  ports[CAPS.publish]={validateInputs(execution){const scope=scopeFor(execution);predecessor(execution,'AssetsPrepared',scope);},async execute(execution){
    const scope=scopeFor(execution),prepared=predecessor(execution,'AssetsPrepared',scope);
    for(const artifact of prepared.artifacts)workspace.resolve(scope,artifact.workspaceMaterialHandle);
    const physical=await io.publish(scope,prepared.artifacts,{...execution,shouldContinue:()=>{scopeFor(execution);return execution.shouldContinue?.()!==false;}},prepared.retainedMembers),
      members=physical.members.map(member=>prepared.artifacts.some(item=>item.artifactKind===member.artifactKind)?{...member,sourceDigest:canonicalDigest({schema:'arca.series-artifact-source@1',
        imageQualificationDigest:scope.imageSourceQualification.qualificationDigest,localQualificationDigest:scope.basis.localSource?.qualificationDigest||null,recipeDigest:prepared.recipeDigest,supplementDigest:scope.supplementalSources.find(item=>item.artifactKind===member.artifactKind)?.qualificationDigest||null})}:member),
      manifest=buildSharedManifest(scope,members);
    scopeFor(execution);return outcome(CAPS.publish,evidence(CAPS.publish,'FilesPublished',scope,{manifest}),scope,execution,'material_commit');
  },validateResult(execution,value){const scope=scopeFor(execution);validator.validate(type('SeriesPresentationFilesPublished'),value.result);
    if(buildSharedManifest(scope,value.result.manifest.members).digest!==value.result.manifest.digest)fail('ARCA_SERIES_MANIFEST_INVALID','Published manifest changed its frozen scope.');}};
  ports[CAPS.commit]={validateInputs(execution){const prior=options.seriesCommitStore.readEvent(execution);if(prior)return;const scope=scopeFor(execution);predecessor(execution,'FilesPublished',scope);},async execute(execution){
    const prior=options.seriesCommitStore.readEvent(execution);if(prior)return prior;
    const scope=scopeFor(execution),published=predecessor(execution,'FilesPublished',scope),verificationDigest=await io.verifyManifest(scope,published.manifest);
    return options.seriesCommitStore.commit(execution,{scope,manifest:published.manifest,verificationDigest,outcome});
  },validateResult(execution,value){validator.validate(type('SeriesPresentationReady'),value.result);const persisted=options.seriesCommitStore.readEvent(execution);
    if(!persisted||canonicalJson(persisted)!==canonicalJson(value))fail('ARCA_SERIES_COMMIT_INTEGRITY','Ready result lacks its atomic version and Control commit.');}};
  function reclaimContext(execution){
    workspace.assertRoot();
    const scope=assertSeriesScope(execution.namedInputs.seriesPresentationScope),prepared=execution.namedInputs.seriesPresentationAssetsPrepared,ready=execution.namedInputs.seriesPresentationReady;
    validator.validate(type('SeriesPresentationAssetsPrepared'),prepared);validator.validate(type('SeriesPresentationReady'),ready);
    const committed=store.manifest(scope.scopeId,scope.expectedVersion+1);
    if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_series_presentation'||execution.ownerScope.processId!==scope.objectId||
        prepared.scopeDigest!==scope.digest||ready.scopeDigest!==scope.digest||ready.buildId!==scope.objectId||committed?.value.digest!==ready.manifestDigest||committed.value.buildId!==scope.objectId)
      fail('ARCA_SERIES_WORKSPACE_RECLAIM_FENCE','Reclamation requires its exact committed build and successful source results.');
    return {scope,prepared,ready};
  }
  ports[CAPS.reclaim]={validateInputs:reclaimContext,execute(execution){
    const {scope,prepared,ready}=reclaimContext(execution),prior=options.seriesReclaimStore.readEvent(execution,scope);
    if(prior){io.verifyReclaimed(scope,prepared.artifacts);return prior;}
    io.reclaim(scope,prepared.artifacts,{...execution,shouldContinue:()=>{reclaimContext(execution);return execution.shouldContinue?.()!==false;}});
    return options.seriesReclaimStore.commit(execution,scope,prepared,ready,()=>io.verifyReclaimed(scope,prepared.artifacts));
  },validateResult(execution,value){const {scope,prepared}=reclaimContext(execution);validator.validate(type('SeriesPresentationWorkspaceReclaimed'),value.result);
    if(canonicalJson(options.seriesReclaimStore.readEvent(execution,scope))!==canonicalJson(value))fail('ARCA_SERIES_WORKSPACE_RECLAIM_FENCE','Reclamation lacks its atomic Result.');io.verifyReclaimed(scope,prepared.artifacts);
  },observeEffectReality(context){try{const scope=store.build(context.work.process_id),refs=options.readReferences(scope),prepared=refs.find(row=>row.capabilityRef===CAPS.assets)?.result;
    if(context.work.owner_domain!=='arca'||context.work.process_type!=='arca_series_presentation'||context.work.work_kind!=='series_presentation_reclaim'||!prepared||context.event.capability_ref!==CAPS.reclaim)
      fail('ARCA_SERIES_WORKSPACE_RECLAIM_FENCE','Reclamation recovery scope changed.');
    return io.reclaim(scope,prepared.artifacts,{shouldContinue:()=>true},{observeOnly:true});
  }catch(error){return {status:'conflict',cleanupDeclared:false,evidenceDigest:canonicalDigest({schema:'arca.series-reclamation-recovery-conflict@1',reasonCode:error.code||'ARCA_SERIES_RECOVERY_INVALID'})};}}};
  for(const [ref,formal,inputName,predecessorRef] of [[CAPS.assets,false,'seriesPresentationSourceObserved',CAPS.source],[CAPS.publish,true,'seriesPresentationAssetsPrepared',CAPS.assets]]){
    ports[ref].observeEffectReality=async context=>{
      try{
        const scope=store.build(context.work?.process_id);
        if(!scope||context.work.owner_domain!=='arca'||context.work.process_type!=='arca_series_presentation'||context.event?.work_id!==context.work.work_id||
            context.event.capability_ref!==ref||context.node?.capability_ref!==ref||context.effect?.effect_class!==(formal?'material_commit':'workspace_write'))
          fail('ARCA_SERIES_RECOVERY_SCOPE_INVALID','Shared recovery context is outside its exact Work and Effect.');
        const binding=JSON.parse(context.node.input_bindings_json).bindings.find(item=>item.portName===inputName),
          rows=options.workResultReader.read(context.work.work_id).filter(row=>row.eventId===binding?.eventId&&row.outcomeKind==='succeeded'&&row.capabilityRef===predecessorRef);
        if(binding?.bindingKind!=='projected_event_result'||rows.length!==1||rows[0].result.scopeDigest!==scope.digest)
          fail('ARCA_SERIES_RECOVERY_SOURCE_INVALID','Shared recovery lost its exact successful predecessor.');
        const value=rows[0].result;validator.validate(value.schemaRef,value);
        const expectations=formal?value.artifacts.map(item=>({artifactKind:item.artifactKind,byteDigest:item.workspaceMaterialHandle.digestHex,sizeBytes:item.workspaceMaterialHandle.sizeBytes})):value.recipe;
        const observed=io.observeWrites(scope,expectations,{formal,registry:formal?null:workspace.inspect(scope)});
        return formal?{status:observed.status!=='conflict'||observed.cleanupDeclared?'forward_required':'conflict',rollbackDeclared:false,evidenceDigest:observed.evidenceDigest}:observed;
      }catch(error){return {status:'conflict',...(formal?{rollbackDeclared:false}:{cleanupDeclared:false}),evidenceDigest:canonicalDigest({schema:'arca.series-recovery-conflict@1',
        buildId:context.work?.process_id||null,eventId:context.event?.event_id||null,reasonCode:error.code||'ARCA_SERIES_RECOVERY_INVALID'})};}
    };
  }
  for(const port of Object.values(ports)){const execute=port.execute;port.execute=async execution=>{try{return await execute(execution);}catch(error){
    if(!/^(ARCA_SERIES_(REQUIRED_ASSET_UNAVAILABLE|ASSET_SOURCE_CHANGED|ASSET_RECIPE_CHANGED|EXTERNAL_CHANGE|IDENTITY_CONFLICT|LOCAL_IDENTITY_UNPROVEN|TARGET_CONFLICT|WORKSPACE_CONFLICT|WORKSPACE_NOT_RECLAIMED)|PLATFORM_INTEGRATION_(NETWORK_FAILED|HTTP_FAILED)|EACCES|ENOSPC|EPERM)$/.test(error.code||''))throw error;
    return {kind:'failed',failureClass:'series_presentation_precondition',code:error.code,message:'Required show presentation could not be completed.',retryDirective:'never',
      evidence:{reasonCode:error.code,buildId:execution.ownerScope.processId}};}};}
  return Object.freeze(ports);
}
module.exports=Object.freeze({createSeriesPresentationCapabilityPorts});
