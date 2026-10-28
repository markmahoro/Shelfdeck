'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel,verifyReadOnlySqliteSnapshot}=require('../src/helix/foundation/persistence/sqlite-kernel');
const IDENTIFIER=/^[a-z][a-z0-9_]*$/;
function fail(code){throw Object.assign(new Error(code),{code});}
function quote(value){if(!IDENTIFIER.test(value))fail('ADDITIVE_SCHEMA_IDENTIFIER_INVALID');return '"'+value+'"';}
function same(value,other){return canonicalJson(value)===canonicalJson(other);}
function planAdditiveSchemaExtension({sourceSchema,targetSchema,extension,sourceBytes}){
  if(!extension||extension.schemaRef!=='operator.additive-table-extension@1'||!Array.isArray(extension.addedTables)||
      !extension.addedTables.length||extension.addedTables.length>32||new Set(extension.addedTables).size!==extension.addedTables.length||
      extension.addedTables.some(name=>!IDENTIFIER.test(name))||!Number.isSafeInteger(sourceBytes)||sourceBytes<0)
    fail('ADDITIVE_SCHEMA_EXTENSION_INVALID');
  for(const [schema,expected]of[[sourceSchema,extension.sourceDdlDigest],[targetSchema,extension.targetDdlDigest]])
    if(!schema||typeof schema.schemaDdl!=='string'||schema.schemaManifest?.ddlDigest!==expected||
        crypto.createHash('sha256').update(schema.schemaDdl).digest('hex')!==expected)fail('ADDITIVE_SCHEMA_CONTRACT_CHANGED');
  const before=sourceSchema.schemaManifest,after=targetSchema.schemaManifest,
    additions=after.tables.filter(table=>!before.tables.some(row=>row.tableId===table.tableId)).map(table=>table.tableId).sort();
  if(before.tables.length!==before.tableCount||after.tables.length!==after.tableCount||!same(additions,[...extension.addedTables].sort())||
      before.tables.some(table=>{const next=after.tables.find(row=>row.tableId===table.tableId);
        return !next||next.sqlDigest!==table.sqlDigest||!same(next.columns,table.columns);}))fail('ADDITIVE_SCHEMA_EXISTING_DEFINITION_CHANGED');
  const requiredAvailableBytes=(BigInt(sourceBytes)*3n+536870912n).toString();
  const body={schemaRef:'operator.additive-schema-plan@1',sourceDdlDigest:before.ddlDigest,targetDdlDigest:after.ddlDigest,
    sourceTableCount:before.tableCount,targetTableCount:after.tableCount,addedTables:additions,sourceBytes,requiredAvailableBytes};
  return Object.freeze({...body,planDigest:canonicalDigest(body)});
}
function evidence(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const before=fs.fstatSync(fd,{bigint:true}),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let size=0n;
    if(!before.isFile()||before.nlink!==1n)fail('ADDITIVE_SCHEMA_SOURCE_UNSAFE');
    for(;;){const bytes=fs.readSync(fd,buffer,0,buffer.length,null);if(!bytes)break;hash.update(buffer.subarray(0,bytes));size+=BigInt(bytes);}
    const after=fs.fstatSync(fd,{bigint:true});if(size!==before.size||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
      fail('ADDITIVE_SCHEMA_SOURCE_CHANGED');
    return {bytes:Number(size),sha256:hash.digest('hex'),dev:String(before.dev),ino:String(before.ino),mtimeNs:String(before.mtimeNs),ctimeNs:String(before.ctimeNs)};
  }finally{fs.closeSync(fd);}
}
function rowsDigest(db,table){
  const columns=table.columns,keys=db.prepare('PRAGMA table_info('+quote(table.tableId)+')').all().filter(row=>row.pk)
    .sort((a,b)=>a.pk-b.pk).map(row=>row.name),hash=crypto.createHash('sha256');let rowCount=0;
  for(const row of db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(table.tableId)+' ORDER BY '+
      (keys.length?keys:columns).map(quote).join(',')).safeIntegers().iterate()){
    hash.update(JSON.stringify(columns.map(column=>{const value=row[column];return [column,typeof value==='bigint'?['integer',value.toString()]:
      Buffer.isBuffer(value)?['blob',value.toString('hex')]:value===null?['null']:[typeof value,value]];}))+'\n');rowCount++;
  }
  return {tableId:table.tableId,rowCount,rowDigest:hash.digest('hex')};
}
// This prepares a new, standalone snapshot only. The stopped deployment operator
// owns backup, exclusive connection closure, generation switch and rollback.
// No live database, media file or runtime intent is opened for writing here.
function prepareAdditiveSchemaSnapshot({Database,sourcePath,targetPath,sourceSchema,targetSchema,extension,now=Date.now}){
  if(process.platform!=='linux')fail('ADDITIVE_SCHEMA_LINUX_REQUIRED');
  sourcePath=path.resolve(sourcePath);targetPath=path.resolve(targetPath);const parent=path.dirname(targetPath),
    absentTarget=()=>![targetPath,targetPath+'-wal',targetPath+'-shm',targetPath+'-journal'].some(file=>fs.existsSync(file));
  if(sourcePath===targetPath||fs.realpathSync(sourcePath)!==sourcePath||fs.realpathSync(parent)!==parent||!absentTarget()||
      ['-wal','-shm','-journal'].some(suffix=>fs.existsSync(sourcePath+suffix)))fail('ADDITIVE_SCHEMA_PATH_UNSAFE');
  const original=evidence(sourcePath),plan=planAdditiveSchemaExtension({sourceSchema,targetSchema,extension,sourceBytes:original.bytes}),
    volume=fs.statfsSync(parent,{bigint:true});
  if(volume.bavail*volume.bsize<BigInt(plan.requiredAvailableBytes))fail('ADDITIVE_SCHEMA_CAPACITY_INSUFFICIENT');
  const work=fs.mkdtempSync(path.join(parent,'.additive-schema-')),sourceCopy=path.join(work,'source.sqlite'),prepared=path.join(work,'target.sqlite');
  let source,target,published=false;
  try{
    fs.copyFileSync(sourcePath,sourceCopy,fs.constants.COPYFILE_EXCL);
    if(evidence(sourceCopy).sha256!==original.sha256||!same(evidence(sourcePath),original)||
        ['-wal','-shm','-journal'].some(suffix=>fs.existsSync(sourcePath+suffix)))fail('ADDITIVE_SCHEMA_SOURCE_CHANGED');
    source=new Database(sourceCopy,{readonly:true,fileMustExist:true});source.exec('BEGIN');
    const sourceProof=verifyReadOnlySqliteSnapshot({database:source,...sourceSchema});
    openSqliteKernel({Database,databasePath:prepared,...targetSchema,now}).close();
    target=new Database(prepared);target.pragma('foreign_keys=OFF');target.exec('BEGIN IMMEDIATE');
    const tableProofs=[];
    for(const table of sourceSchema.schemaManifest.tables.filter(table=>table.tableId!=='platform_schema_marker')){
      const insert=target.prepare('INSERT INTO '+quote(table.tableId)+' ('+table.columns.map(quote).join(',')+') VALUES ('+table.columns.map(()=>'?').join(',')+')');
      for(const row of source.prepare('SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.tableId)).safeIntegers().iterate())
        insert.run(...table.columns.map(column=>row[column]));
      const before=rowsDigest(source,table),after=rowsDigest(target,table);if(!same(before,after))fail('ADDITIVE_SCHEMA_ROW_CHANGED');
      tableProofs.push(before);
    }
    target.exec('COMMIT');target.close();target=null;
    const verified=openSqliteKernel({Database,databasePath:prepared,...targetSchema,now});let targetProof;
    try{targetProof=verified.generation;}finally{verified.close();}
    if(['-wal','-shm','-journal'].some(suffix=>fs.existsSync(prepared+suffix))||!same(evidence(sourcePath),original)||
        ['-wal','-shm','-journal'].some(suffix=>fs.existsSync(sourcePath+suffix)))fail('ADDITIVE_SCHEMA_SOURCE_CHANGED');
    if(!absentTarget())fail('ADDITIVE_SCHEMA_PATH_UNSAFE');
    // link is an atomic, exclusive publication in the same filesystem.
    fs.linkSync(prepared,targetPath);published=true;fs.unlinkSync(prepared);
    const fd=fs.openSync(parent,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const body={schemaRef:'operator.additive-schema-preparation@1',prepared:true,applied:false,plan,source:original,sourceProof,targetProof,
      target:evidence(targetPath),tableProofs,tableProofsDigest:canonicalDigest(tableProofs)};
    return Object.freeze({...body,receiptDigest:canonicalDigest(body)});
  }catch(error){
    if(published)error.preparedSnapshotPath=targetPath;
    throw error;
  }finally{
    if(target?.inTransaction)target.exec('ROLLBACK');target?.close();source?.close();
    if(path.dirname(work)!==parent||!path.basename(work).startsWith('.additive-schema-')||fs.realpathSync(work)!==work)
      fail('ADDITIVE_SCHEMA_CLEANUP_UNSAFE');
    fs.rmSync(work,{recursive:true,force:true});
  }
}

module.exports=Object.freeze({planAdditiveSchemaExtension,prepareAdditiveSchemaSnapshot});
