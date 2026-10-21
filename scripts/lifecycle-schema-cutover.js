'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SOURCE='33ef1d7c2f07669991a8401754f7671c92f4848db8a9c1869724bc5edf8e614c';
const TARGET='b8c36a0bfc04e7789ca1e49e2639a749c1fe90b52cb80a8a6bb8ecf9b592232b';
function assert(value,code){if(!value)throw Object.assign(new Error(code),{code});}
function regular(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&path.resolve(fs.realpathSync(file))===path.resolve(file),'CUTOVER_FILE_UNSAFE');return stat;}
async function hash(file){const before=regular(file),digest=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))digest.update(bytes);
 const after=regular(file);assert(before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'CUTOVER_FILE_CHANGED');return digest.digest('hex');}
function syncDirectory(directory){if(process.platform!=='linux')return;const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}

// The deployment wrapper must stop the sole service before invoking this offline
// operator. Both preparation and the complete cold backup remain beside data.
async function publishPreparedDatabase({Database,dataDir,preparedDir,apply=false,afterRename}){
 dataDir=path.resolve(dataDir);preparedDir=path.resolve(preparedDir);
 for(const dir of [dataDir,preparedDir])assert(path.resolve(fs.realpathSync(dir))===dir&&!fs.lstatSync(dir).isSymbolicLink(),'CUTOVER_DIRECTORY_UNSAFE');
 assert(dataDir!==preparedDir,'CUTOVER_DIRECTORY_CONFLICT');
 const target=path.join(dataDir,'shelfdeck.db'),prepared=path.join(preparedDir,'prepared.sqlite'),source=path.join(preparedDir,'source.sqlite'),markerPath=path.join(preparedDir,'cutover.json');
 const schema=file=>{const db=new Database(file,{readonly:true,fileMustExist:true});try{return db.prepare('SELECT schema_digest FROM platform_schema_marker').get()?.schema_digest;}finally{db.close();}};
 const marker=value=>{const temporary=markerPath+'.next';const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,markerPath);syncDirectory(preparedDir);};
 const receipt=JSON.parse(fs.readFileSync(path.join(preparedDir,'copy-receipt.json'))),rollback=JSON.parse(fs.readFileSync(path.join(preparedDir,'rollback-receipt.json')));
 assert(receipt.prepared===true&&receipt.applied===false&&receipt.rollback===false&&receipt.copiedTableCount===223&&receipt.tableProofs.length===223&&
   rollback.prepared===true&&rollback.rollback===true&&rollback.copiedTableCount===223,'CUTOVER_COPY_UNQUALIFIED');
 const originalHash=await hash(source),existing=fs.existsSync(markerPath)?JSON.parse(fs.readFileSync(markerPath)):null;
 assert(regular(target).dev===regular(source).dev,'CUTOVER_VOLUME_MISMATCH');
 if(existing&&await hash(target)===existing.targetHash&&schema(target)===TARGET){
   assert(existing.sourceHash===originalHash&&existing.sourceSchema===SOURCE&&existing.targetSchema===TARGET,'CUTOVER_MARKER_CONFLICT');
   if(apply)marker({...existing,state:'installed',recoveredAt:new Date().toISOString()});
   return {installed:true,recovered:apply,applied:apply,targetHash:existing.targetHash};
 }
 assert(!existing||existing.sourceHash===originalHash,'CUTOVER_MARKER_CONFLICT');
 assert(await hash(target)===originalHash&&schema(target)===SOURCE,'CUTOVER_SOURCE_DRIFT');
 assert(regular(prepared).dev===regular(target).dev&&schema(prepared)===TARGET,'CUTOVER_TARGET_INVALID');
 const targetHash=await hash(prepared);assert(!existing||existing.targetHash===targetHash,'CUTOVER_TARGET_DRIFT');
 for(const suffix of ['-wal','-journal'])if(fs.existsSync(target+suffix))assert(regular(target+suffix).size===0,'CUTOVER_NONEMPTY_JOURNAL');
 const plan={schema:'shelfdeck.lifecycle-database-cutover@1',sourceHash:originalHash,targetHash,sourceSchema:SOURCE,targetSchema:TARGET,state:'qualified',at:new Date().toISOString()};
 if(!apply)return {...plan,applied:false};
 marker(plan);
 for(const suffix of ['-wal','-shm','-journal'])if(fs.existsSync(target+suffix)){
   regular(target+suffix);const retained=path.join(preparedDir,'retained-source'+suffix);assert(!fs.existsSync(retained),'CUTOVER_RETAINED_FILE_CONFLICT');fs.renameSync(target+suffix,retained);
 }
 syncDirectory(dataDir);syncDirectory(preparedDir);
 const previous=regular(target);fs.chmodSync(prepared,previous.mode&0o777);
 if(process.platform==='linux'&&(regular(prepared).uid!==previous.uid||regular(prepared).gid!==previous.gid))fs.chownSync(prepared,previous.uid,previous.gid);
 fs.renameSync(prepared,target);syncDirectory(dataDir);syncDirectory(preparedDir);afterRename?.();
 assert(await hash(target)===targetHash&&schema(target)===TARGET,'CUTOVER_PUBLISHED_BYTES_CHANGED');
 marker({...plan,state:'installed',installedAt:new Date().toISOString()});
 return {installed:true,applied:true,targetHash,sourceRetained:true,schemaDigest:TARGET};
}
if(require.main===module){
 const args=process.argv.slice(2);if(![2,3].includes(args.length)||args.length===3&&args[2]!=='--apply')throw Error('Usage: lifecycle-schema-cutover.js <data-dir> <prepared-dir> [--apply]');
 const serviceRoot=process.env.SHELFDECK_SERVICE_ROOT||path.resolve(__dirname,'../media-service');
 const Database=require('node:module').createRequire(path.join(serviceRoot,'package.json'))('better-sqlite3');
 publishPreparedDatabase({Database,dataDir:args[0],preparedDir:args[1],apply:args[2]==='--apply'}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({code:error.code||error.message}));process.exitCode=1;});
}
module.exports={publishPreparedDatabase};
