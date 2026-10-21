'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel,verifyReadOnlySqliteSnapshot}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const persistence=path.resolve(__dirname,'../../src/helix/foundation/persistence');
const SOURCE_DIGEST='33ef1d7c2f07669991a8401754f7671c92f4848db8a9c1869724bc5edf8e614c';
const TARGET_DIGEST='b8c36a0bfc04e7789ca1e49e2639a749c1fe90b52cb80a8a6bb8ecf9b592232b';
const EXTRA_TABLE='libra_task_cancellations';
const fail=(code,message,details={})=>{throw Object.assign(new Error(message),{code,details});};
const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
function quote(value){if(!/^[a-z][a-z0-9_]*$/.test(value))fail('LIFECYCLE_SCHEMA_IDENTIFIER','Invalid declared identifier.');return '"'+value+'"';}
function snapshotPath(value){const resolved=path.resolve(value),stat=fs.lstatSync(resolved);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||normalized(resolved)!==normalized(fs.realpathSync(resolved)))
   fail('LIFECYCLE_SCHEMA_PATH_UNSAFE','Use a regular snapshot without path or hard-link aliases.');
 return resolved;
}
function schemas(){
 const load=expected=>{const archive=path.join(persistence,'release-schemas',expected),
   schemaDdl=zlib.gunzipSync(fs.readFileSync(archive+'.sql.gz')).toString('utf8'),
   schemaManifest=JSON.parse(zlib.gunzipSync(fs.readFileSync(archive+'.manifest.json.gz')));
   if(schemaManifest.ddlDigest!==expected||digest(schemaDdl)!==expected)fail('LIFECYCLE_SCHEMA_ARCHIVE_DRIFT','Frozen schema digest changed.');
   return {schemaDdl,schemaManifest};};
 const source=load(SOURCE_DIGEST),target=load(TARGET_DIGEST),old=source.schemaManifest,next=target.schemaManifest;
 const added=next.tables.filter(t=>!old.tables.some(o=>o.tableId===t.tableId)).map(t=>t.tableId);
 if(old.tableCount!==224||next.tableCount!==225||JSON.stringify(added)!==JSON.stringify([EXTRA_TABLE]))
   fail('LIFECYCLE_SCHEMA_SCOPE_DRIFT','Only the cancellation table may be added.');
 for(const table of old.tables){const current=next.tables.find(t=>t.tableId===table.tableId);
   if(!current||table.sqlDigest!==current.sqlDigest||JSON.stringify(table.columns)!==JSON.stringify(current.columns)||
       JSON.stringify(table.indexes)!==JSON.stringify(current.indexes))fail('LIFECYCLE_SCHEMA_SCOPE_DRIFT','Retained schema changed.',{tableId:table.tableId});}
 return {source,target};
}
function openSnapshot(Database,file,schema){const database=new Database(file,{readonly:true,fileMustExist:true});
 try{database.exec('BEGIN');return {database,proof:verifyReadOnlySqliteSnapshot({database,...schema})};}catch(error){database.close();throw error;}}
function rowDigest(database,table){const hash=crypto.createHash('sha256'),columns=table.columns.map(quote).join(',');let rowCount=0;
 const primary=database.prepare('PRAGMA table_info('+quote(table.tableId)+')').all().filter(row=>row.pk>0).sort((a,b)=>a.pk-b.pk).map(row=>quote(row.name));
 for(const row of database.prepare('SELECT '+columns+' FROM '+quote(table.tableId)+' ORDER BY '+(primary.length?primary.join(','):columns)).safeIntegers().iterate()){
   hash.update(JSON.stringify(table.columns.map(column=>{const value=row[column];return [column,typeof value==='bigint'?['integer',value.toString()]:
     Buffer.isBuffer(value)?['blob',value.toString('hex')]:value===null?['null']:[typeof value,value]];}))+'\n');rowCount++;}
 return {tableId:table.tableId,rowCount,rowDigest:hash.digest('hex')};
}
function inspectLifecycleSchemaSource({Database,sourcePath}){const {source}=schemas(),opened=openSnapshot(Database,snapshotPath(sourcePath),source);
 try{return {eligible:true,source:opened.proof,targetSchemaDigest:TARGET_DIGEST,addedTables:[EXTRA_TABLE],retainedTableCount:223,sourceMode:'readonly_snapshot'};}
 finally{opened.database.close();}}
function prepareLifecycleSchemaCopy({Database,sourcePath,targetPath,rollback=false,now=Date.now}){
 sourcePath=snapshotPath(sourcePath);targetPath=path.resolve(targetPath);const parent=path.dirname(targetPath);
 if(normalized(parent)!==normalized(fs.realpathSync(parent)))fail('LIFECYCLE_SCHEMA_PATH_UNSAFE','Output parent must not use aliases.');
 if([targetPath,targetPath+'-wal',targetPath+'-shm',targetPath+'-journal'].some(file=>fs.existsSync(file)))fail('LIFECYCLE_SCHEMA_TARGET_EXISTS','Never overwrite an existing output.');
 const frozen=schemas(),source=rollback?frozen.target:frozen.source,target=rollback?frozen.source:frozen.target,
   original=openSnapshot(Database,sourcePath,source);let database,temporary;
 try{
   if(rollback&&original.database.prepare('SELECT count(*) n FROM '+quote(EXTRA_TABLE)).get().n)
     fail('LIFECYCLE_SCHEMA_ROLLBACK_NEW_FACTS','Cancellation facts prohibit removing their owner table; retain this version and repair forward.');
   temporary=path.join(parent,'.lifecycle-schema-preparing-'+crypto.randomUUID()+'.sqlite');fs.closeSync(fs.openSync(temporary,'wx'));
   openSqliteKernel({Database,databasePath:temporary,...target,now}).close();database=new Database(temporary);
   database.pragma('foreign_keys=OFF');database.exec('BEGIN IMMEDIATE');const tableProofs=[];
   for(const table of frozen.source.schemaManifest.tables.filter(t=>t.tableId!=='platform_schema_marker')){
     const columns=table.columns.map(quote).join(','),insert=database.prepare('INSERT INTO '+quote(table.tableId)+' ('+columns+') VALUES ('+table.columns.map(()=>'?').join(',')+')');
     for(const row of original.database.prepare('SELECT '+columns+' FROM '+quote(table.tableId)).safeIntegers().iterate())insert.run(...table.columns.map(column=>row[column]));
     const before=rowDigest(original.database,table),after=rowDigest(database,table);
     if(JSON.stringify(before)!==JSON.stringify(after))fail('LIFECYCLE_SCHEMA_COPY_MISMATCH','Retained historical bytes changed.',{tableId:table.tableId});
     tableProofs.push(before);
   }
   if(database.pragma('foreign_key_check').length||database.pragma('integrity_check')[0]?.integrity_check!=='ok')fail('LIFECYCLE_SCHEMA_INTEGRITY','Prepared copy failed integrity validation.');
   database.exec('COMMIT');
   if(database.pragma('journal_mode=DELETE',{simple:true})!=='delete')fail('LIFECYCLE_SCHEMA_CHECKPOINT','Prepared copy must be standalone.');
   database.close();database=null;
   const verified=openSnapshot(Database,temporary,target);let proof;try{proof=verified.proof;}finally{verified.database.close();}
   const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.linkSync(temporary,targetPath);
   if(process.platform==='linux'){const dir=fs.openSync(parent,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
   return {operatorVersion:1,prepared:true,rollback,source:original.proof,target:proof,tableProofs,copiedTableCount:tableProofs.length,sourceMode:'readonly_snapshot',applied:false};
 }finally{if(database?.inTransaction)database.exec('ROLLBACK');database?.close();original.database.close();
   if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
module.exports=Object.freeze({SOURCE_DIGEST,TARGET_DIGEST,inspectLifecycleSchemaSource,prepareLifecycleSchemaCopy});
