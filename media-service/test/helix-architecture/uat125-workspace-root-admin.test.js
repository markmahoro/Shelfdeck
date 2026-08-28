'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createLocationRegistryRepository}=require('../../src/helix/platform/persistence/location-registry-repository');
const {createLocalFilesystemMountScopeResolver}=require('../../src/helix/platform/application/local-filesystem-mount-scope-resolver');
const {createCleanLocalFilesystemMountProbe}=require('../../src/clean-local-filesystem-mount-probe');
const {createCleanWorkspaceProductPort}=require('../../src/clean-workspace-product-port');
const {createCleanWorkspaceRootAdmin}=require('../../src/clean-workspace-root-admin');

const generatedRoot=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));

test('Production Workspace custom root is probed, staged, and becomes effective only after restart',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'uat125-workspace-root-'));
  const current=path.join(root,'current'),next=path.join(root,'next'),aftercare=path.join(root,'aftercare');
  fs.mkdirSync(aftercare,{recursive:true});
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'shelfdeck.db'),schemaDdl,schemaManifest,now:()=>1_700_100_000_000});
  const unitOfWork=createSqliteUnitOfWork({kernel});
  const port=createCleanWorkspaceProductPort({schemaManifest,unitOfWork,rootPath:current,now:()=>1_700_100_000_000});
  port.rootSnapshot();
  fs.mkdirSync(path.join(current,'unknown-workspace'),{recursive:true});
  fs.writeFileSync(path.join(current,'unknown-workspace','unknown.bin'),'not admitted');
  assert.throws(()=>port.reclaimEmptyWorkspace('unknown-workspace'),
    (error)=>error.code==='CLEAN_WORKSPACE_RECLAIM_UNKNOWN_MEMBER');
  assert.equal(fs.existsSync(path.join(current,'unknown-workspace','unknown.bin')),true);
  fs.mkdirSync(path.join(current,'empty-workspace','nested'),{recursive:true});
  assert.equal(port.reclaimEmptyWorkspace('empty-workspace').removed,true);
  assert.equal(fs.existsSync(path.join(current,'empty-workspace')),false);
  fs.writeFileSync(path.join(current,'keep-me.txt'),'old root remains user-owned');
  const locationRegistryRepository=createLocationRegistryRepository({schemaManifest,unitOfWork});
  const mountScopeResolver=createLocalFilesystemMountScopeResolver({repository:locationRegistryRepository,
    inspectRoot:(location)=>createCleanLocalFilesystemMountProbe().inspectRoot(location),now:()=>1_700_100_000_100});
  const admin=createCleanWorkspaceRootAdmin({schemaManifest,unitOfWork,locationRegistryRepository,mountScopeResolver,
    effectiveRootPath:current,reservedRoots:()=>[{kind:'aftercare-workspace',rootId:'aftercare',resolvedRoot:aftercare,revision:1}],
    now:()=>1_700_100_000_200});
  try{
    assert.equal(admin.get().restartRequired,false);
    assert.throws(()=>admin.probe({rootPath:'relative-workspace'}),(error)=>error.code==='P5_PATH_ABSOLUTE_REQUIRED');
    assert.throws(()=>admin.probe({rootPath:path.join(aftercare,'child')}),(error)=>error.code==='P5_WORKSPACE_ROOT_RESERVED_OVERLAP');
    const realTarget=path.join(root,'real-target'),linkedTarget=path.join(root,'linked-target');
    fs.mkdirSync(realTarget,{recursive:true});
    fs.symlinkSync(realTarget,linkedTarget,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>admin.probe({rootPath:linkedTarget}),(error)=>error.code==='CLEAN_WORKSPACE_ROOT_REALPATH_CHANGED');
    const probed=admin.probe({rootPath:next});
    assert.equal(probed.validation,'passed');
    const database=new Database(path.join(root,'shelfdeck.db'));
    database.pragma('foreign_keys = OFF');
    database.prepare("INSERT INTO libra_workspaces (workspace_id,state) VALUES ('active-workspace','active')").run();
    database.close();
    assert.throws(()=>admin.configure({rootPath:next,expectedConfigRevision:1}),
      (error)=>error.code==='CLEAN_WORKSPACE_ROOT_SWITCH_BUSY');
    const cleanupDatabase=new Database(path.join(root,'shelfdeck.db'));
    cleanupDatabase.prepare("DELETE FROM libra_workspaces WHERE workspace_id='active-workspace'").run();
    cleanupDatabase.close();
    const staged=admin.configure({rootPath:next,expectedConfigRevision:1});
    assert.equal(staged.restartRequired,true);
    assert.equal(staged.current.rootPath,path.resolve(current));
    assert.equal(staged.pending.rootPath,path.resolve(next));
    assert.deepEqual(admin.configure({rootPath:next,expectedConfigRevision:1}),staged);
    assert.equal(fs.readFileSync(path.join(current,'keep-me.txt'),'utf8'),'old root remains user-owned');
    assert.throws(()=>port.rootSnapshot(),(error)=>{
      assert.equal(error.code,'CLEAN_WORKSPACE_ROOT_CONFLICT');
      assert.equal(error.details.configuredRoot,path.resolve(current));
      assert.equal(error.details.durableRoot,path.resolve(next));
      return true;
    });
    const restarted=createCleanWorkspaceProductPort({schemaManifest,unitOfWork,rootPath:next,now:()=>1_700_100_000_300});
    assert.equal(restarted.rootSnapshot().configRevision,2);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
