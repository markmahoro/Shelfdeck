'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel,verifyReadOnlySqliteSnapshot}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {proveReleaseEffectHistory}=require('./jav-release-effect-history-proof');
const persistence=path.resolve(__dirname,'../../src/helix/foundation/persistence');
const SOURCE_DIGEST='5e82c36bf1d63e1297cf468361be67c074df3226a64d2dfb755d472db0bbee41';
const TARGET_DIGEST='33ef1d7c2f07669991a8401754f7671c92f4848db8a9c1869724bc5edf8e614c';
const EXTRA_TABLES=Object.freeze(['arca_us_actor_refresh_intents','arca_us_actor_refresh_pages','libra_us_adult_actor_choice_heads',
  'libra_us_adult_actor_choice_intents','libra_us_adult_analysis_bases','libra_us_adult_match_completions','libra_us_adult_reference_pages',
  'people_image_operations','people_us_recommendation_claims','people_us_recommendation_cycles','people_us_recommendation_groups',
  'people_us_recommendation_publications','people_us_recommendation_sources','perception_acquisition_resume_intents']);
const CHANGED=new Set(['libra_product_fact_revisions','libra_product_fact_source_refs','people_persons','people_provider_identities','people_reference_revisions']);
const TERMINAL={proc_procurement_runs:['state',['sealed']],libra_runs:['state',['completed','discarded','superseded']],
  arca_ondeck_runs:['state',['committed']],arca_acceptance_attempts:['state',['accepted','rejected']],
  arca_acceptance_recovery_cases:['recovery_state',['resolved']],arca_aftercare_cases:['state',['resolved','invalidated','unresolved']],
  arca_offdeck_cases:['state',['completed']],arca_deregistrations:['state',['committed']],
  fx_supporting_works:['state',['succeeded','failed','cancelled']],fx_work_attempts:['state',['succeeded','failed','cancelled']],
  fx_workflow_events:['state',['succeeded','skipped','failed','cancelled']],fx_event_attempts:['state',['completed']],
  fx_effect_journal:['state',['committed','failed']],fx_outbox:['state',['fully_acked','tombstoned']]};
function fail(code,message,details={}){throw Object.assign(new Error(message),{code,details});}
const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
function quote(value){if(!/^[a-z][a-z0-9_]*$/.test(value))fail('US_SCHEMA_IDENTIFIER_INVALID','Invalid declared schema identifier.');return '"'+value+'"';}
function safePath(value){
  const absolute=path.resolve(value),stat=fs.lstatSync(absolute);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||normalized(absolute)!==normalized(fs.realpathSync(absolute)))
    fail('US_SCHEMA_PATH_UNSAFE','Source must be a regular standalone file without link aliases.');
  return absolute;
}
function schemas(){
  const load=expected=>{const archive=path.join(persistence,'release-schemas',expected),schemaDdl=zlib.gunzipSync(fs.readFileSync(archive+'.sql.gz')).toString('utf8'),
    schemaManifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(archive+'.manifest.json.gz')));
    if(schemaManifest.ddlDigest!==expected||digest(schemaDdl)!==expected)fail('US_SCHEMA_ARCHIVE_INVALID','Frozen schema archive digest changed.');
    return {schemaDdl,schemaManifest};};
  const source=load(SOURCE_DIGEST),target=load(TARGET_DIGEST),old=source.schemaManifest,current=target.schemaManifest,
    added=current.tables.filter(table=>!old.tables.some(item=>item.tableId===table.tableId)).map(table=>table.tableId).sort();
  if(old.tableCount!==210||current.tableCount!==224||JSON.stringify(added)!==JSON.stringify(EXTRA_TABLES))fail('US_SCHEMA_SCOPE_INVALID','Frozen upgrade table scope changed.');
  for(const table of old.tables){const next=current.tables.find(item=>item.tableId===table.tableId),extras=['people_persons','people_provider_identities'].includes(table.tableId)?['library_kind']:[];
    if(!next||JSON.stringify(next.columns.filter(column=>!extras.includes(column)))!==JSON.stringify(table.columns)||
      !CHANGED.has(table.tableId)&&table.sqlDigest!==next.sqlDigest)fail('US_SCHEMA_SCOPE_INVALID','Retained schema changed outside the versioned upgrade scope.',{tableId:table.tableId});}
  return {source,target};
}
function openSnapshot(Database,file,schema){const database=new Database(file,{readonly:true,fileMustExist:true});
  try{database.exec('BEGIN');return {database,proof:verifyReadOnlySqliteSnapshot({database,...schema})};}catch(error){database.close();throw error;}}
function rowDigest(database,table){const hash=crypto.createHash('sha256'),columns=table.columns.map(quote).join(',');let rowCount=0;
  for(const row of database.prepare('SELECT '+columns+' FROM '+quote(table.tableId)+' ORDER BY '+columns).safeIntegers().iterate()){
    hash.update(JSON.stringify(table.columns.map(column=>{const value=row[column];return [column,typeof value==='bigint'?['integer',value.toString()]:
      Buffer.isBuffer(value)?['blob',value.toString('hex')]:value===null?['null']:[typeof value,value]];}))+'\n');rowCount++;}
  return {tableId:table.tableId,rowCount,rowDigest:hash.digest('hex')};}
function classify(database){
  const people=database.prepare('SELECT person_id FROM people_persons ORDER BY person_id').all(),evidence=new Map(people.map(row=>[row.person_id,new Set()]));
  const add=(id,kind)=>{if(evidence.has(id))evidence.get(id).add(kind);};
  for(const row of database.prepare('SELECT person_id,provider,namespace,provider_key FROM people_provider_identities').iterate()){
    if(row.provider==='tmdb'&&['person','tmdb_person'].includes(row.namespace)&&/^[1-9][0-9]{0,15}$/.test(row.provider_key))add(row.person_id,'normal');
    if(row.provider==='javdb'&&row.namespace==='javdb_actor'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.provider_key))add(row.person_id,'jav');
  }
  for(const row of database.prepare('SELECT r.person_id,i.identity_kind FROM arca_inventory_person_relations r JOIN arca_shelf_entries e ON e.shelf_entry_id=r.shelf_entry_id JOIN arca_canonical_identity_revisions i ON i.shelf_entry_id=e.shelf_entry_id AND i.revision=e.canonical_identity_revision WHERE r.person_id IS NOT NULL').iterate()){
    if(['tmdb_movie','tmdb_series_season'].includes(row.identity_kind))add(row.person_id,'normal');
    if(row.identity_kind==='jav_code')add(row.person_id,'jav');
    if(row.identity_kind==='internal_identity')add(row.person_id,'us_adult');
  }
  const edges=database.prepare('SELECT person_id,merged_into_person_id FROM people_person_revisions WHERE merged_into_person_id IS NOT NULL').all();
  for(let changed=true;changed;){changed=false;for(const edge of edges){const left=evidence.get(edge.person_id),right=evidence.get(edge.merged_into_person_id);
    if(!left||!right)continue;for(const kind of new Set([...left,...right]))for(const set of [left,right])if(!set.has(kind)){set.add(kind);changed=true;}}}
  const assignments=[],blockers=[];
  for(const row of people){const kinds=[...evidence.get(row.person_id)].sort();if(kinds.length!==1)blockers.push({personId:row.person_id,reasonCode:kinds.length?'conflicting_library_evidence':'library_evidence_missing'});
    else assignments.push({personId:row.person_id,libraryKind:kinds[0]});}
  return {assignments,blockers};
}
function inspect(database,schema){
  const effectHistory=proveReleaseEffectHistory(database,schema),blockers=Object.entries(TERMINAL).flatMap(([tableId,[column,states]])=>{
    const count=database.prepare('SELECT count(*) n FROM '+quote(tableId)+' WHERE '+quote(column)+' IS NULL OR '+quote(column)+' NOT IN ('+states.map(()=>'?').join(',')+')').get(...states).n,
      unresolved=tableId==='fx_effect_journal'?count-effectHistory.provenEffectIds.length:count;
    return unresolved?[{tableId,count:unresolved,reasonCode:'unfinished_responsibility'}]:[];});
  const classification=classify(database);return {...classification,blockers:[...blockers,...classification.blockers]};
}
function inspectUsAdultSchemaSource({Database,sourcePath}){
  const {source}=schemas(),opened=openSnapshot(Database,safePath(sourcePath),source);
  try{const result=inspect(opened.database,source.schemaManifest);return {operatorVersion:1,eligible:!result.blockers.length,source:opened.proof,
    targetSchemaDigest:TARGET_DIGEST,...result,sourceMode:'readonly_snapshot'};}finally{opened.database.close();}
}
function prepareUsAdultSchemaCopy({Database,sourcePath,targetPath,now=Date.now}){
  sourcePath=safePath(sourcePath);targetPath=path.resolve(targetPath);const parent=path.dirname(targetPath);
  if(normalized(parent)!==normalized(fs.realpathSync(parent)))fail('US_SCHEMA_PATH_UNSAFE','Output parent cannot use aliases.');
  if([targetPath,targetPath+'-wal',targetPath+'-shm',targetPath+'-journal'].some(file=>fs.existsSync(file)))fail('US_SCHEMA_TARGET_EXISTS','Never overwrite an existing output.');
  const {source,target}=schemas(),opened=openSnapshot(Database,sourcePath,source);let database,temporary;
  try{
    const qualification=inspect(opened.database,source.schemaManifest);
    if(qualification.blockers.length)fail('US_SCHEMA_SOURCE_INELIGIBLE','Unfinished responsibilities or unclassified identities require separate handling.',{blockers:qualification.blockers});
    const libraries=new Map(qualification.assignments.map(item=>[item.personId,item.libraryKind]));
    temporary=path.join(parent,'.us-adult-schema-preparing-'+crypto.randomUUID()+'.sqlite');fs.closeSync(fs.openSync(temporary,'wx'));
    const kernel=openSqliteKernel({Database,databasePath:temporary,...target,now});kernel.close();database=new Database(temporary);
    database.pragma('foreign_keys=OFF');database.exec('BEGIN IMMEDIATE');const tableProofs=[];
    for(const table of source.schemaManifest.tables.filter(item=>item.tableId!=='platform_schema_marker')){
      const library=['people_persons','people_provider_identities'].includes(table.tableId),columns=[...table.columns,...(library?['library_kind']:[])],
        insert=database.prepare('INSERT INTO '+quote(table.tableId)+' ('+columns.map(quote).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')');
      for(const row of opened.database.prepare('SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.tableId)).safeIntegers().iterate())
        insert.run(...table.columns.map(column=>row[column]),...(library?[libraries.get(row.person_id)]:[]));
      const before=rowDigest(opened.database,table),after=rowDigest(database,table);
      if(JSON.stringify(before)!==JSON.stringify(after))fail('US_SCHEMA_COPY_MISMATCH','Retained historical bytes changed.',{tableId:table.tableId});tableProofs.push(before);
    }
    if(database.pragma('foreign_key_check').length||database.pragma('integrity_check')[0]?.integrity_check!=='ok')fail('US_SCHEMA_COPY_INTEGRITY_FAILED','Prepared copy failed integrity validation.');
    database.exec('COMMIT');database.pragma('journal_mode=DELETE');database.close();database=null;
    const verified=openSnapshot(Database,temporary,target);let proof;try{proof=verified.proof;}finally{verified.database.close();}
    const descriptor=fs.openSync(temporary,'r+');try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
    fs.linkSync(temporary,targetPath);if(process.platform==='linux'){const directory=fs.openSync(parent,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
    return {operatorVersion:1,prepared:true,source:opened.proof,target:proof,classificationDigest:digest(JSON.stringify(qualification.assignments)),
      assignments:qualification.assignments,tableProofs,sourceMode:'readonly_snapshot',applied:false};
  }finally{if(database?.inTransaction)database.exec('ROLLBACK');database?.close();opened.database.close();if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function verifyUsAdultSchemaRollback({Database,sourcePath,upgradedPath}){
  const {source,target}=schemas(),opened=openSnapshot(Database,safePath(sourcePath),source);let upgraded;
  try{upgraded=openSnapshot(Database,safePath(upgradedPath),target);
    for(const tableId of EXTRA_TABLES)if(upgraded.database.prepare('SELECT count(*) n FROM '+quote(tableId)).get().n)fail('US_SCHEMA_ROLLBACK_CHANGED_FACTS','New version facts prohibit a lossless baseline rollback.',{tableId});
    for(const table of source.schemaManifest.tables.filter(item=>item.tableId!=='platform_schema_marker'))
      if(JSON.stringify(rowDigest(opened.database,table))!==JSON.stringify(rowDigest(upgraded.database,table)))fail('US_SCHEMA_ROLLBACK_CHANGED_FACTS','Retained facts changed after upgrade.',{tableId:table.tableId});
    const assignments=classify(opened.database).assignments;
    for(const row of assignments)if(upgraded.database.prepare('SELECT library_kind FROM people_persons WHERE person_id=?').get(row.personId)?.library_kind!==row.libraryKind||
      upgraded.database.prepare('SELECT count(*) n FROM people_provider_identities WHERE person_id=? AND library_kind<>?').get(row.personId,row.libraryKind).n)
      fail('US_SCHEMA_ROLLBACK_CHANGED_FACTS','Person library assignment changed after upgrade.');
    return {operatorVersion:1,eligible:true,verifiedTableCount:209,applied:false};
  }finally{upgraded?.database.close();opened.database.close();}
}
module.exports=Object.freeze({SOURCE_DIGEST,TARGET_DIGEST,EXTRA_TABLES,inspectUsAdultSchemaSource,prepareUsAdultSchemaCopy,verifyUsAdultSchemaRollback});
