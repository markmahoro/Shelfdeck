'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {compileSchema}=require('../../src/helix/foundation/persistence/ddl-compiler');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {readFrozenTableContracts}=require('../../scripts/helix-architecture/p3-ddl-materializer');
const {planAdditiveSchemaExtension,prepareAdditiveSchemaSnapshot}=require('../../scripts/additive-schema-snapshot');
const addedTables=['arca_offer_withdrawal_receipts','libra_custom_target_heads','libra_custom_target_intents','libra_custom_target_previews'],
  contracts=readFrozenTableContracts(path.resolve(__dirname,'../../src/helix/contracts')),
  before=compileSchema(contracts.filter(row=>!addedTables.includes(row.tableId))),after=compileSchema(contracts),
  sourceSchema={schemaDdl:before.ddl,schemaManifest:before.manifest},targetSchema={schemaDdl:after.ddl,schemaManifest:after.manifest},
  extension={schemaRef:'operator.additive-table-extension@1',sourceDdlDigest:before.manifest.ddlDigest,targetDdlDigest:after.manifest.ddlDigest,addedTables};
const linux={skip:process.platform!=='linux'?'Linux Docker snapshot qualification required.':false};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'additive-schema-test-')),sourcePath=path.join(root,'source.sqlite'),targetPath=path.join(root,'target.sqlite');
  try{
    const kernel=openSqliteKernel({Database,databasePath:sourcePath,...sourceSchema});
    kernel.runPrimitive(({prepare})=>prepare('INSERT INTO fx_audit_records(audit_id,owner_domain,actor_type,actor_id,action,scope_type,scope_id,occurred_at_ms) VALUES(?,?,?,?,?,?,?,?)')
      .run('original-audit','libra','admin','001-原始用户','original.action','subject','original-subject',1700000000000));kernel.close();
    return callback({root,sourcePath,targetPath,originalHash:hash(sourcePath),prepare:overrides=>prepareAdditiveSchemaSnapshot({Database,sourcePath,targetPath,sourceSchema,targetSchema,extension,...overrides})});
  }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('additive-schema-test-'));fs.rmSync(root,{recursive:true,force:true});}
}

test('additive snapshot plan accepts only exact new tables and unchanged original definitions',()=>{
  const input={sourceSchema,targetSchema,extension,sourceBytes:1048576},plan=planAdditiveSchemaExtension(input);
  assert.equal(plan.sourceTableCount,239);assert.equal(plan.targetTableCount,243);assert.deepEqual(plan.addedTables,addedTables);
  assert.equal(plan.requiredAvailableBytes,String(536870912+3*1048576));
  const changed=structuredClone(targetSchema);changed.schemaManifest.tables.find(row=>row.tableId==='fx_audit_records').sqlDigest='0'.repeat(64);
  assert.throws(()=>planAdditiveSchemaExtension({...input,targetSchema:changed}),{code:'ADDITIVE_SCHEMA_EXISTING_DEFINITION_CHANGED'});
  for(const value of [{...extension,addedTables:addedTables.slice(1)},{...extension,addedTables:[...addedTables,addedTables[0]]},
    {...extension,sourceDdlDigest:'0'.repeat(64)}])assert.throws(()=>planAdditiveSchemaExtension({...input,extension:value}));
});

test('Linux prepares all old rows, verifies the complete new database and leaves the source byte-identical',linux,()=>fixture(h=>{
  const receipt=h.prepare();assert.equal(receipt.prepared,true);assert.equal(receipt.applied,false);assert.equal(receipt.tableProofs.length,238);
  assert.equal(hash(h.sourcePath),h.originalHash);assert.equal(receipt.target.sha256,hash(h.targetPath));
  assert.equal(fs.existsSync(h.sourcePath+'-wal'),false);assert.equal(fs.existsSync(h.sourcePath+'-shm'),false);
  assert.deepEqual(fs.readdirSync(h.root).sort(),['source.sqlite','target.sqlite']);
  const checked=openSqliteKernel({Database,databasePath:h.targetPath,...targetSchema});assert.equal(checked.generation.tableCount,243);checked.close();
  const db=new Database(h.targetPath,{readonly:true});try{
    const audit=db.prepare('SELECT actor_id,action,occurred_at_ms FROM fx_audit_records').get();
    assert.deepEqual(audit,{actor_id:'001-原始用户',action:'original.action',occurred_at_ms:1700000000000});
    for(const table of addedTables)assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db.close();}
}));

test('Linux refuses existing output, source aliases and live sidecars without modifying the snapshot',linux,()=>fixture(h=>{
  fs.writeFileSync(h.targetPath,'existing');assert.throws(()=>h.prepare(),{code:'ADDITIVE_SCHEMA_PATH_UNSAFE'});assert.equal(fs.readFileSync(h.targetPath,'utf8'),'existing');fs.unlinkSync(h.targetPath);
  fs.writeFileSync(h.sourcePath+'-wal','pending');assert.throws(()=>h.prepare(),{code:'ADDITIVE_SCHEMA_PATH_UNSAFE'});fs.unlinkSync(h.sourcePath+'-wal');
  const alias=path.join(h.root,'alias.sqlite');fs.linkSync(h.sourcePath,alias);assert.throws(()=>h.prepare(),{code:'ADDITIVE_SCHEMA_SOURCE_UNSAFE'});fs.unlinkSync(alias);
  assert.equal(hash(h.sourcePath),h.originalHash);assert.equal(fs.existsSync(h.targetPath),false);
}));

test('Linux capacity rejection and copy interruption leave no published database or temporary artifacts',linux,()=>fixture(h=>{
  const statfs=fs.statfsSync;try{fs.statfsSync=()=>({bavail:0n,bsize:4096n});assert.throws(()=>h.prepare(),{code:'ADDITIVE_SCHEMA_CAPACITY_INSUFFICIENT'});}finally{fs.statfsSync=statfs;}
  function InterruptedDatabase(file,options){const db=new Database(file,options);if(file.endsWith('/target.sqlite')){
    const prepare=db.prepare.bind(db);db.prepare=sql=>{if(sql.startsWith('INSERT INTO "fx_audit_records"'))throw new Error('injected copy interruption');return prepare(sql);};}return db;}
  assert.throws(()=>h.prepare({Database:InterruptedDatabase}),/injected copy interruption/);
  assert.equal(hash(h.sourcePath),h.originalHash);assert.equal(fs.existsSync(h.targetPath),false);
  assert.deepEqual(fs.readdirSync(h.root),['source.sqlite']);
}));
