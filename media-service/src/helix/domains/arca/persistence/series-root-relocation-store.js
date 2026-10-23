'use strict';

const path = require('node:path');
const {canonicalDigest,canonicalJson} = require('../../../contracts/canonical-json');
const {createRepositoryDefinition} = require('../../../foundation/persistence/owner-repository');
const {columns:sharedColumns} = require('./series-presentation-store');
const {buildSeriesScope,assertSeriesScope,buildSharedManifest,assertSharedManifest} = require('../model/series-presentation');
const {SCHEMA,buildSeriesRootRelocationPlan,assertSeriesRootRelocationPlan} = require('../model/series-root-relocation');
const {appendInventoryRevision} = require('./inventory-revision-writer');
const {representationMember} = require('../model/inventory-representation-member');
const {currentJavCorrectionGate} = require('./jav-correction-gate');
const gate = require('./series-root-relocation-gate');
const fail = (message) => {throw Object.assign(new Error(message),{code:'ARCA_SERIES_RELOCATION_STALE'});};
const columns = ['relocation_id','scope_id','shelf_id','plan_schema_ref','plan_json','plan_digest','state','state_revision',
  'inventory_set_digest','commit_marker','created_at_ms','committed_at_ms'];

// SQLite uses BigInt to avoid truncation. Plans retain numeric revisions only
// after a lossless check, and never serialize a large inode through Number.
function jsonValue(value) {
  if(typeof value==='bigint') {const number=Number(value);if(!Number.isSafeInteger(number))fail('Relocation snapshot contains an unsafe integer.');return number;}
  if(Array.isArray(value))return value.map(jsonValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,jsonValue(item)]));
  return value;
}
function createSeriesRootRelocationStore(options) {
  const statements = {...require('./inventory-context-statements'),...require('./inventory-revision-statements'),...gate.statements,
    find:{kind:'select-one',tableId:'arca_series_root_relocations',columns,keyColumns:['relocation_id'],safeIntegers:true},
    page_active:{kind:'select-range',tableId:'arca_series_root_relocations',columns,keyColumn:'relocation_id',fixedKeyColumns:['state'],maxItems:100,safeIntegers:true},
    insert:{kind:'insert',tableId:'arca_series_root_relocations',columns},
    finish:{kind:'update',tableId:'arca_series_root_relocations',setColumns:['state','state_revision','inventory_set_digest','commit_marker','committed_at_ms'],
      keyColumns:['relocation_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'plan_digest',parameter:'expected_digest'}]},
    shelf_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision'],keyColumns:['shelf_id'],safeIntegers:true},
    move_root:{kind:'update',tableId:'arca_series_presentation_scopes',setColumns:['root_location','placement_revision','current_version','state_revision','state_digest','updated_at_ms'],
      keyColumns:['scope_id'],compareColumns:[{column:'state_digest',parameter:'expected_digest'},{column:'state_revision',parameter:'expected_revision'}]},
  };
  for(const [name,keys,many] of [['scopes',['scope_id'],false],['versions',['scope_id','revision'],false],['builds',['build_id'],false],
    ['references',['scope_id'],true],['reservations',['scope_id'],true]])
    statements[name]={kind:many?'select-all':'select-one',tableId:'arca_series_presentation_'+name,columns:sharedColumns[name],keyColumns:keys,safeIntegers:true};
  for(const name of ['builds','versions'])statements['insert_'+name]={kind:'insert',tableId:'arca_series_presentation_'+name,columns:sharedColumns[name]};
  const repository=createRepositoryDefinition({repositoryId:'arca_series_root_relocation',owner:'arca',schemaManifest:options.schemaManifest,statements});
  const participant=(id,execute)=>({participantId:id,owner:'arca',repositories:[repository],execute:c=>execute(c.repository(repository.repositoryId),c)});
  const read=execute=>options.unitOfWork.execute([participant('arca_series_root_read',execute)]).arca_series_root_read;
  function snapshot(repo,scopeId,targetRoot,placementRevision) {
    const scope=jsonValue(repo.invoke('scopes',{scope_id:scopeId}));if(!scope)fail('Shared Series root is missing.');
    const shelf=jsonValue(repo.invoke('find_shelf',{shelf_id:scope.shelf_id}));
    if(shelf?.status!=='active'||shelf.current_placement_revision!==placementRevision||shelf.target_root_location!==scope.shelf_root||
        shelf.target_endpoint_id!==scope.endpoint_id||shelf.target_mount_scope_id!==scope.mount_scope_id)fail('Shelf placement changed.');
    const version=jsonValue(repo.invoke('versions',{scope_id:scopeId,revision:scope.current_version}));
    if(!version)fail('Shared Series has no complete current version.');
    const shared=assertSharedManifest(JSON.parse(version.manifest_json));
    const buildRow=repo.invoke('builds',{build_id:version.build_id}),build=buildRow&&assertSeriesScope(JSON.parse(buildRow.scope_json));
    if(!build||shared.digest!==version.manifest_digest||build.digest!==buildRow.scope_digest||
        buildSharedManifest(build,shared.members).digest!==shared.digest)fail('Current shared version does not match its immutable build.');
    const references=jsonValue(repo.invoke('references',{scope_id:scopeId})).sort((a,b)=>a.shelf_entry_id.localeCompare(b.shelf_entry_id));
    const seasons=[];
    // Query the identity member set independently of references so a missing
    // reference can never authorize moving only part of a collected Series.
    for(const candidate of repo.invoke('shelf_entries',{shelf_id:scope.shelf_id})) {
      if(candidate.structure_kind!=='season'||!['active','offdeck_in_progress'].includes(candidate.status))continue;
      const id=candidate.shelf_entry_id,identity=jsonValue(repo.invoke('find_identity',{shelf_entry_id:id,revision:Number(candidate.canonical_identity_revision)}));
      if(identity?.provider!==scope.provider||String(identity.provider_key)!==scope.provider_key)continue;
      const entry=jsonValue(repo.invoke('find_entry',{shelf_entry_id:id})),revision=entry.current_inventory_revision;
      const season={entry,identity,inventory:jsonValue(repo.invoke('find_inventory',{shelf_entry_id:id,revision})),
        correctionPending:Boolean(currentJavCorrectionGate(repo,id)),
        cases:jsonValue(repo.invoke('list_cases',{shelf_entry_id:id})).filter(row=>row.terminal_at_ms===null),
        reservations:jsonValue(repo.invoke('list_reservations',{shelf_entry_id:id})).filter(row=>row.state==='active')};
      for(const name of ['materials','related','facts','people'])season[name]=jsonValue(repo.invoke('list_'+name,{shelf_entry_id:id,inventory_revision:revision}));
      season.materials.sort((a,b)=>a.ordinal-b.ordinal);
      seasons.push(season);
    }
    const request={scope,shared,seasons:seasons.sort((a,b)=>a.entry.shelf_entry_id.localeCompare(b.entry.shelf_entry_id)),references,
      reservations:jsonValue(repo.invoke('reservations',{scope_id:scopeId})),targetRoot,placementRevision};
    return {plan:buildSeriesRootRelocationPlan(request),request,build,shelf};
  }
  function stored(row) {
    if(!row)return null;const plan=assertSeriesRootRelocationPlan(JSON.parse(row.plan_json));
    if(plan.digest!==row.plan_digest||plan.scopeId!==row.scope_id||plan.shelfId!==row.shelf_id||row.plan_schema_ref!==SCHEMA||
        canonicalJson(plan)!==row.plan_json)fail('Stored relocation plan changed.');
    return {...jsonValue(row),plan};
  }
  function assertCurrent(repo,reference) {
    const value=stored(repo.invoke('find',{relocation_id:reference.relocationId}));
    if(!value||value.state!=='active'||value.plan_digest!==reference.planDigest||value.scope_id!==reference.scopeId)
      fail('Relocation no longer owns its exact active frozen plan.');
    const current=snapshot(repo,value.scope_id,value.plan.newRoot,value.plan.placementRevision);
    if(current.plan.digest!==value.plan_digest)fail('A Season, shared root or reference changed after relocation admission.');
    return {value,...current};
  }
  function admit({scopeId,targetRoot,placementRevision}) {
    return options.unitOfWork.execute([participant('arca_series_root_admit',(repo,c)=>{
      const existing=repo.invoke('active_series_relocation',{scope_id:scopeId,state:'active'});
      if(existing) {
        const value=stored(repo.invoke('find',{relocation_id:existing.relocation_id}));
        if(value.plan.newRoot!==targetRoot||value.plan.placementRevision!==placementRevision)fail('Another frozen relocation already owns this Series.');
        return value;
      }
      const {plan}=snapshot(repo,scopeId,targetRoot,placementRevision),id='arca-series-relocation-'+plan.digest.slice(0,40);
      const row={relocation_id:id,scope_id:scopeId,shelf_id:plan.shelfId,plan_schema_ref:SCHEMA,plan_json:canonicalJson(plan),
        plan_digest:plan.digest,state:'active',state_revision:1,inventory_set_digest:null,commit_marker:null,created_at_ms:c.commitTimeMs,committed_at_ms:null};
      repo.invoke('insert',row);return stored(row);
    })]).arca_series_root_admit;
  }
  function commitParticipant(reference,verified,marker) {
    return participant('arca_series_root_inventory',(repo,c)=>{
      const {value,request,build}=assertCurrent(repo,reference),plan=value.plan;
      const expectedReality=canonicalDigest(plan.files.map(row=>({relativePath:row.relativePath,materialKey:row.identity.materialKey})));
      if(verified.planDigest!==plan.digest||verified.rootLocation!==plan.newRoot||verified.fileCount!==plan.files.length||
          verified.realityDigest!==expectedReality||typeof marker!=='string'||!marker)fail('Inventory commit lacks the exact physical relocation result.');
      const inventories=[];
      const relocate=location=>{
        const relative=path.relative(plan.oldRoot,location);
        return relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?path.join(plan.newRoot,relative):location;
      };
      for(const season of request.seasons) {
        const previous=season.entry.current_inventory_revision,next=previous+1,id=season.entry.shelf_entry_id;
        const materials=season.materials.map(row=>({...row,location:relocate(row.location),binding_revision:row.binding_revision+1}));
        const related=season.related.map(row=>({...row,location:row.location?relocate(row.location):row.location}));
        const representationDigest=canonicalDigest({schema:'arca.inventory-representation@1',shelfEntryId:id,inventoryRevision:next,
          sourcePackageId:season.inventory.source_package_id,members:materials.map(representationMember),
          ...(season.facts.some(row=>row.fact_kind==='related_primary_mapping')?{relatedPrimaryMappingDigests:season.facts.filter(row=>row.fact_kind==='related_primary_mapping').map(row=>row.fact_digest)}:{})});
        appendInventoryRevision(repo,{shelfEntryId:id,representationDigest,materials,related,facts:season.facts,people:season.people},season.inventory,previous,next,c.commitTimeMs);
        inventories.push({shelfEntryId:id,revision:next,digest:representationDigest});
      }
      const members=request.shared.members.map(row=>({...row,location:relocate(row.location)}));
      const nextBuild=buildSeriesScope({buildId:value.relocation_id,scopeId:plan.scopeId,shelfId:plan.shelfId,revision:request.scope.state_revision,
        expectedVersion:plan.expectedVersion,endpointId:plan.endpointId,mountScopeId:plan.mountScopeId,shelfRoot:plan.shelfRoot,
        rootLocation:plan.newRoot,basis:build.basis,imageSourceQualification:build.imageSourceQualification,existingMembers:members});
      const manifest=buildSharedManifest(nextBuild,members);
      options.contractValidator.validate(nextBuild.schemaRef,nextBuild);options.contractValidator.validate(manifest.schemaRef,manifest);
      repo.invoke('insert_builds',{build_id:nextBuild.objectId,scope_id:plan.scopeId,revision:nextBuild.revision,expected_version:plan.expectedVersion,
        basis_schema_ref:'shelfdeck.series-presentation-basis@1',basis_json:canonicalJson(nextBuild.basis),basis_digest:nextBuild.basis.basisDigest,
        scope_schema_ref:nextBuild.schemaRef,scope_json:canonicalJson(nextBuild),scope_digest:nextBuild.digest,created_at_ms:c.commitTimeMs});
      repo.invoke('insert_versions',{scope_id:plan.scopeId,revision:manifest.revision,build_id:nextBuild.objectId,manifest_schema_ref:manifest.schemaRef,
        manifest_json:canonicalJson(manifest),manifest_digest:manifest.digest,verification_digest:canonicalDigest({schema:'arca.series-presentation-final-verification@1',manifestDigest:manifest.digest,members:manifest.members}),committed_at_ms:c.commitTimeMs});
      const revision=request.scope.state_revision+1,inventorySetDigest=canonicalDigest(inventories);
      if(repo.invoke('move_root',{scope_id:plan.scopeId,expected_digest:request.scope.state_digest,expected_revision:request.scope.state_revision,
        root_location:plan.newRoot,placement_revision:plan.placementRevision,current_version:manifest.revision,state_revision:revision,
        state_digest:canonicalDigest({schema:'arca.series-root-relocated@1',relocationId:value.relocation_id,planDigest:plan.digest,manifestDigest:manifest.digest,inventorySetDigest,revision}),updated_at_ms:c.commitTimeMs}).changes!==1)
        fail('Shared root CAS failed.');
      if(repo.invoke('finish',{relocation_id:value.relocation_id,expected_state:'active',expected_digest:plan.digest,state:'committed',state_revision:2,
        inventory_set_digest:inventorySetDigest,commit_marker:marker,committed_at_ms:c.commitTimeMs}).changes!==1)fail('Relocation CAS failed.');
      return {inventorySetDigest,sharedVersion:manifest.revision,manifestDigest:manifest.digest,committedAtMs:c.commitTimeMs};
    });
  }
  return Object.freeze({repository,admit,commitParticipant,read:id=>read(repo=>stored(repo.invoke('find',{relocation_id:id}))),
    active:scopeId=>read(repo=>{const row=repo.invoke('active_series_relocation',{scope_id:scopeId,state:'active'});return row?stored(repo.invoke('find',{relocation_id:row.relocation_id})):null;}),
    page:(cursor=null,limit=100)=>read(repo=>repo.invoke('page_active',{state:'active',rangeStart:'',rangeEnd:'\uffff',cursor,limit:Math.min(100,limit)}).map(stored)),
    inspect:reference=>read(repo=>assertCurrent(repo,reference).value),
    fenceParticipant:reference=>participant('arca_series_root_fence',repo=>assertCurrent(repo,reference).value),
    preview:request=>read(repo=>snapshot(repo,request.scopeId,request.targetRoot,request.placementRevision).plan)});
}
module.exports=Object.freeze({createSeriesRootRelocationStore});
