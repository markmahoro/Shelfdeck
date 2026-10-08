'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { materialKey } = require('../src/helix/foundation/persistence/material-control');
const { computeBoundedMaterialFingerprintSync,
  readBoundedFileSnapshotSync } = require('../src/helix/integrations/bounded-material-fingerprint');
const { compareMovieNfoPresentation,
  inspectAftercareMovieNfo } = require('../src/helix/domains/arca/model/aftercare-nfo');

const CONFIRMATION = 'PROD064_AFTERCARE_PLACEMENT_INCIDENT_CORRECTION_V1';
const INCIDENT_ENTRIES = Object.freeze([
  '000f0157918a55fd39982e022d4720d23d6d4e52cda048140cebeaf2304a600a',
  '052d55542cdc50ef521932293cccf0ce26fe00d7967b61d388ae7b487f0b2db8',
  '1993cd1726bdcedde313c74a931ce072c54bab21cb1f5811e0ede1f78eefd1ef',
  '519c39b7d3b7d9ec883708e95606c3f0f2db4b2c216ceecbd37d2afbd18f9c8c',
  '57888bb0f1c7c5f818b663bd6e14f860257321d0243f5f7c016436d8079691db',
  '761633ac6d729b3267743eba0a2375e4b28a98fa6b6361dcc6827cb2deaae15b',
  '81842030343ddc137d631ea4cb6b678bd10bc55de6df60746cf2e164f833c03c',
  'a97fff6a5e378ede33433b125327f3d38e50d5bf2a874a06c078e9e2863c450c',
  'b61cdc113082e26b10790292c4cc77352494a226eda18ce862526b637246e22f',
  'e7d83ebbb72b651bf665ce29390ddc71018563f202b4c457e4157973d14d94ac',
  'f04a4f09b2b64d957392425ca6eb7d70dde5126bf4f07424777df08c84f11347',
  'f892988d9af63018a68b5fdcbe030dbb4f789d9e8fdab6cefefba94af1f17379',
  'fb2b5120e05c5abf3b7565f379ec5670fa7933efd2276f40eacaa70075ee0309',
]);
const INCIDENT_QUARANTINE_DIRECTORIES = Object.freeze([
  'Film/最后的前线',
  'Film/长空之王',
  'Film/2001太空漫游',
  'Film/银翼杀手：2022黑暗浩劫',
]);
const QUARANTINE_ENTRY_BY_DIRECTORY = Object.freeze({
  'Film/最后的前线':'fb2b5120e05c5abf3b7565f379ec5670fa7933efd2276f40eacaa70075ee0309',
  'Film/长空之王':'761633ac6d729b3267743eba0a2375e4b28a98fa6b6361dcc6827cb2deaae15b',
  'Film/2001太空漫游':'e7d83ebbb72b651bf665ce29390ddc71018563f202b4c457e4157973d14d94ac',
  'Film/银翼杀手：2022黑暗浩劫':'052d55542cdc50ef521932293cccf0ce26fe00d7967b61d388ae7b487f0b2db8',
});
const SILVER_BLADE_ENTRY = '052d55542cdc50ef521932293cccf0ce26fe00d7967b61d388ae7b487f0b2db8';
const SILVER_BLADE_CURRENT_STEM = '银翼杀手2022：黑暗浩劫';
const SILVER_BLADE_RESTORED_STEM = '银翼杀手：2022黑暗浩劫';

function valueAfter(args, flag) {
  const assigned=args.find((item)=>item.startsWith(flag+'='));
  if(assigned)return assigned.slice(flag.length+1);
  const index=args.indexOf(flag);return index<0?undefined:args[index+1];
}
function valuesAfter(args, flag) {
  const values=[];
  for(let index=0;index<args.length;index+=1){
    if(args[index]===flag&&args[index+1])values.push(args[++index]);
    else if(args[index].startsWith(flag+'='))values.push(args[index].slice(flag.length+1));
  }
  return values;
}
function sameSet(left,right){return left.length===right.length&&[...left].sort().every((item,index)=>item===[...right].sort()[index]);}
function fail(code,details){const error=new Error(code);error.details=details||null;throw error;}
function ensureInside(root,location,label){const base=path.resolve(root),resolved=path.resolve(location);if(resolved===base||!resolved.startsWith(base+path.sep))fail('PROD064_PATH_OUTSIDE_MEDIA_ROOT',{label,location});return resolved;}
function fingerprint(location,mountScopeId){const observed=computeBoundedMaterialFingerprintSync(location),identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId,inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};return Object.freeze({...identity,materialKey:materialKey(identity)});}
function rowIdentity(row){return Object.freeze({sizeBytes:Number(row.size_bytes),contentFingerprint:row.content_fingerprint});}
function sameContent(left,right){return Number(left.sizeBytes)===Number(right.sizeBytes)&&left.contentFingerprint===right.contentFingerprint;}
function presentation(database,entryId,revision){
  const facts=database.prepare('SELECT fact_kind,fact_json FROM arca_inventory_product_facts WHERE shelf_entry_id=? AND inventory_revision=?').all(entryId,revision);
  const value=(kind)=>{const row=facts.find((item)=>item.fact_kind===kind);return row?JSON.parse(row.fact_json):null;};
  const identity=database.prepare('SELECT provider,provider_key FROM arca_canonical_identity_revisions WHERE shelf_entry_id=? ORDER BY revision DESC LIMIT 1').get(entryId);
  return Object.freeze({metadata:value('product_metadata'),cast:value('media_cast'),identity:{provider:identity.provider,providerKey:identity.provider_key}});
}
function nfoMatches(location,input){try{return compareMovieNfoPresentation({existingBytes:readBoundedFileSnapshotSync(location,256*1024).bytes,...input}).matches;}catch{return false;}}
function incidentEvidenceCount(database,entryId,incidentStartMs){return Number(database.prepare(`
  SELECT COUNT(*) AS count FROM fx_effect_journal x
  JOIN fx_event_attempts ea ON ea.event_attempt_id=x.event_attempt_id
  JOIN fx_workflow_events e ON e.event_id=ea.event_id
  JOIN fx_supporting_works w ON w.work_id=e.work_id
  WHERE w.owner_domain='arca' AND w.process_type='arca_shelf_entry' AND w.process_id=?
    AND e.capability_ref='arca.inventory.placement.switch@1' AND x.updated_at_ms>=?
`).get(entryId,incidentStartMs).count);}
function historicalSignatures(database){return new Set(database.prepare(`SELECT size_bytes,content_fingerprint FROM arca_inventory_materials WHERE shelf_entry_id IN (${INCIDENT_ENTRIES.map(()=>'?').join(',')})`).all(...INCIDENT_ENTRIES).map((row)=>`${row.size_bytes}:${row.content_fingerprint}`));}
function stagedIncidentEvidence(database,entryId,incidentStartMs){
  const evidence=new Map(),rows=database.prepare(`
    SELECT e.plan_id,e.work_id,r.committed_at_ms,r.result_json FROM fx_event_result_bindings r
    JOIN fx_workflow_events e ON e.event_id=r.event_id
    JOIN fx_supporting_works w ON w.work_id=e.work_id
    WHERE w.owner_domain='arca' AND w.process_type='arca_shelf_entry' AND w.process_id=?
      AND e.capability_ref='arca.inventory.product.stage@1'
      AND r.outcome_kind='succeeded'
      AND r.result_schema_ref='helix://contracts/capabilities/arca.inventory.product.stage/v1/result'
      AND r.committed_at_ms>=?
  `).all(entryId,incidentStartMs);
  const collect=(value)=>{
    if(Array.isArray(value)){for(const item of value)collect(item);return;}
    if(!value||typeof value!=='object')return;
    const identity=value.physicalIdentity;
    if(typeof value.location==='string'&&identity?.schemaRef==='helix://contracts/types/PhysicalMaterialIdentity/v2'
      &&Number.isSafeInteger(Number(identity.sizeBytes))&&typeof identity.fingerprintAlgorithm==='string'
      &&Number.isSafeInteger(Number(identity.fingerprintVersion))&&typeof identity.contentFingerprint==='string'){
      const key=path.resolve(value.location),signature=`${Number(identity.sizeBytes)}:${identity.fingerprintAlgorithm}:${Number(identity.fingerprintVersion)}:${identity.contentFingerprint}`;
      if(!evidence.has(key))evidence.set(key,[]);
      evidence.get(key).push(Object.freeze({signature,stageCommittedAtMs:Number(currentRow.committed_at_ms),planId:currentRow.plan_id,workId:currentRow.work_id}));
    }
    for(const item of Object.values(value))collect(item);
  };
  let currentRow=null;
  for(const row of rows){try{currentRow=row;collect(JSON.parse(row.result_json));}catch{fail('PROD064_STAGE_RESULT_INVALID_JSON',{entryId});}}
  for(const [location,items] of evidence)evidence.set(location,Object.freeze(items.map((item)=>Object.freeze({...item,failedSwitchWindows:Object.freeze(database.prepare(`
    SELECT ea.started_at_ms AS startedAtMs,x.verified_at_ms AS verifiedAtMs
    FROM fx_workflow_events e
    JOIN fx_event_attempts ea ON ea.event_id=e.event_id
    JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id
    WHERE e.plan_id=? AND e.work_id=? AND e.capability_ref='arca.inventory.placement.switch@1'
      AND ea.outcome_kind='failed' AND x.effect_class='material_commit' AND x.state='failed'
      AND ea.started_at_ms>=? AND x.verified_at_ms IS NOT NULL
    ORDER BY ea.started_at_ms
  `).all(item.planId,item.workId,item.stageCommittedAtMs).map((window)=>Object.freeze({startedAtMs:Number(window.startedAtMs),verifiedAtMs:Number(window.verifiedAtMs)})))}))));
  return evidence;
}
function stagedSignature(observed){return `${Number(observed.stat.size)}:${observed.fingerprintAlgorithm}:${Number(observed.fingerprintVersion)}:${observed.contentFingerprint}`;}
function quarantineStageBasis(location,observed,evidence){
  const rows=evidence.get(path.resolve(location))||[],signature=stagedSignature(observed);
  if(rows.some((item)=>item.signature===signature))return 'incident_stage_exact';
  if(path.extname(location).toLowerCase()!=='.nfo')return null;
  const modifiedAtMs=Number(observed.stat.mtimeMs),insideFailedSwitch=rows.some((item)=>item.failedSwitchWindows.some((window)=>modifiedAtMs>=Math.max(item.stageCommittedAtMs,window.startedAtMs)&&modifiedAtMs<=window.verifiedAtMs));
  if(!insideFailedSwitch)return null;
  try{return inspectAftercareMovieNfo(readBoundedFileSnapshotSync(location,256*1024).bytes).usable?'incident_failed_switch_nfo_mutation':null;}catch{return null;}
}
function listTreeFiles(directory){
  const result=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const location=path.join(directory,entry.name);
    if(entry.isSymbolicLink()||entry.isDirectory())fail('PROD064_QUARANTINE_TREE_UNSAFE',{location});
    if(!entry.isFile())fail('PROD064_QUARANTINE_TREE_UNSAFE',{location});
    result.push(location);
  }
  return result.sort();
}
function representationMember(item,ordinal){return {ordinal,materialKey:item.material_key,role:item.role,episodeClaims:JSON.parse(item.episode_claims_json),endpointId:item.endpoint_id,location:item.location,bindingRevision:Number(item.binding_revision),physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:item.material_key,mountScopeId:item.mount_scope_id,inode:item.inode,sizeBytes:Number(item.size_bytes),fingerprintAlgorithm:item.fingerprint_algorithm,fingerprintVersion:Number(item.fingerprint_version),contentFingerprint:item.content_fingerprint},digestHex:item.digest_hex,sizeBytes:Number(item.size_bytes)};}
function queryRows(database,table,entryId,revision,order){return database.prepare(`SELECT * FROM ${table} WHERE shelf_entry_id=? AND ${table==='arca_inventory_representations'?'revision':'inventory_revision'}=? ORDER BY ${order}`).all(entryId,revision);}
function mapRestoreRows(current,restore,shelfEntryId){
  if(current.length!==restore.length)fail('PROD064_INVENTORY_MEMBER_COUNT_MISMATCH',{shelfEntryId,currentCount:current.length,restoreCount:restore.length});
  const unused=new Set(restore.map((_,index)=>index)),mapped=[];
  for(const row of current){
    const choose=(predicate)=>[...unused].filter((index)=>predicate(restore[index]));
    let candidates=choose((item)=>item.material_key===row.material_key);
    if(candidates.length!==1)candidates=choose((item)=>item.role===row.role&&sameContent(rowIdentity(item),rowIdentity(row)));
    if(candidates.length!==1)candidates=choose((item)=>item.role===row.role&&path.basename(item.location)===path.basename(row.location));
    if(candidates.length!==1)candidates=choose((item)=>item.role===row.role);
    if(candidates.length!==1)fail('PROD064_INVENTORY_MEMBER_MAPPING_AMBIGUOUS',{shelfEntryId,ordinal:row.ordinal,role:row.role,candidateCount:candidates.length});
    unused.delete(candidates[0]);mapped.push(restore[candidates[0]]);
  }
  return Object.freeze(mapped);
}
function restoredLocation(shelfEntryId,location){return shelfEntryId===SILVER_BLADE_ENTRY?location.split(SILVER_BLADE_CURRENT_STEM).join(SILVER_BLADE_RESTORED_STEM):location;}
function resolveRestoreRevision(database,options,shelfEntryId,currentRevision){
  const explicit=options.restoreRevisions.get(shelfEntryId);if(explicit!==undefined)return Number(explicit);
  const firstCommit=database.prepare('SELECT previous_inventory_revision FROM arca_aftercare_inventory_commits WHERE shelf_entry_id=? AND committed_at_ms>=? ORDER BY committed_at_ms,inventory_commit_id LIMIT 1').get(shelfEntryId,options.incidentStartMs);
  return firstCommit?Number(firstCommit.previous_inventory_revision):currentRevision;
}

function inspectPlan(database,options){
  if(!sameSet(options.expectedShelfEntryIds,INCIDENT_ENTRIES))fail('PROD064_EXPECTED_ENTRY_SET_MISMATCH',{expected:INCIDENT_ENTRIES,actual:options.expectedShelfEntryIds});
  const known=historicalSignatures(database),selectedSources=new Set(),entries=[];
  for(const shelfEntryId of INCIDENT_ENTRIES){
    const entry=database.prepare('SELECT * FROM arca_shelf_entries WHERE shelf_entry_id=?').get(shelfEntryId);
    if(!entry||entry.status!=='active')fail('PROD064_ENTRY_NOT_ACTIVE',{shelfEntryId});
    const shelf=database.prepare('SELECT target_endpoint_id FROM arca_shelves WHERE shelf_id=?').get(entry.shelf_id);
    if(!shelf?.target_endpoint_id)fail('PROD064_SHELF_TARGET_MISSING',{shelfEntryId});
    if(incidentEvidenceCount(database,shelfEntryId,options.incidentStartMs)<1)fail('PROD064_INCIDENT_EVIDENCE_MISSING',{shelfEntryId});
    const currentRevision=Number(entry.current_inventory_revision),restoreRevision=resolveRestoreRevision(database,options,shelfEntryId,currentRevision);
    const current=queryRows(database,'arca_inventory_materials',shelfEntryId,currentRevision,'ordinal');
    const restore=queryRows(database,'arca_inventory_materials',shelfEntryId,restoreRevision,'ordinal');
    if(!current.length||!restore.length)fail('PROD064_INVENTORY_SHAPE_MISSING',{shelfEntryId,currentRevision,restoreRevision});
    const mappedRestore=mapRestoreRows(current,restore,shelfEntryId);
    const nfoInput=presentation(database,shelfEntryId,currentRevision),moves=[],materials=[];
    for(let index=0;index<current.length;index+=1){
      const sourceRow=current[index],restoreRow=mappedRestore[index],destination=ensureInside(options.mediaRoot,restoredLocation(shelfEntryId,restoreRow.location),'destination');
      let source=null,actual=null;
      if(fs.existsSync(destination)){
        actual=fingerprint(destination,sourceRow.mount_scope_id);
        if(!sameContent(actual,rowIdentity(sourceRow))&&!sameContent(actual,rowIdentity(restoreRow))&&!(sourceRow.role==='metadata_sidecar'&&nfoMatches(destination,nfoInput)))fail('PROD064_DESTINATION_CONTENT_UNEXPECTED',{shelfEntryId,ordinal:index,destination});
        source=destination;
      }else{
        source=ensureInside(options.mediaRoot,sourceRow.location,'source');
        if(!fs.existsSync(source))fail('PROD064_SOURCE_MISSING',{shelfEntryId,ordinal:index,source});
        actual=fingerprint(source,sourceRow.mount_scope_id);
        if(!sameContent(actual,rowIdentity(sourceRow))&&!(sourceRow.role==='metadata_sidecar'&&nfoMatches(source,nfoInput)))fail('PROD064_SOURCE_CONTENT_UNEXPECTED',{shelfEntryId,ordinal:index,source});
        if(source!==destination)moves.push(Object.freeze({source,destination}));
      }
      selectedSources.add(path.resolve(source));
      materials.push(Object.freeze({...sourceRow,inventory_revision:currentRevision+1,material_key:actual.materialKey,endpoint_id:shelf.target_endpoint_id,location:destination,binding_revision:Number(sourceRow.binding_revision)+(source===destination?0:1),mount_scope_id:actual.mountScopeId,inode:actual.inode,fingerprint_algorithm:actual.fingerprintAlgorithm,fingerprint_version:String(actual.fingerprintVersion),content_fingerprint:actual.contentFingerprint,digest_hex:actual.contentFingerprint,size_bytes:actual.sizeBytes,active_guard:sourceRow.role==='primary_payload'?1:0}));
    }
    const deck=database.prepare('SELECT * FROM arca_deck_fact_revisions WHERE shelf_entry_id=? ORDER BY revision').all(shelfEntryId);
    entries.push(Object.freeze({shelfEntryId,currentRevision,restoreRevision,nextRevision:currentRevision+1,moves:Object.freeze(moves),materials:Object.freeze(materials),deckFactDigest:canonicalDigest(deck)}));
  }
  const quarantines=[];
  for(const relative of INCIDENT_QUARANTINE_DIRECTORIES){
    const source=ensureInside(options.mediaRoot,path.join(options.mediaRoot,relative),'quarantine-source');
    const destination=ensureInside(options.mediaRoot,path.join(options.quarantineRoot,relative),'quarantine-destination');
    if(!fs.existsSync(source))continue;
    if(fs.existsSync(destination))fail('PROD064_QUARANTINE_DESTINATION_OCCUPIED',{destination});
    const files=listTreeFiles(source);
    if(!files.length||files.some((location)=>selectedSources.has(path.resolve(location))))fail('PROD064_QUARANTINE_SCOPE_CONFLICT',{source});
    const quarantineEntryId=QUARANTINE_ENTRY_BY_DIRECTORY[relative],staged=stagedIncidentEvidence(database,quarantineEntryId,options.incidentStartMs),proof=[];
    for(const location of files){const observed=computeBoundedMaterialFingerprintSync(location),knownIdentity=known.has(`${Number(observed.stat.size)}:${observed.contentFingerprint}`),stageBasis=quarantineStageBasis(location,observed,staged);if(!knownIdentity&&!stageBasis)fail('PROD064_QUARANTINE_UNKNOWN_FILE',{location});proof.push(Object.freeze({location,basis:knownIdentity?'historical_inventory_identity':stageBasis}));}
    quarantines.push(Object.freeze({source,destination,fileCount:files.length,proof:Object.freeze(proof)}));
  }
  return Object.freeze({entries:Object.freeze(entries),quarantines:Object.freeze(quarantines),moveCount:entries.reduce((sum,item)=>sum+item.moves.length,0),inventoryAdvanceCount:entries.filter((item)=>item.moves.length||item.materials.some((row,index)=>row.material_key!==queryRows(database,'arca_inventory_materials',item.shelfEntryId,item.currentRevision,'ordinal')[index].material_key||row.location!==queryRows(database,'arca_inventory_materials',item.shelfEntryId,item.currentRevision,'ordinal')[index].location)).length});
}

function moveWithJournal(source,destination,journal){fs.mkdirSync(path.dirname(destination),{recursive:true});if(fs.existsSync(destination))fail('PROD064_MOVE_DESTINATION_OCCUPIED',{destination});fs.renameSync(source,destination);journal.push({kind:'rename',source,destination});}
function rollbackJournal(journal){for(const item of [...journal].reverse()){if(item.kind==='rmdir'&&!fs.existsSync(item.location))fs.mkdirSync(item.location,{recursive:true});else if(item.kind==='rename'&&fs.existsSync(item.destination)&&!fs.existsSync(item.source)){fs.mkdirSync(path.dirname(item.source),{recursive:true});fs.renameSync(item.destination,item.source);}}}
function insertCopies(database,entry,next,at){
  const copy=(table,columns,order)=>{const rows=queryRows(database,table,entry.shelfEntryId,entry.currentRevision,order);const statement=database.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);for(const row of rows)statement.run(...columns.map((column)=>column==='inventory_revision'?next:column==='committed_at_ms'?at:row[column]));};
  copy('arca_inventory_related_references',['shelf_entry_id','inventory_revision','reference_id','primary_ordinal','role','reference_kind','material_identity_hint','endpoint_id','location','checksum_hex'],'reference_id');
  copy('arca_inventory_product_facts',['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_schema_ref','fact_json','fact_digest','source_package_id','provenance_digest','committed_at_ms'],'fact_kind,fact_revision');
  copy('arca_inventory_person_relations',['relation_id','shelf_entry_id','inventory_revision','person_id','display_name','display_name_normalized','role','relation_source','provider_identity_schema_ref','provider_identity_json','provider_identity_digest','origin_evidence_digest','confidence_class','relation_digest'],'relation_id');
}
function updateControls(database,entry,current,at,basisDigest,commitMarker){
  const oldKeys=new Set(current.map((row)=>row.material_key)),newByKey=new Map(entry.materials.map((row)=>[row.material_key,row]));
  for(const key of oldKeys){if(newByKey.has(key))continue;const row=database.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(key);if(!row||row.state!=='controlled'||row.owner_domain!=='arca'||row.owner_scope_type!=='shelf_entry'||row.owner_scope_id!==entry.shelfEntryId)fail('PROD064_OLD_CONTROL_MISMATCH',{shelfEntryId:entry.shelfEntryId,materialKey:key});const revision=Number(row.control_revision)+1;database.prepare("UPDATE fx_material_controls SET owner_domain=NULL,owner_scope_type=NULL,owner_scope_id=NULL,control_revision=?,state='released',updated_at_ms=? WHERE material_key=? AND control_revision=?").run(revision,at,key,row.control_revision);database.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(key,revision,'release','arca','shelf_entry',entry.shelfEntryId,null,null,null,basisDigest,commitMarker,at);}
  for(const [key,identity] of newByKey){if(oldKeys.has(key))continue;const row=database.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(key),revision=Number(row?.control_revision||0)+1;if(row&&row.state!=='released')fail('PROD064_NEW_CONTROL_UNAVAILABLE',{shelfEntryId:entry.shelfEntryId,materialKey:key});if(row)database.prepare("UPDATE fx_material_controls SET owner_domain='arca',owner_scope_type='shelf_entry',owner_scope_id=?,control_revision=?,state='controlled',updated_at_ms=? WHERE material_key=? AND control_revision=?").run(entry.shelfEntryId,revision,at,key,row.control_revision);else database.prepare('INSERT INTO fx_material_controls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,identity.mount_scope_id,identity.inode,identity.size_bytes,identity.fingerprint_algorithm,identity.fingerprint_version,identity.content_fingerprint,'arca','shelf_entry',entry.shelfEntryId,revision,'controlled',at);database.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(key,revision,'acquire',null,null,null,'arca','shelf_entry',entry.shelfEntryId,basisDigest,commitMarker,at);}
  for(const key of newByKey.keys()){const row=database.prepare('SELECT owner_domain,owner_scope_type,owner_scope_id,state FROM fx_material_controls WHERE material_key=?').get(key);if(!row||row.state!=='controlled'||row.owner_domain!=='arca'||row.owner_scope_type!=='shelf_entry'||row.owner_scope_id!==entry.shelfEntryId)fail('PROD064_CURRENT_CONTROL_POSTCONDITION',{shelfEntryId:entry.shelfEntryId,materialKey:key});}
}
function applyDatabase(database,plan,at,manifestDigest){
  const bindingDigestBefore=canonicalDigest(database.prepare('SELECT * FROM arca_material_bindings ORDER BY owner_object_type,owner_object_id,material_key').all());
  const transaction=database.transaction(()=>{for(const entry of plan.entries){
    const current=queryRows(database,'arca_inventory_materials',entry.shelfEntryId,entry.currentRevision,'ordinal');
    const pointer=database.prepare('SELECT current_inventory_revision,current_deck_fact_revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entry.shelfEntryId);if(Number(pointer.current_inventory_revision)!==entry.currentRevision)fail('PROD064_INVENTORY_POINTER_STALE',{shelfEntryId:entry.shelfEntryId});
    const deckBefore=database.prepare('SELECT * FROM arca_deck_fact_revisions WHERE shelf_entry_id=? ORDER BY revision').all(entry.shelfEntryId);if(canonicalDigest(deckBefore)!==entry.deckFactDigest)fail('PROD064_DECK_FACT_STALE',{shelfEntryId:entry.shelfEntryId});
    const source=database.prepare('SELECT source_package_id FROM arca_inventory_representations WHERE shelf_entry_id=? AND revision=?').get(entry.shelfEntryId,entry.currentRevision);const representationDigest=canonicalDigest({schema:'arca.inventory-representation@1',shelfEntryId:entry.shelfEntryId,inventoryRevision:entry.nextRevision,sourcePackageId:source.source_package_id,members:entry.materials.map(representationMember)});
    database.prepare('INSERT INTO arca_inventory_representations VALUES (?,?,?,?,?)').run(entry.shelfEntryId,entry.nextRevision,representationDigest,source.source_package_id,at);database.prepare('UPDATE arca_inventory_materials SET active_guard=0 WHERE shelf_entry_id=? AND inventory_revision=?').run(entry.shelfEntryId,entry.currentRevision);
    const insert=database.prepare('INSERT INTO arca_inventory_materials (shelf_entry_id,inventory_revision,ordinal,material_key,role,episode_claims_schema_ref,episode_claims_json,episode_claim_set_digest,endpoint_id,location,binding_revision,mount_scope_id,inode,fingerprint_algorithm,fingerprint_version,content_fingerprint,digest_hex,size_bytes,artifact_scope_schema_ref,artifact_scope_json,active_guard) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const item of entry.materials)insert.run(item.shelf_entry_id,entry.nextRevision,item.ordinal,item.material_key,item.role,item.episode_claims_schema_ref,item.episode_claims_json,item.episode_claim_set_digest,item.endpoint_id,item.location,item.binding_revision,item.mount_scope_id,item.inode,item.fingerprint_algorithm,item.fingerprint_version,item.content_fingerprint,item.digest_hex,item.size_bytes,item.artifact_scope_schema_ref,item.artifact_scope_json,item.active_guard);
    insertCopies(database,entry,entry.nextRevision,at);updateControls(database,entry,current,at,manifestDigest,`prod064-aftercare-placement-${manifestDigest.slice(0,32)}`);if(database.prepare('UPDATE arca_shelf_entries SET current_inventory_revision=? WHERE shelf_entry_id=? AND current_inventory_revision=?').run(entry.nextRevision,entry.shelfEntryId,entry.currentRevision).changes!==1)fail('PROD064_INVENTORY_CAS',{shelfEntryId:entry.shelfEntryId});
    const deckAfter=database.prepare('SELECT * FROM arca_deck_fact_revisions WHERE shelf_entry_id=? ORDER BY revision').all(entry.shelfEntryId);if(canonicalDigest(deckAfter)!==entry.deckFactDigest)fail('PROD064_DECK_FACT_CHANGED',{shelfEntryId:entry.shelfEntryId});
  }});transaction();
  const bindingDigestAfter=canonicalDigest(database.prepare('SELECT * FROM arca_material_bindings ORDER BY owner_object_type,owner_object_id,material_key').all());if(bindingDigestAfter!==bindingDigestBefore)fail('PROD064_HISTORICAL_BINDING_CHANGED');
}
function applyCorrection(database,options){
  const plan=inspectPlan(database,options),at=Date.now(),manifest={schema:'prod064.aftercare-placement-incident-correction@1',incidentStartMs:options.incidentStartMs,atMs:at,entries:plan.entries.map((item)=>({shelfEntryId:item.shelfEntryId,currentInventoryRevision:item.currentRevision,nextInventoryRevision:item.nextRevision,moves:item.moves})),quarantines:plan.quarantines};const manifestDigest=canonicalDigest(manifest),journal=[];fs.mkdirSync(options.journalDir,{recursive:true});const manifestPath=path.join(options.journalDir,`prod064-${at}-manifest.json`);fs.writeFileSync(manifestPath,canonicalJson({...manifest,manifestDigest})+'\n',{flag:'wx'});
  try{for(const entry of plan.entries)for(const move of entry.moves)moveWithJournal(move.source,move.destination,journal);for(const directory of [...new Set(plan.entries.flatMap((entry)=>entry.moves.map((move)=>path.dirname(move.source))))])if(fs.existsSync(directory)&&fs.readdirSync(directory).length===0){fs.rmdirSync(directory);journal.push({kind:'rmdir',location:directory});}for(const quarantine of plan.quarantines)moveWithJournal(quarantine.source,quarantine.destination,journal);
    applyDatabase(database,plan,at,manifestDigest);
  }catch(error){rollbackJournal(journal);throw error;}
  const receipt={schema:'prod064.aftercare-placement-incident-correction-receipt@1',manifestDigest,committedAtMs:at,journal,integrity:database.pragma('integrity_check',{simple:true}),foreignKeyViolations:database.pragma('foreign_key_check').length};if(receipt.integrity!=='ok'||receipt.foreignKeyViolations)fail('PROD064_DATABASE_POSTCONDITION',receipt);const receiptPath=path.join(options.journalDir,`prod064-${at}-receipt.json`);fs.writeFileSync(receiptPath,canonicalJson({...receipt,receiptDigest:canonicalDigest(receipt)})+'\n',{flag:'wx'});return Object.freeze({applied:true,manifestPath,receiptPath,manifestDigest,moveCount:plan.moveCount,quarantineCount:plan.quarantines.length,inventoryAdvanceCount:plan.entries.length,integrity:receipt.integrity,foreignKeyViolations:0});
}
function parseOptions(argv){const dataDir=path.resolve(valueAfter(argv,'--data-dir')||path.join(__dirname,'..','data')),mediaRoot=path.resolve(valueAfter(argv,'--media-root')||'/media'),quarantineRoot=path.resolve(valueAfter(argv,'--quarantine-root')||path.join(mediaRoot,'.shelfdeck-incidents/prod064-aftercare-placement')),journalDir=path.resolve(valueAfter(argv,'--journal-dir')||path.join(dataDir,'prod064-aftercare-placement')),incidentStartMs=Number(valueAfter(argv,'--incident-start-ms')),expectedShelfEntryIds=valuesAfter(argv,'--expected-shelf-entry-id'),restoreRevisions=new Map(valuesAfter(argv,'--restore-inventory-revision').map((item)=>{const index=item.lastIndexOf('=');return [item.slice(0,index),Number(item.slice(index+1))];}));if(!Number.isSafeInteger(incidentStartMs)||incidentStartMs<0)fail('PROD064_INCIDENT_START_REQUIRED');return {dataDir,mediaRoot,quarantineRoot,journalDir,incidentStartMs,expectedShelfEntryIds,restoreRevisions};}
function main(argv=process.argv.slice(2)){const options=parseOptions(argv),databasePath=path.join(options.dataDir,'shelfdeck.db'),apply=argv.includes('--apply');if(!fs.existsSync(databasePath))fail('PROD064_DATABASE_NOT_FOUND',{databasePath});const database=new Database(databasePath,apply?{}:{readonly:true,fileMustExist:true});try{database.pragma('foreign_keys=ON');if(apply){if(valueAfter(argv,'--confirm')!==CONFIRMATION)fail('PROD064_CONFIRMATION_REQUIRED');return applyCorrection(database,options);}return {operation:'prod064_aftercare_placement_incident_correction',confirmationRequired:CONFIRMATION,plan:inspectPlan(database,options)};}finally{database.close();}}
if(require.main===module){try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}catch(error){process.stderr.write(JSON.stringify({error:{code:error.message,message:error.message,details:error.details||null}},null,2)+'\n');process.exitCode=1;}}
module.exports=Object.freeze({CONFIRMATION,INCIDENT_ENTRIES,INCIDENT_QUARANTINE_DIRECTORIES,inspectPlan,applyCorrection,main,mapRestoreRows,parseOptions,quarantineStageBasis,resolveRestoreRevision,restoredLocation,stagedIncidentEvidence});
