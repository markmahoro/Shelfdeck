'use strict';

const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {packageSeriesBasis,seriesScopeId,assertRootBinding,buildSeriesScope,assertSeriesScope,assertSharedManifest,buildSharedManifest}=require('../model/series-presentation');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const columns=Object.freeze({
  scopes:['scope_id','shelf_id','provider','provider_key','endpoint_id','mount_scope_id','shelf_root','root_location','placement_revision',
    'current_version','active_build_id','state_revision','state_digest','created_at_ms','updated_at_ms'],
  builds:['build_id','scope_id','revision','expected_version','basis_schema_ref','basis_json','basis_digest','scope_schema_ref','scope_json','scope_digest','created_at_ms'],
  versions:['scope_id','revision','build_id','manifest_schema_ref','manifest_json','manifest_digest','verification_digest','committed_at_ms'],
  reservations:['scope_id','on_deck_run_id','custody_id','state','committed_version','target_binding_digest','created_at_ms','updated_at_ms'],
  references:['scope_id','shelf_entry_id','first_committed_version','state','reference_revision','reference_digest','created_at_ms','released_at_ms'],
  commit_links:['commit_link_id','on_deck_run_id','scope_id','shared_version','manifest_digest','verification_digest','committed_at_ms'],
});

function definition(schemaManifest){
  const statements={};
  for(const [name,fields] of Object.entries(columns))statements['insert_'+name]={kind:'insert',tableId:'arca_series_presentation_'+name,columns:fields};
  const find=(name,table,keys,many=false)=>{statements[name]={kind:many?'select-all':'select-one',tableId:'arca_series_presentation_'+table,
    columns:columns[table],keyColumns:keys,safeIntegers:true};};
  find('scope','scopes',['scope_id']);find('identity','scopes',['shelf_id','provider','provider_key']);find('scopes','scopes',[],true);
  find('build','builds',['build_id']);find('builds','builds',['scope_id'],true);find('version','versions',['scope_id','revision']);
  find('reservation','reservations',['scope_id','on_deck_run_id']);find('run_reservation','reservations',['on_deck_run_id']);
  find('reservations','reservations',['scope_id'],true);find('reference','references',['scope_id','shelf_entry_id']);
  find('references','references',['scope_id'],true);find('commit_link','commit_links',['on_deck_run_id']);
  statements.advance={kind:'update',tableId:'arca_series_presentation_scopes',setColumns:['current_version','active_build_id','state_revision','state_digest','updated_at_ms'],
    keyColumns:['scope_id'],compareColumns:[{column:'state_revision',parameter:'expected_revision'},{column:'state_digest',parameter:'expected_digest'}]};
  statements.commit_reservation={kind:'update',tableId:'arca_series_presentation_reservations',setColumns:['state','committed_version','updated_at_ms'],
    keyColumns:['scope_id','on_deck_run_id'],compareColumns:[{column:'state',parameter:'expected_state'}]};
  statements.release_reference={kind:'update',tableId:'arca_series_presentation_references',setColumns:['state','reference_revision','reference_digest','released_at_ms'],
    keyColumns:['scope_id','shelf_entry_id'],compareColumns:[{column:'reference_revision',parameter:'expected_revision'},{column:'reference_digest',parameter:'expected_digest'}]};
  return createRepositoryDefinition({repositoryId:'arca_series_presentation',owner:'arca',schemaManifest,statements});
}

function createSeriesPresentationStore(options){
  const repository=definition(options.schemaManifest);
  const participant=(id,execute)=>({participantId:id,owner:'arca',repositories:[repository],execute:c=>execute(c.repository(repository.repositoryId),c)});
  const read=(name,args={})=>options.unitOfWork.execute([participant('arca_series_read',r=>r.invoke(name,args))]).arca_series_read;
  function manifest(scopeId,revision){const row=read('version',{scope_id:scopeId,revision});
    if(!row)return null;const value=assertSharedManifest(JSON.parse(row.manifest_json));
    const frozen=build(value.buildId);
    options.contractValidator.validate(value.schemaRef,value);
    if(!frozen||buildSharedManifest(frozen,value.members).digest!==value.digest||value.digest!==row.manifest_digest||value.scopeId!==scopeId||value.revision!==revision)
      fail('ARCA_SERIES_MANIFEST_CORRUPT','Shared Inventory does not match its version row.');
    return {value,verificationDigest:row.verification_digest};}
  function build(buildId){const row=read('build',{build_id:buildId});if(!row)return null;
    const value=assertSeriesScope(JSON.parse(row.scope_json));
    if(value.digest!==row.scope_digest||value.basis.basisDigest!==row.basis_digest||canonicalJson(value.basis)!==row.basis_json)
      fail('ARCA_SERIES_BUILD_CORRUPT','Shared build does not conserve its immutable basis.');return value;}
  function advance(r,current,values,at){const revision=Number(current.state_revision)+1,
    digest=canonicalDigest({schema:'arca.series-presentation-head@1',scopeId:current.scope_id,revision,...values});
    const result=r.invoke('advance',{scope_id:current.scope_id,expected_revision:Number(current.state_revision),expected_digest:current.state_digest,
      current_version:values.currentVersion,active_build_id:values.activeBuildId,state_revision:revision,state_digest:digest,updated_at_ms:at});
    if(result.changes!==1)fail('ARCA_SERIES_SCOPE_STALE','Shared presentation changed concurrently.');}

  function scopeParticipant(scope){
    assertSeriesScope(scope);
    return participant('arca_series_build_fence',r=>{
      const current=r.invoke('scope',{scope_id:scope.scopeId}),frozen=r.invoke('build',{build_id:scope.objectId});
      if(!current||current.active_build_id!==scope.objectId||Number(current.current_version)!==scope.expectedVersion||frozen?.scope_digest!==scope.digest)
        fail('ARCA_SERIES_SCOPE_STALE','Series preparation no longer owns its exact active builder and version.');
    });
  }

  function reservationParticipant(request){
    const basis=packageSeriesBasis(request.package);if(!basis)return null;
    const source=basis.sourceObservation,shelf=request.shelf,target=shelf.target,scopeId=seriesScopeId(shelf.shelfId,source.providerKey),
      root=assertRootBinding({shelfRoot:target.rootLocation,rootLocation:path.dirname(request.targetLocation)}),
      targetDigest=canonicalDigest({endpointId:target.endpointId,mountScopeId:target.mountScopeId,rootLocation:root});
    return participant('arca_series_reservation',(r,c)=>{
      let current=r.invoke('scope',{scope_id:scopeId});
      if(current&&(current.endpoint_id!==target.endpointId||current.mount_scope_id!==target.mountScopeId||current.root_location!==root))
        fail('ARCA_SERIES_PLACEMENT_CONFLICT','This Series already has another formal root binding.');
      if(!current){const row={scope_id:scopeId,shelf_id:shelf.shelfId,provider:'tmdb',provider_key:source.providerKey,
        endpoint_id:target.endpointId,mount_scope_id:target.mountScopeId,shelf_root:path.resolve(target.rootLocation),root_location:root,
        placement_revision:shelf.currentPlacementRevision,current_version:0,active_build_id:null,state_revision:1,
        state_digest:canonicalDigest({schema:'arca.series-presentation-admission@1',scopeId,targetDigest}),created_at_ms:c.commitTimeMs,updated_at_ms:c.commitTimeMs};
        r.invoke('insert_scopes',row);current=row;}
      const prior=r.invoke('reservation',{scope_id:scopeId,on_deck_run_id:request.onDeckRunId});
      if(prior){if(prior.target_binding_digest!==targetDigest||prior.custody_id!==request.custodyId)
        fail('ARCA_SERIES_RESERVATION_CONFLICT','Series pending reservation does not match its accepted custody.');return;}
      r.invoke('insert_reservations',{scope_id:scopeId,on_deck_run_id:request.onDeckRunId,custody_id:request.custodyId,state:'pending',
        committed_version:null,target_binding_digest:targetDigest,created_at_ms:c.commitTimeMs,updated_at_ms:c.commitTimeMs});
    });
  }

  function admitBuild({scopeId,basis,existingMembers,replaceFailedBuildId=null}){
    return options.unitOfWork.execute([participant('arca_series_build_admit',(r,c)=>{
      const current=r.invoke('scope',{scope_id:scopeId});if(!current)fail('ARCA_SERIES_SCOPE_MISSING','Shared scope has no accepted responsibility.');
      if(current.active_build_id&&current.active_build_id===replaceFailedBuildId&&
          options.assertRecoverableSeriesBuild?.({buildId:replaceFailedBuildId,scopeId,basisDigest:basis.basisDigest})!==true)
        fail('ARCA_SERIES_BUILD_RECOVERY_NOT_VERIFIED','Replacing a failed builder requires verified terminal Effects and an explicit recovery basis.');
      if(current.active_build_id&&current.active_build_id!==replaceFailedBuildId)return JSON.parse(r.invoke('build',{build_id:current.active_build_id}).scope_json);
      const revision=Number(current.state_revision),
        buildId=stable('arca-series-build-',{scopeId,revision,expectedVersion:Number(current.current_version),basisDigest:basis.basisDigest}),
        scope=buildSeriesScope({buildId,scopeId,shelfId:current.shelf_id,revision,expectedVersion:Number(current.current_version),
          endpointId:current.endpoint_id,mountScopeId:current.mount_scope_id,shelfRoot:current.shelf_root,rootLocation:current.root_location,basis,existingMembers});
      options.contractValidator.validate(scope.schemaRef,scope);
      r.invoke('insert_builds',{build_id:buildId,scope_id:scopeId,revision,expected_version:scope.expectedVersion,
        basis_schema_ref:'shelfdeck.series-presentation-basis@1',basis_json:canonicalJson(basis),basis_digest:basis.basisDigest,
        scope_schema_ref:scope.schemaRef,scope_json:canonicalJson(scope),scope_digest:scope.digest,created_at_ms:c.commitTimeMs});
      advance(r,current,{currentVersion:scope.expectedVersion,activeBuildId:buildId},c.commitTimeMs);return scope;
    })]).arca_series_build_admit;
  }

  function versionParticipant(scope,value,verificationDigest){
    assertSeriesScope(scope);assertSharedManifest(value);
    options.contractValidator.validate(scope.schemaRef,scope);options.contractValidator.validate(value.schemaRef,value);
    return participant('arca_series_version',(r,c)=>{
      const current=r.invoke('scope',{scope_id:scope.scopeId});
      if(!current||current.active_build_id!==scope.objectId||Number(current.current_version)!==scope.expectedVersion||
          value.buildId!==scope.objectId||value.revision!==scope.expectedVersion+1||value.basisDigest!==scope.basis.basisDigest)
        fail('ARCA_SERIES_SCOPE_STALE','Shared Inventory publication lost its exact builder and version.');
      r.invoke('insert_versions',{scope_id:scope.scopeId,revision:value.revision,build_id:scope.objectId,manifest_schema_ref:value.schemaRef,
        manifest_json:canonicalJson(value),manifest_digest:value.digest,verification_digest:verificationDigest,committed_at_ms:c.commitTimeMs});
      advance(r,current,{currentVersion:value.revision,activeBuildId:null},c.commitTimeMs);
    });
  }

  function commitReferenceParticipant(request,shelfEntryId){
    const basis=packageSeriesBasis(request.package);if(!basis)return null;
    const reference=request.fulfillmentVerification.seriesPresentationRef;
    if(!reference)fail('ARCA_SERIES_PRESENTATION_NOT_READY','Season Commit requires exact verified shared presentation.');
    const scopeId=seriesScopeId(request.shelf.shelfId,basis.sourceObservation.providerKey);
    return participant('arca_series_commit_reference',(r,c)=>{
      const current=r.invoke('scope',{scope_id:scopeId}),version=r.invoke('version',{scope_id:scopeId,revision:reference.sharedVersion}),
        reservation=r.invoke('reservation',{scope_id:scopeId,on_deck_run_id:request.onDeckRunId});
      if(reference.scopeId!==scopeId||!current||current.active_build_id!==null||Number(current.current_version)!==reference.sharedVersion||
          !version||version.manifest_digest!==reference.manifestDigest||version.verification_digest!==reference.verificationDigest||
          !reservation||reservation.state!=='pending'||reservation.custody_id!==request.custodyId)
        fail('ARCA_SERIES_COMMIT_FENCE_STALE','Shared presentation changed after fulfillment verification.');
      const prior=r.invoke('reference',{scope_id:scopeId,shelf_entry_id:shelfEntryId});
      if(prior&&prior.state!=='active')fail('ARCA_SERIES_REFERENCE_RELEASED','A released Season reference cannot be silently resurrected.');
      if(!prior)r.invoke('insert_references',{scope_id:scopeId,shelf_entry_id:shelfEntryId,first_committed_version:reference.sharedVersion,
        state:'active',reference_revision:1,reference_digest:canonicalDigest({scopeId,shelfEntryId,firstVersion:reference.sharedVersion}),
        created_at_ms:c.commitTimeMs,released_at_ms:null});
      r.invoke('insert_commit_links',{commit_link_id:stable('arca-series-commit-',{onDeckRunId:request.onDeckRunId}),on_deck_run_id:request.onDeckRunId,
        scope_id:scopeId,shared_version:reference.sharedVersion,manifest_digest:reference.manifestDigest,verification_digest:reference.verificationDigest,committed_at_ms:c.commitTimeMs});
      if(r.invoke('commit_reservation',{scope_id:scopeId,on_deck_run_id:request.onDeckRunId,expected_state:'pending',state:'committed',
        committed_version:reference.sharedVersion,updated_at_ms:c.commitTimeMs}).changes!==1)fail('ARCA_SERIES_RESERVATION_STALE','Season pending reference changed concurrently.');
    });
  }

  return Object.freeze({repository,participant,read,readScope:scopeId=>read('scope',{scope_id:scopeId}),
    findByIdentity:(shelfId,providerKey)=>read('identity',{shelf_id:shelfId,provider:'tmdb',provider_key:providerKey}),
    build,manifest,scopeParticipant,reservationParticipant,admitBuild,versionParticipant,commitReferenceParticipant});
}

module.exports=Object.freeze({columns,definition,createSeriesPresentationStore});
