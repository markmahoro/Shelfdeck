'use strict';

const path=require('node:path');
const relocationGate=require('./series-root-relocation-gate');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createMaterialControlAdmissionReadParticipant,createMaterialControlParticipant,createMaterialControlProjectionPort,controlScopeDigest}=require('../../../foundation/persistence/material-control');
const {readControlProjections}=require('./read-control-projections');
const {packageSeriesBasis,seriesScopeId,assertRootBinding,buildSeriesScope,assertSeriesScope,assertSharedManifest,buildSharedManifest}=require('../model/series-presentation');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const columns=Object.freeze({
  scopes:['scope_id','shelf_id','provider','provider_key','endpoint_id','mount_scope_id','shelf_root','root_location','placement_revision',
    'current_version','active_build_id','retirement_scope_id','state_revision','state_digest','created_at_ms','updated_at_ms'],
  builds:['build_id','scope_id','revision','expected_version','basis_schema_ref','basis_json','basis_digest','scope_schema_ref','scope_json','scope_digest','created_at_ms'],
  versions:['scope_id','revision','build_id','manifest_schema_ref','manifest_json','manifest_digest','verification_digest','committed_at_ms'],
  reservations:['scope_id','on_deck_run_id','custody_id','state','committed_version','target_binding_digest','created_at_ms','updated_at_ms'],
  references:['scope_id','shelf_entry_id','first_committed_version','state','reference_revision','reference_digest','created_at_ms','released_at_ms'],
  commit_links:['commit_link_id','on_deck_run_id','scope_id','shared_version','manifest_digest','verification_digest','committed_at_ms'],
});

function definition(schemaManifest){
  const source=require('./inventory-context-statements');
  const statements=Object.fromEntries(['find_entry','find_shelf','find_identity','find_inventory','list_materials'].map(key=>[key,source[key]]));
  Object.assign(statements,relocationGate.statements);
  statements.shelf_entries={kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision'],keyColumns:['shelf_id'],safeIntegers:true};
  for(const [name,fields] of Object.entries(columns))statements['insert_'+name]={kind:'insert',tableId:'arca_series_presentation_'+name,columns:fields};
  const find=(name,table,keys,many=false)=>{statements[name]={kind:many?'select-all':'select-one',tableId:'arca_series_presentation_'+table,
    columns:columns[table],keyColumns:keys,safeIntegers:true};};
  find('scope','scopes',['scope_id']);find('identity','scopes',['shelf_id','provider','provider_key']);find('scopes','scopes',[],true);
  find('version_build','versions',['build_id']);find('build','builds',['build_id']);find('builds','builds',['scope_id'],true);find('version','versions',['scope_id','revision']);
  find('reservation','reservations',['scope_id','on_deck_run_id']);find('run_reservation','reservations',['on_deck_run_id']);
  find('reservations','reservations',['scope_id'],true);find('reference','references',['scope_id','shelf_entry_id']);
  find('references','references',['scope_id'],true);find('commit_link','commit_links',['on_deck_run_id']);
  find('entry_references','references',['shelf_entry_id'],true);
  statements.advance={kind:'update',tableId:'arca_series_presentation_scopes',setColumns:['current_version','active_build_id','retirement_scope_id','state_revision','state_digest','updated_at_ms'],
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
      current_version:values.currentVersion,active_build_id:values.activeBuildId,retirement_scope_id:values.retirementScopeId===undefined?(current.retirement_scope_id??null):values.retirementScopeId,state_revision:revision,state_digest:digest,updated_at_ms:at});
    if(result.changes!==1)fail('ARCA_SERIES_SCOPE_STALE','Shared presentation changed concurrently.');}
  function unusedUsing(r,current){return !r.invoke('references',{scope_id:current.scope_id}).some(row=>row.state==='active')&&!r.invoke('reservations',{scope_id:current.scope_id}).some(row=>row.state==='pending')&&!otherSeasons(r,current,null);}
  function unused(scopeId){return options.unitOfWork.execute([participant('arca_series_unused_read',r=>{const current=r.invoke('scope',{scope_id:scopeId});return Boolean(current&&!current.retirement_scope_id&&unusedUsing(r,current));})]).arca_series_unused_read;}
  function formationRetirementPreview(scopeId, retiringOnDeckIds = []) {
    const ids = new Set(retiringOnDeckIds);
    return options.unitOfWork.execute([participant('arca_series_formation_retirement_preview', r => {
      const current = r.invoke('scope', { scope_id: scopeId });
      if (!current || current.retirement_scope_id) fail('ARCA_SERIES_RETIREMENT_STALE', 'Shared presentation is missing or under Off-deck retirement.');
      const references = r.invoke('references', { scope_id: scopeId }).filter(row => row.state === 'active');
      const reservations = r.invoke('reservations', { scope_id: scopeId }).filter(row => row.state === 'pending' && !ids.has(row.on_deck_run_id));
      const hasSeason = otherSeasons(r, current, null);
      return { current, retire: !references.length && !reservations.length && !hasSeason };
    })]).arca_series_formation_retirement_preview;
  }
  function retainedRetirementParticipant(current){return participant('arca_series_retained_retirement',(r,c)=>{const fresh=r.invoke('scope',{scope_id:current.scope_id});
    if(fresh?.state_digest!==current.state_digest||fresh.retirement_scope_id||!unusedUsing(r,fresh))fail('ARCA_SERIES_RETIREMENT_STALE','Retained root acquired another collection obligation.');
    advance(r,fresh,{currentVersion:Number(fresh.current_version),activeBuildId:null},c.commitTimeMs);
  });}

  function normalizeFreshResetHeads(description) {
    const { digest, ...body } = description || {};
    if (body.schemaRef !== 'arca.fresh-reset-series-retention@1' || canonicalDigest(body) !== digest ||
        !Array.isArray(body.droppedHeads) || !Array.isArray(body.preservedBuilders))
      fail('ARCA_RESET_SERIES_DESCRIPTION_INVALID', 'Reset lost its frozen Arca retention decision.');
    return options.unitOfWork.execute([participant('arca_fresh_reset_series_heads', (r, c) => {
      for (const kept of body.preservedBuilders) {
        const current = r.invoke('scope', { scope_id: kept.scopeId }), row = r.invoke('build', { build_id: kept.buildId });
        if (current?.active_build_id !== kept.buildId || row?.scope_digest !== kept.scopeDigest)
          fail('ARCA_RESET_MAINTENANCE_LOST', 'Collection maintenance must survive the retained generation.');
      }
      const results = [];
      for (const dropped of body.droppedHeads) {
        const current = r.invoke('scope', { scope_id: dropped.scopeId });
        if (!current) continue;
        if (r.invoke('build', { build_id: dropped.buildId }) ||
            r.invoke('reservations', { scope_id: dropped.scopeId }).some(row => row.state === 'pending'))
          fail('ARCA_RESET_UNCOMMITTED_SERIES_RETAINED', 'An incoming Series build or reservation remains online.');
        if (current.active_build_id !== dropped.buildId || current.state_digest !== dropped.headDigest ||
            Number(current.current_version) !== dropped.currentVersion)
          fail('ARCA_RESET_SERIES_HEAD_CHANGED', 'The retained Series head changed after the reset snapshot.');
        // Keep committed versions, root bindings, references, Control and any
        // Off-deck retirement. Only the discarded incoming builder is detached.
        advance(r, current, { currentVersion: Number(current.current_version), activeBuildId: null,
          retirementScopeId: current.retirement_scope_id ?? null }, c.commitTimeMs);
        results.push({ scopeId: dropped.scopeId, oldHeadDigest: dropped.headDigest,
          newHeadDigest: r.invoke('scope', { scope_id: dropped.scopeId }).state_digest });
      }
      return { descriptionDigest: digest, normalized: results, preservedBuilders: body.preservedBuilders };
    })]).arca_fresh_reset_series_heads;
  }

  function maintenanceFence(r,basis){
    if(basis.schema!=='shelfdeck.series-presentation-maintenance@1')return;
    const b=basis.entryBinding,entry=r.invoke('find_entry',{shelf_entry_id:b.shelfEntryId}),identity=entry&&r.invoke('find_identity',{shelf_entry_id:b.shelfEntryId,revision:Number(entry.canonical_identity_revision)}),
      inventory=entry&&r.invoke('find_inventory',{shelf_entry_id:b.shelfEntryId,revision:Number(entry.current_inventory_revision)}),shelf=r.invoke('find_shelf',{shelf_id:b.shelfId});
    if(!entry||entry.status!=='active'||entry.structure_kind!=='season'||entry.shelf_id!==b.shelfId||Number(entry.current_inventory_revision)!==b.inventoryRevision||Number(entry.canonical_identity_revision)!==b.identityRevision||
      identity?.identity_digest!==b.identityDigest||identity.provider!=='tmdb'||String(identity.provider_key)!==basis.sourceObservation.providerKey||inventory?.representation_digest!==b.inventoryDigest||shelf?.status!=='active'||
      !r.invoke('list_materials',{shelf_entry_id:b.shelfEntryId,inventory_revision:b.inventoryRevision}).some(row=>row.role==='primary_payload'&&path.dirname(path.dirname(row.location))===b.rootLocation))
      fail('ARCA_SERIES_MAINTENANCE_STALE','Committed Season changed before shared presentation maintenance.');
  }
  function otherSeasons(r,current,entryId){return r.invoke('shelf_entries',{shelf_id:current.shelf_id}).some(entry=>entry.shelf_entry_id!==entryId&&entry.structure_kind==='season'&&['active','offdeck_in_progress'].includes(entry.status)&&
    (()=>{const identity=r.invoke('find_identity',{shelf_entry_id:entry.shelf_entry_id,revision:Number(entry.canonical_identity_revision)});return identity?.provider==='tmdb'&&String(identity.provider_key)===current.provider_key;})());}
  function registerMaintenance(basis){
    const b=basis.entryBinding,scopeId=seriesScopeId(b.shelfId,basis.sourceObservation.providerKey);
    return options.unitOfWork.execute([participant('arca_series_maintenance_admit',(r,c)=>{relocationGate.assertNoSeriesRelocation(r,scopeId);maintenanceFence(r,basis);
      const shelf=r.invoke('find_shelf',{shelf_id:b.shelfId}),current=r.invoke('scope',{scope_id:scopeId});
      assertRootBinding({shelfRoot:shelf.target_root_location,rootLocation:b.rootLocation});
      if(current){if(current.root_location!==b.rootLocation||current.retirement_scope_id)fail('ARCA_SERIES_PLACEMENT_CONFLICT','Shared maintenance has another root or authorized retirement.');return current;}
      const row={scope_id:scopeId,shelf_id:b.shelfId,provider:'tmdb',provider_key:basis.sourceObservation.providerKey,endpoint_id:shelf.target_endpoint_id,mount_scope_id:shelf.target_mount_scope_id,
        shelf_root:shelf.target_root_location,root_location:b.rootLocation,placement_revision:Number(shelf.current_placement_revision),current_version:0,active_build_id:null,retirement_scope_id:null,
        state_revision:1,state_digest:canonicalDigest({schema:'arca.series-maintenance-admission@1',basisDigest:basis.basisDigest}),created_at_ms:c.commitTimeMs,updated_at_ms:c.commitTimeMs};
      r.invoke('insert_scopes',row);return row;
    })]).arca_series_maintenance_admit;
  }
  function scopeParticipant(scope){
    assertSeriesScope(scope);
    return participant('arca_series_build_fence',r=>{
      maintenanceFence(r,scope.basis);
      const current=r.invoke('scope',{scope_id:scope.scopeId}),frozen=r.invoke('build',{build_id:scope.objectId});
      if(!current||current.active_build_id!==scope.objectId||Number(current.current_version)!==scope.expectedVersion||frozen?.scope_digest!==scope.digest)
        fail('ARCA_SERIES_SCOPE_STALE','Series preparation no longer owns its exact active builder and version.');
    });
  }
  function committedScopeParticipant(scope){
    assertSeriesScope(scope);
    return participant('arca_series_committed_build_fence',r=>{
      const version=r.invoke('version',{scope_id:scope.scopeId,revision:scope.expectedVersion+1}),build=r.invoke('build',{build_id:scope.objectId});
      if(version?.build_id!==scope.objectId||build?.scope_digest!==scope.digest)
        fail('ARCA_SERIES_COMMIT_MISSING','Workspace reclamation requires the exact immutable committed build.');
    });
  }
  function reclamationScopeParticipant(scope,basis){return participant('arca_series_reclamation_basis_fence',r=>{
    const version=r.invoke('version',{scope_id:scope.scopeId,revision:scope.expectedVersion+1}),frozen=r.invoke('build',{build_id:scope.objectId}),current=r.invoke('scope',{scope_id:scope.scopeId});
    if(basis.kind==='retired'){if(frozen?.scope_digest!==scope.digest||current.active_build_id===scope.objectId||basis.retirementReceipt?.scopeDigest!==scope.digest||basis.retirementReceipt.buildId!==scope.objectId)fail('ARCA_SERIES_RETIREMENT_STALE','Reclamation lost its exact retired build.');return;}
    if(frozen?.scope_digest!==scope.digest||!version||version.build_id!==basis.ready.buildId||version.manifest_digest!==basis.ready.manifestDigest||current.active_build_id===scope.objectId)fail('ARCA_SERIES_COMMIT_MISSING','Reclamation lost its exact committed successor.');
    let row=r.invoke('build',{build_id:version.build_id});const seen=new Set();
    while(row&&row.build_id!==scope.objectId){const value=JSON.parse(row.scope_json);if(seen.has(row.build_id)||value.scopeId!==scope.scopeId||!value.reassessmentProofDigest)fail('ARCA_SERIES_REASSESSMENT_CONTRACT','Superseded reclamation has invalid immutable lineage.');seen.add(row.build_id);row=value.supersedesBuildId&&r.invoke('build',{build_id:value.supersedesBuildId});}
    if(!row)fail('ARCA_SERIES_COMMIT_MISSING','Reclamation is outside the committed Source lineage.');
  });}

  function reservationParticipant(request){
    const basis=packageSeriesBasis(request.package);if(!basis)return null;
    const source=basis.sourceObservation,shelf=request.shelf,target=shelf.target,scopeId=seriesScopeId(shelf.shelfId,source.providerKey),
      root=assertRootBinding({shelfRoot:target.rootLocation,rootLocation:path.dirname(request.targetLocation)}),
      targetDigest=canonicalDigest({endpointId:target.endpointId,mountScopeId:target.mountScopeId,rootLocation:root});
    return participant('arca_series_reservation',(r,c)=>{
      relocationGate.assertNoSeriesRelocation(r,scopeId);
      let current=r.invoke('scope',{scope_id:scopeId});
      if(current?.retirement_scope_id)fail('ARCA_SERIES_RETIREMENT_IN_PROGRESS','Shared presentation is under an exact authorized retirement.');
      if(current&&(current.endpoint_id!==target.endpointId||current.mount_scope_id!==target.mountScopeId||current.root_location!==root))
        fail('ARCA_SERIES_PLACEMENT_CONFLICT','This Series already has another formal root binding.');
      if(!current){const row={scope_id:scopeId,shelf_id:shelf.shelfId,provider:'tmdb',provider_key:source.providerKey,
        endpoint_id:target.endpointId,mount_scope_id:target.mountScopeId,shelf_root:path.resolve(target.rootLocation),root_location:root,
        placement_revision:shelf.currentPlacementRevision,current_version:0,active_build_id:null,retirement_scope_id:null,state_revision:1,
        state_digest:canonicalDigest({schema:'arca.series-presentation-admission@1',scopeId,targetDigest}),created_at_ms:c.commitTimeMs,updated_at_ms:c.commitTimeMs};
        r.invoke('insert_scopes',row);current=row;}
      const prior=r.invoke('reservation',{scope_id:scopeId,on_deck_run_id:request.onDeckRunId});
      if(prior){if(prior.target_binding_digest!==targetDigest||prior.custody_id!==request.custodyId)
        fail('ARCA_SERIES_RESERVATION_CONFLICT','Series pending reservation does not match its accepted custody.');return;}
      r.invoke('insert_reservations',{scope_id:scopeId,on_deck_run_id:request.onDeckRunId,custody_id:request.custodyId,state:'pending',
        committed_version:null,target_binding_digest:targetDigest,created_at_ms:c.commitTimeMs,updated_at_ms:c.commitTimeMs});
    });
  }

  function admitBuild({scopeId,basis,existingMembers,replaceFailedBuildId=null,reassessmentFence=null,imageSourceQualification=null,supplementalSources=[],sourceWorkspaceFiles=[],command=null}){
    let admitted;const participants=[...(reassessmentFence?[reassessmentFence]:[]),participant('arca_series_build_admit',(r,c)=>{
      relocationGate.assertNoSeriesRelocation(r,scopeId);
      const current=r.invoke('scope',{scope_id:scopeId});if(!current)fail('ARCA_SERIES_SCOPE_MISSING','Shared scope has no accepted responsibility.');
      if(current.retirement_scope_id)fail('ARCA_SERIES_RETIREMENT_IN_PROGRESS','Shared presentation has an active authorized retirement.');
      if(current.active_build_id&&current.active_build_id===replaceFailedBuildId&&
          !reassessmentFence)
        fail('ARCA_SERIES_BUILD_RECOVERY_NOT_VERIFIED','Replacing a failed builder requires verified terminal Effects and an explicit recovery basis.');
      if(current.active_build_id&&current.active_build_id!==replaceFailedBuildId){if(command)fail('ARCA_SERIES_RETRY_IN_PROGRESS','Another shared retry is already active.');return JSON.parse(r.invoke('build',{build_id:current.active_build_id}).scope_json);}
      const revision=Number(current.state_revision),
        buildId=stable('arca-series-build-',{scopeId,revision,expectedVersion:Number(current.current_version),basisDigest:basis.basisDigest}),
        scope=buildSeriesScope({buildId,scopeId,shelfId:current.shelf_id,revision,expectedVersion:Number(current.current_version),
          endpointId:current.endpoint_id,mountScopeId:current.mount_scope_id,shelfRoot:current.shelf_root,rootLocation:current.root_location,basis,imageSourceQualification,supplementalSources,existingMembers,reassessmentProofDigest:reassessmentFence?.proofDigest||null,
          supersedesBuildId:replaceFailedBuildId,sourceWorkspaceFiles});
      options.contractValidator.validate(scope.schemaRef,scope);
      r.invoke('insert_builds',{build_id:buildId,scope_id:scopeId,revision,expected_version:scope.expectedVersion,
        basis_schema_ref:'shelfdeck.series-presentation-basis@1',basis_json:canonicalJson(basis),basis_digest:basis.basisDigest,
        scope_schema_ref:scope.schemaRef,scope_json:canonicalJson(scope),scope_digest:scope.digest,created_at_ms:c.commitTimeMs});
      advance(r,current,{currentVersion:scope.expectedVersion,activeBuildId:buildId},c.commitTimeMs);admitted=scope;return scope;
    }),...(command?[command.participant(()=>admitted,1)]:[])];
    if(reassessmentFence||command){const contract=require('../../../contracts/transaction-contracts/helix.transaction.series-presentation-source-reassessment/v1/contract.json').contract,declared=new Set([...contract.readTables,...contract.writeTables]);
      if(participants.some(p=>p.repositories.some(repository=>repository.tableIds.some(table=>!declared.has(table)))))fail('ARCA_SERIES_REASSESSMENT_CONTRACT','Source reassessment escaped its canonical transaction.');}
    return options.unitOfWork.execute(participants).arca_series_build_admit;
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
      maintenanceFence(r,scope.basis);
      if(scope.basis.entryBinding){const b=scope.basis.entryBinding,prior=r.invoke('reference',{scope_id:scope.scopeId,shelf_entry_id:b.shelfEntryId});
        if(prior&&prior.state!=='active')fail('ARCA_SERIES_REFERENCE_RELEASED','Released Season cannot be attached through maintenance.');
        if(!prior)r.invoke('insert_references',{scope_id:scope.scopeId,shelf_entry_id:b.shelfEntryId,first_committed_version:value.revision,state:'active',reference_revision:1,
          reference_digest:canonicalDigest({schema:'arca.series-maintenance-reference@1',scopeId:scope.scopeId,shelfEntryId:b.shelfEntryId,firstVersion:value.revision,basisDigest:scope.basis.basisDigest}),created_at_ms:c.commitTimeMs,released_at_ms:null});}
      advance(r,current,{currentVersion:value.revision,activeBuildId:null},c.commitTimeMs);
    });
  }

  function commitReferenceParticipant(request,shelfEntryId){
    const basis=packageSeriesBasis(request.package);if(!basis)return null;
    const reference=request.fulfillmentVerification.seriesPresentationRef;
    if(!reference)fail('ARCA_SERIES_PRESENTATION_NOT_READY','Season Commit requires exact verified shared presentation.');
    const scopeId=seriesScopeId(request.shelf.shelfId,basis.sourceObservation.providerKey);
    return participant('arca_series_commit_reference',(r,c)=>{
      relocationGate.assertNoSeriesRelocation(r,scopeId);
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

  function commitControlParticipant(request){
    const basis=packageSeriesBasis(request.package);if(!basis)return null;
    const reference=request.fulfillmentVerification.seriesPresentationRef,stored=reference&&manifest(reference.scopeId,reference.sharedVersion);
    if(!stored||!Array.isArray(reference.controls)||reference.controls.length!==3||
        canonicalJson(reference.controls.map(row=>row.materialKey).sort())!==canonicalJson(stored.value.members.map(row=>row.physicalIdentity.materialKey).sort()))
      fail('ARCA_SERIES_COMMIT_FENCE_STALE','Season fulfillment lacks the exact shared Control proof.');
    return createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_series_reference_control',
      materialKeys:reference.controls.map(row=>row.materialKey).sort(),accept:projections=>{
        for(const row of projections){const expected=reference.controls.find(item=>item.materialKey===row.materialKey);
          if(row.resultKind!=='available'||row.controlState!=='controlled'||row.ownerDomain!=='arca'||row.ownerScopeType!=='series_presentation'||row.ownerScopeId!==reference.scopeId||
              row.controlRevision!==expected.controlRevision||row.projectionDigest!==expected.projectionDigest)
            fail('ARCA_SERIES_COMMIT_FENCE_STALE','Shared Control changed after fulfillment verification.');}
      }});
  }

  function releaseReferencesParticipant(entryIds){
    const ids=[...new Set(entryIds)].sort();
    if(!ids.length)return null;
    return participant('arca_series_release_references',(r,c)=>{
      for(const entryId of ids)for(const row of r.invoke('entry_references',{shelf_entry_id:entryId})){
        if(row.state==='released')continue;
        relocationGate.assertNoSeriesRelocation(r,row.scope_id);
        const revision=Number(row.reference_revision)+1,digest=canonicalDigest({schema:'arca.series-reference-release@1',
          scopeId:row.scope_id,shelfEntryId:entryId,previousDigest:row.reference_digest,revision});
        if(r.invoke('release_reference',{scope_id:row.scope_id,shelf_entry_id:entryId,expected_revision:Number(row.reference_revision),expected_digest:row.reference_digest,
            state:'released',reference_revision:revision,reference_digest:digest,released_at_ms:c.commitTimeMs}).changes!==1)
          fail('ARCA_SERIES_REFERENCE_STALE','Season shared reference changed before its terminal release.');
      }
    });
  }
  function releaseShelfParticipants(shelfId,entryIds){
    const scopes=read('scopes').filter(row=>row.shelf_id===shelfId),allowed=new Set(entryIds),participants=[];
    for(const current of scopes){
      if(current.active_build_id||read('reservations',{scope_id:current.scope_id}).some(row=>row.state==='pending'))
        fail('ARCA_SERIES_DEREGISTRATION_PENDING','Shelf still has accepted shared presentation obligations.');
      if(!Number(current.current_version))continue;
      const value=manifest(current.scope_id,Number(current.current_version)).value,
        projections=readControlProjections(options.materialControlProjectionPort||createMaterialControlProjectionPort(options),value.members.map(row=>row.physicalIdentity.materialKey)),
        owner={ownerDomain:'arca',scopeType:'series_presentation',scopeId:current.scope_id},changes=[];
      for(const member of value.members){const projection=projections.find(row=>row.materialKey===member.physicalIdentity.materialKey);
        if(projection?.controlState==='released')continue;
        if(projection?.resultKind!=='available'||projection.controlState!=='controlled'||projection.ownerDomain!=='arca'||projection.ownerScopeType!==owner.scopeType||projection.ownerScopeId!==owner.scopeId)
          fail('ARCA_SERIES_CONTROL_CHANGED','Shared Shelf release requires its exact current Control.');
        changes.push({identity:member.physicalIdentity,action:'release',fromScope:owner,expectedRevision:projection.controlRevision,expectedProjectionDigest:projection.projectionDigest});
      }
      participants.push(participant('arca_series_shelf_release_'+current.scope_id,r=>{
        const fresh=r.invoke('scope',{scope_id:current.scope_id});
        if(fresh.state_digest!==current.state_digest||r.invoke('reservations',{scope_id:current.scope_id}).some(row=>row.state==='pending')||
            r.invoke('references',{scope_id:current.scope_id}).some(row=>row.state==='active'&&!allowed.has(row.shelf_entry_id)))
          fail('ARCA_SERIES_DEREGISTRATION_STALE','Shared Shelf responsibility changed before release.');
      }));
      if(!changes.length)continue;
      const digest=controlScopeDigest(changes),handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
        handleId:stable('arca-series-shelf-release-',{scopeId:current.scope_id,stateDigest:current.state_digest}),operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_shelf_deregistration',processId:shelfId,
        basisRef:{objectType:'series_presentation_version',objectId:current.scope_id,revision:value.revision,digest:value.digest},basisDigest:current.state_digest,
        canonicalFactSetDigest:value.digest,bindingSetDigest:canonicalDigest(value.members),controlScopeDigest:digest,
        expectedControlRevisions:changes.map(row=>({materialKey:row.identity.materialKey,revision:row.expectedRevision})),
        receiptContract:{receiptSchemaRef:'helix://contracts/types/DeregistrationReceipt/v1',controlRevisionSetSchemaRef:'arca.series-shelf-control-release@1'},eventFenceDigest:canonicalDigest({shelfId,scopeId:current.scope_id,stateDigest:current.state_digest})};
      participants.push(createMaterialControlParticipant({...options,participantId:'arca_series_shelf_control_'+current.scope_id,handle,changes,authorizedScopeDigest:digest,
        commitMarker:stable('arca-series-shelf-release-marker-',{shelfId,stateDigest:current.state_digest})}));
    }
    return participants;
  }
  function lastReferenceMembers(entryId){
    const refs=read('entry_references',{shelf_entry_id:entryId}).filter(row=>row.state==='active'),result=[];
    for(const ref of refs){const current=read('scope',{scope_id:ref.scope_id});
      if(!current||current.active_build_id||read('reservations',{scope_id:ref.scope_id}).some(row=>row.state==='pending')||
          read('references',{scope_id:ref.scope_id}).some(row=>row.state==='active'&&row.shelf_entry_id!==entryId)||options.unitOfWork.execute([participant('arca_series_other_seasons',r=>otherSeasons(r,current,entryId))]).arca_series_other_seasons)continue;
      const stored=manifest(ref.scope_id,Number(current.current_version));if(!stored)continue;
      for(const member of stored.value.members)result.push({...member,sharedScopeId:ref.scope_id,sharedVersion:stored.value.revision});
    }return result;
  }
  function retirementParticipant({destructionScopeId,shelfEntryId,members,allowedPriorScopeId=null,complete=false}){
    const scopes=[...new Set(members.map(row=>row.shared_scope_id||row.sharedScopeId).filter(Boolean))].sort();
    if(!scopes.length)return null;
    return participant(complete?'arca_series_retirement_complete':'arca_series_retirement_admit',(r,c)=>{
      for(const scopeId of scopes){relocationGate.assertNoSeriesRelocation(r,scopeId);const current=r.invoke('scope',{scope_id:scopeId}),version=Number(members.find(row=>(row.shared_scope_id||row.sharedScopeId)===scopeId).shared_version||members.find(row=>row.sharedScopeId===scopeId)?.sharedVersion),
          references=r.invoke('references',{scope_id:scopeId}).filter(row=>row.state==='active'),reservations=r.invoke('reservations',{scope_id:scopeId});
        if(!current||otherSeasons(r,current,shelfEntryId)||current.active_build_id||Number(current.current_version)!==version||reservations.some(row=>row.state==='pending')||
            references.some(row=>row.shelf_entry_id!==shelfEntryId)||!complete&&!references.some(row=>row.shelf_entry_id===shelfEntryId)||
            (complete?current.retirement_scope_id!==destructionScopeId:current.retirement_scope_id&&![destructionScopeId,allowedPriorScopeId].includes(current.retirement_scope_id)))
          fail('ARCA_SERIES_RETIREMENT_STALE','Shared deletion no longer has its exact last reference, version and reservation fence.');
        const stored=r.invoke('version',{scope_id:scopeId,revision:version}),inventory=stored&&assertSharedManifest(JSON.parse(stored.manifest_json)),selected=members.filter(row=>(row.shared_scope_id||row.sharedScopeId)===scopeId);
        if(!inventory||selected.length!==3||canonicalJson(selected.map(row=>row.material_key||row.materialKey).sort())!==canonicalJson(inventory.members.map(row=>row.physicalIdentity.materialKey).sort())||
            selected.some(row=>!inventory.members.some(member=>(row.physical_identity_digest||row.physicalIdentityDigest)===canonicalDigest(member.physicalIdentity))))
          fail('ARCA_SERIES_RETIREMENT_STALE','Shared authorization does not cover its complete exact Inventory version.');
        if(current.retirement_scope_id===(complete?null:destructionScopeId))continue;
        advance(r,current,{currentVersion:version,activeBuildId:null,retirementScopeId:complete?null:destructionScopeId},c.commitTimeMs);
      }
    });
  }
  function assertRetirement({destructionScopeId,shelfEntryId,members}){
    for(const member of members.filter(row=>row.sharedScopeId)){
      const current=read('scope',{scope_id:member.sharedScopeId});
      if(!current||options.unitOfWork.execute([participant('arca_series_other_seasons',r=>otherSeasons(r,current,shelfEntryId))]).arca_series_other_seasons||current.retirement_scope_id!==destructionScopeId||Number(current.current_version)!==member.sharedVersion||current.active_build_id||
          read('reservations',{scope_id:member.sharedScopeId}).some(row=>row.state==='pending')||read('references',{scope_id:member.sharedScopeId}).some(row=>row.state==='active'&&row.shelf_entry_id!==shelfEntryId))
        fail('ARCA_SERIES_RETIREMENT_STALE','Shared physical deletion lost its durable exact retirement authority.');
    }
    return true;
  }
  function sharedMaterialDigest(scopeId,revision,materialKey){
    const stored=manifest(scopeId,revision),member=stored?.value.members.find(row=>row.physicalIdentity.materialKey===materialKey);
    if(!member)fail('ARCA_SERIES_RETIREMENT_STALE','Shared deletion lost its exact immutable physical member.');return member.byteDigest;
  }

  return Object.freeze({repository,participant,read,readScope:scopeId=>read('scope',{scope_id:scopeId}),
    findByIdentity:(shelfId,providerKey)=>read('identity',{shelf_id:shelfId,provider:'tmdb',provider_key:providerKey}),
    build,manifest,registerMaintenance,scopeParticipant,committedScopeParticipant,reclamationScopeParticipant,unused,formationRetirementPreview,retainedRetirementParticipant,normalizeFreshResetHeads,reservationParticipant,admitBuild,versionParticipant,commitReferenceParticipant,commitControlParticipant,releaseReferencesParticipant,releaseShelfParticipants,lastReferenceMembers,retirementParticipant,assertRetirement,sharedMaterialDigest});
}

module.exports=Object.freeze({columns,definition,createSeriesPresentationStore});
