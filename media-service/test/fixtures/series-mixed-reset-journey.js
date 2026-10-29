'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

async function verifyMixedReset({db,firstEntry,firstFiles,secondSource,sharedManifest,hostOptions,apiKey}) {
  const sourcePath=db.name,targetPath=path.join(path.dirname(sourcePath),'mixed-series-retained.db');
  assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='accepted'").get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,2);
  const originals=[...firstFiles,...sharedManifest.members.map(item=>({location:item.location,bytes:fs.readFileSync(item.location)}))];
  function inspect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const location=path.join(directory,entry.name);if(entry.isDirectory())inspect(location);else if(entry.isFile())originals.push({location,bytes:fs.readFileSync(location)});else throw Error('Unexpected fixture link');}}
  inspect(secondSource);
  const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl=fs.readFileSync(path.join(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
  const owner=require('../../scripts/formation-reset-owner-snapshot').readResetOwnerSnapshot({Database,sourcePath});
  const policy=require('../../scripts/formation-reset-owner-policy').buildOwnerRetentionPolicy(schemaManifest,owner);
  const copy=require('../../scripts/formation-reset-copy').createRetainedDatabase({Database,sourcePath,targetPath,policy,targetSchema:{schemaManifest,schemaDdl}});
  require('../../scripts/formation-reset-normalize').normalizeRetainedSubjects({Database,targetPath,schemaManifest,schemaDdl,
    generationId:canonicalDigest('isolated-mixed-series-reset'),backupDigest:canonicalDigest('isolated-copy-only'),manifestDigest:copy.retainedDigest,
    seriesRetention:owner.seriesRetention,assertIsolated:value=>assert.equal(value,targetPath)});
  const verified=require('../../scripts/formation-reset-verify').verifyRetainedCollections({Database,sourcePath,targetPath,schemaManifest,schemaDdl});
  const target=new Database(targetPath,{readonly:true});
  try{
    assert.equal(verified.reconstructedCommits,1);assert.equal(verified.reconstructedPackages,1);
    assert.deepEqual(target.prepare('SELECT * FROM arca_shelf_entries').all(),[firstEntry]);
    assert.equal(target.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='accepted'").get().n,1);
    assert.equal(target.prepare('SELECT count(*) n FROM libra_subjects').get().n,1);
    assert.equal(target.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
    assert.ok(target.prepare('SELECT count(*) n FROM arca_series_presentation_versions').get().n>0);
    assert.equal(target.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(target.pragma('foreign_key_check'),[]);
  }finally{target.close();}
  for(const original of originals)assert.deepEqual(fs.readFileSync(original.location),original.bytes);
  let operator;
  if(process.env.HELIX_SERIES_MIXED_RESET_OPERATOR==='1'){
    const dataDir=path.dirname(sourcePath),root=path.dirname(dataDir),baseline=path.join(root,'mixed-original.db');
    await db.backup(baseline);db.close();
    const workspace=path.join(root,'reset-disposable-workspace');fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace,'unfinished.bin'),'unfinished output');
    const intent=path.join(dataDir,'operator-runtime','intent.json');fs.mkdirSync(path.dirname(intent),{recursive:true});
    fs.writeFileSync(intent,JSON.stringify({schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,pendingReset:null}));
    const open=()=>require('../helpers/fresh-reset-supervisor').createFreshResetTestHost(hostOptions,{
      workspaceRoots:[workspace],protectedDirectories:[secondSource]});
    let host=await open();
    async function request(method,url,payload){const response=await host.inject({method,url,headers:{'x-api-key':apiKey},payload});
      assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response.json();}
    try{
      const preview=await request('GET','/v1/admin/runtime/reset-preview');assert.equal(preview.ready,true,JSON.stringify(preview.blockers));
      await request('POST','/v1/admin/runtime/actions/reset',{idempotencyKey:'mixed-series-full-operator',previewDigest:preview.previewDigest,confirmed:true});
      const deadline=Date.now()+60000;let runtime;
      do{runtime=await request('GET','/v1/admin/runtime');if(runtime.mode==='stopped'&&runtime.operation?.state==='completed')break;
        assert.notEqual(runtime.operation?.state,'failed',JSON.stringify(runtime));await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
      assert.equal(runtime.operation?.state,'completed',JSON.stringify(runtime));assert.equal(runtime.normalSupplyAllowed,false);
      assert.deepEqual(fs.readdirSync(workspace),[]);
      for(let pass=0;pass<2;pass++){await host.close();host=await open();const state=await request('GET','/v1/admin/runtime');
        assert.equal(state.mode,'stopped');assert.equal(state.normalSupplyAllowed,false);assert.equal(state.error,null);}
    }finally{await host.close();}
    const actual=require('../../scripts/formation-reset-verify').verifyRetainedCollections({Database,sourcePath:baseline,targetPath:sourcePath,schemaManifest,schemaDdl});
    assert.equal(actual.reconstructedCommits,1);assert.equal(actual.reconstructedPackages,1);
    const current=new Database(sourcePath,{readonly:true});try{
      assert.equal(current.prepare("SELECT count(*) n FROM arca_acceptance_decisions WHERE result='accepted'").get().n,1);
      assert.equal(current.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
    }finally{current.close();}
    for(const original of originals)assert.deepEqual(fs.readFileSync(original.location),original.bytes);
    operator={completed:true,stoppedRestarts:2,privateCleanup:true,commits:actual.reconstructedCommits};
  }
  return {committedSeasons:1,removedAcceptedSeasons:1,shared:verified.shared,protectedFiles:originals.length,operator};
}
module.exports={verifyMixedReset};
