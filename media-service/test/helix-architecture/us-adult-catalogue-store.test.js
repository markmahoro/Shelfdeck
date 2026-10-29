'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{Worker}=require('node:worker_threads');
const {fixture}=require('./fixtures/us-adult-catalogue-store');
const {createUsAdultCatalogueStore}=require('../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildCatalogueAnalysisBasis}=require('../../src/helix/domains/libra/model/us-adult-catalogue-analysis-basis');
async function race(databasePath,bases){
  const barrier=new SharedArrayBuffer(4),workers=[],jobs=[];
  try{
    for(const basis of bases){
      const worker=new Worker(path.join(__dirname,'fixtures/catalogue-store-writer.js'),{workerData:{protocol:'catalogue-store-writer-test@1',databasePath,basis,barrier}});
      workers.push(worker);let readyResolve,readyReject,resultResolve,resultReject,finished=false;
      const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),result=new Promise((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
      result.catch(()=>{});
      worker.on('message',message=>{if(message.kind==='ready')readyResolve();else if(message.kind==='result'){finished=true;readyResolve();resultResolve(message);}});
      worker.on('error',error=>{readyReject(error);resultReject(error);});
      worker.on('exit',()=>{if(!finished){const error=Error('Concurrent writer exited without a result.');readyReject(error);resultReject(error);}});
      jobs.push({ready,result});
    }
    await Promise.all(jobs.map(job=>job.ready));Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,workers.length);
    return await Promise.all(jobs.map(job=>job.result));
  }finally{await Promise.all(workers.map(worker=>worker.terminate()));}
}
test('catalogue Basis is immutable, exact, independent of People pages and durably replayable',t=>{
  const f=fixture(t),store=createUsAdultCatalogueStore(f.options),value=store.freeze(f.basis);
  assert.deepEqual(value,f.basis);assert.deepEqual(store.getByRun('run'),f.basis);assert.deepEqual(store.get(f.basis.analysisId),f.basis);
  assert.equal(Object.isFrozen(value.sourceHandle.identity),true);assert.deepEqual(store.freeze(f.basis),value);
  assert.equal(f.db.prepare('SELECT count(*) n FROM libra_us_adult_catalogue_bases').get().n,1);
  for(const table of ['libra_us_adult_analysis_bases','libra_us_adult_reference_pages','people_persons','fx_supporting_works','fx_effect_journal','fx_outbox'])
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.deepEqual(f.db.pragma('foreign_key_check'),[]);assert.equal(f.db.pragma('integrity_check',{simple:true}),'ok');
  const args={...f.args,clusterThreshold:0.5};assert.throws(()=>store.freeze(buildCatalogueAnalysisBasis(args)),{code:'US_ADULT_CATALOGUE_BASIS_CONFLICT'});
});
test('catalogue Basis insert failure leaves no partial snapshot and a later retry freezes the same value',t=>{
  const f=fixture(t),store=createUsAdultCatalogueStore({...f.options,afterBasisInsert(){throw Error('injected-interruption');}});
  assert.throws(()=>store.freeze(f.basis),/injected-interruption/);assert.equal(store.getByRun('run'),null);
  assert.deepEqual(createUsAdultCatalogueStore(f.options).freeze(f.basis),f.basis);
});
test('initial freeze requires the exact active Run revision, immutable execution basis, identity and active same-Run Workspace',t=>{
  for(const sql of ["UPDATE libra_runs SET state='frozen'","UPDATE libra_runs SET state_revision=3",
    "UPDATE libra_runs SET execution_basis_digest='"+D('other')+"'","UPDATE libra_workspaces SET state='reclaiming'",
    "UPDATE libra_product_fact_revisions SET result_digest='"+D('other')+"'"]){
    const f=fixture(t);f.db.exec(sql);const store=createUsAdultCatalogueStore(f.options);
    assert.throws(()=>store.freeze(f.basis),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});assert.equal(store.getByRun('run'),null);
  }
});
test('immutable history replay never grants execution after cancellation or replacement',t=>{
  const f=fixture(t),store=createUsAdultCatalogueStore(f.options);store.freeze(f.basis);
  const request={libraRunId:'run',expectedBasisDigest:f.basis.basisDigest};assert.deepEqual(store.readForExecution(request),f.basis);
  f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");
  assert.deepEqual(store.getByRun('run'),f.basis);assert.deepEqual(store.freeze(f.basis),f.basis);
  assert.throws(()=>store.readForExecution(request),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
});
test('priority-only revision advancement keeps frozen analysis while stale digests and Workspace withdrawal block execution',t=>{
  const f=fixture(t),store=createUsAdultCatalogueStore(f.options);store.freeze(f.basis);
  const request={libraRunId:'run',expectedBasisDigest:f.basis.basisDigest};f.db.exec("UPDATE libra_runs SET state_revision=3,priority_class='expedited'");
  assert.deepEqual(store.readForExecution(request),f.basis);
  assert.throws(()=>store.readForExecution({...request,expectedBasisDigest:D('stale')}),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
  f.db.exec("UPDATE libra_workspaces SET state='reclaimed'");assert.throws(()=>store.readForExecution(request),{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
});
test('stored headers, canonical JSON, data generation and 32KiB database bounds cannot drift',t=>{
  for(const corrupt of [f=>f.db.prepare('UPDATE libra_us_adult_catalogue_bases SET basis_digest=?').run(D('wrong')),
    f=>f.db.prepare('UPDATE libra_us_adult_catalogue_bases SET basis_json=?').run(' '+canonicalJson(f.basis)),
    f=>{const value=structuredClone(f.basis);value.catalogueGeneration.members[0].sha256=D('wrong');f.db.prepare('UPDATE libra_us_adult_catalogue_bases SET basis_json=?').run(canonicalJson(value));}]){
    const f=fixture(t),store=createUsAdultCatalogueStore(f.options);store.freeze(f.basis);corrupt(f);
    assert.throws(()=>store.getByRun('run'),{code:'US_ADULT_CATALOGUE_BASIS_CORRUPT'});
  }
  const f=fixture(t);createUsAdultCatalogueStore(f.options).freeze(f.basis);
  assert.throws(()=>f.db.prepare('UPDATE libra_us_adult_catalogue_bases SET basis_json=?').run(JSON.stringify({oversized:'x'.repeat(33000)})),/CHECK constraint failed/);
  assert.throws(()=>f.db.exec('INSERT INTO libra_us_adult_catalogue_bases SELECT analysis_id||\'-other\',libra_run_id,subject_id,workspace_id,basis_schema_ref,basis_json,basis_digest,created_at_ms FROM libra_us_adult_catalogue_bases'),/UNIQUE constraint failed/);
});
test('independent SQLite writers converge for identical bases and reject competing immutable bases',{timeout:20000},async t=>{
  const f=fixture(t),same=await race(f.databasePath,[f.basis,f.basis]);assert.deepEqual(same.map(x=>x.status),['fulfilled','fulfilled']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM libra_us_adult_catalogue_bases').get().n,1);
  const other=fixture(t),different=buildCatalogueAnalysisBasis({...other.args,clusterThreshold:0.5}),results=await race(other.databasePath,[other.basis,different]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.code==='US_ADULT_CATALOGUE_BASIS_CONFLICT').length,1);
  assert.equal(other.db.prepare('SELECT count(*) n FROM libra_us_adult_catalogue_bases').get().n,1);assert.deepEqual(other.db.pragma('foreign_key_check'),[]);
});
