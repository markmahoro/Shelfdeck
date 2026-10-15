'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel,verifyReadOnlySqliteSnapshot}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const persistence=path.resolve(__dirname,'../../src/helix/foundation/persistence');
const SOURCE_DIGEST='6ff9269258f74ae96d99ad770d1bd1d75a2fd38677def2e0e4c1fef2e50ca5ea';
const TARGET_DIGEST='5e82c36bf1d63e1297cf468361be67c074df3226a64d2dfb755d472db0bbee41';
const EXTRA_TABLES=Object.freeze(['libra_fairness_clocks','libra_fairness_events','libra_fairness_runs','libra_fairness_sources','libra_workshop_placements','libra_workshop_policies']);
function fail(code,message,details={}){throw Object.assign(new Error(message),{code,details});}
const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
function quote(value){if(!/^[a-z][a-z0-9_]*$/.test(value))fail('LIBRA_SCHEMA_IDENTIFIER_INVALID','Invalid schema identifier.');return '"'+value+'"';}
function snapshotPath(value){
 const resolved=path.resolve(value),stat=fs.lstatSync(resolved);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||normalized(resolved)!==normalized(fs.realpathSync(resolved)))
  fail('LIBRA_SCHEMA_PATH_UNSAFE','Use a regular snapshot without symbolic or hard-link aliases.');
 return resolved;
}
function schemas(){
 const archive=path.join(persistence,'release-schemas',SOURCE_DIGEST);
 const source={schemaDdl:zlib.gunzipSync(fs.readFileSync(archive+'.sql.gz')).toString('utf8'),
  schemaManifest:JSON.parse(zlib.gunzipSync(fs.readFileSync(archive+'.manifest.json.gz')))};
 const target={schemaDdl:fs.readFileSync(path.join(persistence,'generated/clean-schema.sql'),'utf8'),
  schemaManifest:JSON.parse(fs.readFileSync(path.join(persistence,'generated/clean-schema.manifest.json'),'utf8'))};
 for(const [schema,expected] of [[source,SOURCE_DIGEST],[target,TARGET_DIGEST]])if(schema.schemaManifest.ddlDigest!==expected||digest(schema.schemaDdl)!==expected)
  fail('LIBRA_SCHEMA_DIGEST_DRIFT','Schema copy requires its exact frozen source and target.');
 const previous=source.schemaManifest,current=target.schemaManifest;
 const added=current.tables.filter(row=>!previous.tables.some(old=>old.tableId===row.tableId)).map(row=>row.tableId).sort();
 if(previous.tableCount!==204||current.tableCount!==210||JSON.stringify(added)!==JSON.stringify(EXTRA_TABLES))
  fail('LIBRA_SCHEMA_DIFFERENCE_INVALID','Schema copy table scope changed.');
 for(const old of previous.tables){
  const next=current.tables.find(row=>row.tableId===old.tableId),resource=old.tableId==='fx_resource_defer';
  if(!next||JSON.stringify(next.columns.filter(column=>!resource||column!=='priority_revision'))!==JSON.stringify(old.columns)||
   JSON.stringify(next.indexes)!==JSON.stringify(old.indexes)||(!resource&&next.sqlDigest!==old.sqlDigest)||
   (resource&&!next.columns.includes('priority_revision')))fail('LIBRA_SCHEMA_DIFFERENCE_INVALID','Existing schema changed outside the frozen additive scope.',{tableId:old.tableId});
 }
 return {source,target};
}
function openSnapshot(Database,databasePath,schema){
 const database=new Database(databasePath,{readonly:true,fileMustExist:true});
 try{database.exec('BEGIN');return {database,proof:verifyReadOnlySqliteSnapshot({database,...schema})};}
 catch(error){database.close();throw error;}
}
function rowDigest(database,table){
 const columns=table.columns.map(quote).join(','),hash=crypto.createHash('sha256');let rowCount=0;
 const primary=database.prepare('PRAGMA table_info('+quote(table.tableId)+')').all().filter(row=>row.pk>0).sort((a,b)=>a.pk-b.pk).map(row=>quote(row.name));
 const order=primary.length?primary.join(','):columns;
 for(const row of database.prepare('SELECT '+columns+' FROM '+quote(table.tableId)+' ORDER BY '+order).safeIntegers().iterate()){
  hash.update(JSON.stringify(table.columns.map(column=>{const value=row[column];return [column,typeof value==='bigint'?['integer',value.toString()]:
   Buffer.isBuffer(value)?['blob',value.toString('hex')]:value===null?['null']:[typeof value,value]];}))+'\n');rowCount++;
 }
 return {tableId:table.tableId,rowCount,rowDigest:hash.digest('hex')};
}
function inspectLibraSchemaSource({Database,sourcePath}){
 sourcePath=snapshotPath(sourcePath);const {source,target}=schemas(),opened=openSnapshot(Database,sourcePath,source);
 try{return {eligible:true,source:opened.proof,targetSchemaDigest:target.schemaManifest.ddlDigest,
  retainedTableCount:203,addedTables:EXTRA_TABLES,addedColumns:{fx_resource_defer:['priority_revision']},sourceMode:'readonly_snapshot'};}
 finally{opened.database.close();}
}
function prepareLibraSchemaCopy({Database,sourcePath,targetPath,now=Date.now}){
 sourcePath=snapshotPath(sourcePath);targetPath=path.resolve(targetPath);
 const parent=path.dirname(targetPath);
 if(normalized(parent)!==normalized(fs.realpathSync(parent)))fail('LIBRA_SCHEMA_PATH_UNSAFE','Output parent must not use aliases.');
 if([targetPath,targetPath+'-wal',targetPath+'-shm',targetPath+'-journal'].some(value=>fs.existsSync(value)))fail('LIBRA_SCHEMA_TARGET_EXISTS','Never overwrite an existing output.');
 const {source,target}=schemas(),original=openSnapshot(Database,sourcePath,source);
 let database,temporary;
 try{
  temporary=path.join(parent,'.libra-schema-preparing-'+crypto.randomUUID()+'.sqlite');fs.closeSync(fs.openSync(temporary,'wx'));
  const kernel=openSqliteKernel({Database,databasePath:temporary,...target,now});kernel.close();
  database=new Database(temporary);database.pragma('foreign_keys=OFF');database.exec('BEGIN IMMEDIATE');
  const tableProofs=[];
  for(const table of source.schemaManifest.tables.filter(row=>row.tableId!=='platform_schema_marker')){
   const columns=table.columns.map(quote).join(','),insert=database.prepare('INSERT INTO '+quote(table.tableId)+' ('+columns+') VALUES ('+table.columns.map(()=>'?').join(',')+')');
   for(const row of original.database.prepare('SELECT '+columns+' FROM '+quote(table.tableId)).safeIntegers().iterate())insert.run(...table.columns.map(column=>row[column]));
   const before=rowDigest(original.database,table),after=rowDigest(database,table);
   if(JSON.stringify(before)!==JSON.stringify(after))fail('LIBRA_SCHEMA_COPY_MISMATCH','A retained row set changed.',{tableId:table.tableId});
   tableProofs.push(before);
  }
  if(database.pragma('foreign_key_check').length||database.pragma('integrity_check')[0]?.integrity_check!=='ok')fail('LIBRA_SCHEMA_COPY_INTEGRITY_FAILED','Prepared copy failed integrity verification.');
  database.exec('COMMIT');
  if(database.pragma('journal_mode=DELETE',{simple:true})!=='delete')fail('LIBRA_SCHEMA_COPY_CHECKPOINT_FAILED','Prepared copy must be standalone.');
  database.close();database=null;
  const verified=openSnapshot(Database,temporary,target);let targetProof;try{targetProof=verified.proof;}finally{verified.database.close();}
  const descriptor=fs.openSync(temporary,'r+');try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
  fs.linkSync(temporary,targetPath);
  if(process.platform==='linux'){const directory=fs.openSync(parent,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
  return {prepared:true,source:original.proof,target:targetProof,copiedTableCount:tableProofs.length,tableProofs,sourceMode:'readonly_snapshot'};
 }finally{
  if(database?.inTransaction)database.exec('ROLLBACK');database?.close();original.database.close();
  if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);
 }
}
function verifyLibraSchemaRollback({Database,sourcePath,upgradedPath}){
 sourcePath=snapshotPath(sourcePath);upgradedPath=snapshotPath(upgradedPath);
 const {source,target}=schemas(),original=openSnapshot(Database,sourcePath,source);let upgraded;
 try{
  upgraded=openSnapshot(Database,upgradedPath,target);
  for(const tableId of EXTRA_TABLES)if(upgraded.database.prepare('SELECT count(*) AS n FROM '+quote(tableId)).get().n)
   fail('LIBRA_SCHEMA_ROLLBACK_CHANGED_FACTS','New workshop or fairness facts prohibit baseline rollback.',{tableId});
  if(upgraded.database.prepare('SELECT count(*) AS n FROM fx_resource_defer WHERE priority_revision IS NOT NULL').get().n)
   fail('LIBRA_SCHEMA_ROLLBACK_CHANGED_FACTS','Recorded resource priority revisions prohibit baseline rollback.',{tableId:'fx_resource_defer'});
  for(const table of source.schemaManifest.tables.filter(row=>row.tableId!=='platform_schema_marker'))if(JSON.stringify(rowDigest(original.database,table))!==JSON.stringify(rowDigest(upgraded.database,table)))
   fail('LIBRA_SCHEMA_ROLLBACK_CHANGED_FACTS','Changed facts prohibit baseline rollback.',{tableId:table.tableId});
  return {eligible:true,verifiedTableCount:203,applied:false};
 }finally{upgraded?.database.close();original.database.close();}
}
module.exports=Object.freeze({SOURCE_DIGEST,TARGET_DIGEST,inspectLibraSchemaSource,prepareLibraSchemaCopy,verifyLibraSchemaRollback});
