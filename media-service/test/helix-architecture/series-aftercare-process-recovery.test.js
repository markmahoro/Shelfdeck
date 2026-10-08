'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
function child(args,env,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
    const processHandle=spawn(process.execPath,args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    processHandle.stdout.on('data',chunk=>{stdout+=chunk;});processHandle.stderr.on('data',chunk=>{stderr+=chunk;});
    const timer=setTimeout(()=>{timedOut=true;processHandle.kill();},timeoutMs);
    processHandle.on('error',error=>{clearTimeout(timer);reject(error);});
    processHandle.on('close',status=>{clearTimeout(timer);if(timedOut)reject(new Error('Aftercare child timed out: '+stderr));else resolve({status,stdout,stderr});});
  });
}
function summary(stdout) {
  const prefix='SERIES_AFTERCARE_RESTART_RESULT=';
  const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith(prefix));
  assert.equal(lines.length,1,stdout);return JSON.parse(lines[0].slice(prefix.length));
}
test('Series N:M Aftercare resumes in a new Host after materialization and before Inventory Commit',{
  skip:process.env.HELIX_SERIES_AFTERCARE_RESTART!=='1'?'Set HELIX_SERIES_AFTERCARE_RESTART=1 for the isolated process-recovery Host':false,timeout:480000,
},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-routing-'));
  try {
    const seeded=await child(['--test-name-pattern=with real N:M media Aftercare$',path.join(__dirname,'series-routing-run.test.js')],
      {HELIX_SERIES_MEDIA_REPAIR:'1',HELIX_SERIES_AFTERCARE_CRASH_ROOT:root},180000);
    assert.equal(seeded.status,73,seeded.stdout+seeded.stderr);
    const boundary=JSON.parse(fs.readFileSync(path.join(root,'aftercare-crash-boundary.json'),'utf8'));
    assert.equal(boundary.commits,0);assert.ok(Number.isSafeInteger(boundary.entry.current_inventory_revision)&&boundary.entry.current_inventory_revision>0);
    assert.equal(boundary.receipts.length,2);
    assert.notEqual(boundary.care.state,'resolved');
    const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const expectedFiles=boundary.receipts.map(receipt=>({receipt,hash:hash(receipt.targetLocation)}));
    const untouched=boundary.materials.filter(item=>item.role!=='primary_payload').map(item=>({item,hash:hash(item.location)}));
    const sentinel=path.join(root,'shelf','outside-aftercare.keep');fs.writeFileSync(sentinel,'outside the Series Case');
    const worker=path.resolve(__dirname,'../fixtures/series-aftercare-restart-worker.js');
    const recovered=await child([worker,root],{},150000);assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
    const result=summary(recovered.stdout);
    assert.equal(result.entryId,boundary.entry.shelf_entry_id);assert.equal(result.entryStatus,'active');
    assert.equal(result.inventoryRevision,boundary.entry.current_inventory_revision+1);assert.equal(result.caseState,'resolved');assert.equal(result.commits.length,1);
    assert.deepEqual(result.receipts,[...boundary.receipts].sort((a,b)=>a.receiptId.localeCompare(b.receiptId)));
    assert.equal(result.materials.length,boundary.materials.length);
    for(const {receipt,hash:expectedHash} of expectedFiles){
      const material=result.materials.find(item=>item.material_key===receipt.finalMaterialIdentity.materialKey);
      assert.ok(material);assert.equal(hash(material.location),expectedHash);
      const original=boundary.materials.find(item=>receipt.retiredMaterials.some(retired=>retired.identity.materialKey===item.material_key));
      assert.ok(original);assert.equal(material.episode_claims_json,original.episode_claims_json);
      assert.equal(fs.existsSync(receipt.supersededLocation),false);
    }
    for(const {item,hash:expectedHash} of untouched){assert.equal(hash(item.location),expectedHash);assert.ok(result.materials.some(material=>material.material_key===item.material_key));}
    assert.deepEqual(result.foreignKeys,[]);assert.equal(result.integrity,'ok');
    const repeated=await child([worker,root],{},150000);assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
    assert.deepEqual(summary(repeated.stdout),result);
    assert.equal(fs.readFileSync(sentinel,'utf8'),'outside the Series Case');
  } finally {
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-series-routing-'));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
