'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultAnalysisStore}=require('../../src/helix/domains/libra/persistence/us-adult-analysis-store');

test('freezes a complete versioned US analysis Basis and all actor pages atomically with immutable replay',()=>harness(({options,basis,pages,db})=>{
  const store=createUsAdultAnalysisStore(options),created=store.freeze(basis,pages);
  assert.deepEqual(created,basis);assert.deepEqual(store.freeze(basis,pages),basis);assert.equal(Object.isFrozen(created.sourceHandle),true);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_us_adult_analysis_bases').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM libra_us_adult_reference_pages').get().n,3);
  assert.deepEqual(store.readPage(basis.analysisId,2),pages[2]);
  db.prepare("UPDATE libra_runs SET state='frozen',state_revision=2").run();
  assert.deepEqual(store.freeze(basis,pages),basis,'Snapshot replay is independent of later Run lifecycle state.');
}));
test('rolls the Basis and every reference page back when an intermediate page write is interrupted',()=>harness(({options,basis,pages,db})=>{
  const store=createUsAdultAnalysisStore({...options,afterPageInsert:({ordinal})=>{if(ordinal===1)throw new Error('fixture-page-interruption');}});
  assert.throws(()=>store.freeze(basis,pages),/fixture-page-interruption/);
  for(const table of ['libra_us_adult_analysis_bases','libra_us_adult_reference_pages'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.deepEqual(createUsAdultAnalysisStore(options).freeze(basis,pages),basis);
}));
test('rejects truncated, reordered or stale input and detects persisted page corruption',()=>harness(({options,basis,pages,db})=>{
  const store=createUsAdultAnalysisStore(options);
  assert.throws(()=>store.freeze(basis,pages.slice(0,2)),{code:'US_ADULT_ANALYSIS_BASIS_INVALID'});
  assert.throws(()=>store.freeze(basis,[pages[1],pages[0],pages[2]]),{code:'US_ADULT_ANALYSIS_BASIS_INVALID'});
  db.prepare('UPDATE libra_runs SET state_revision=2').run();assert.throws(()=>store.freeze(basis,pages),{code:'US_ADULT_ANALYSIS_BASIS_STALE'});
  db.prepare('UPDATE libra_runs SET state_revision=1').run();store.freeze(basis,pages);
  const altered=structuredClone(pages[0]);altered.items[0].canonicalName='Changed';
  db.prepare('UPDATE libra_us_adult_reference_pages SET page_json=? WHERE page_ordinal=0').run(canonicalJson(altered));
  assert.throws(()=>store.readPage(basis.analysisId,0),{code:'US_ADULT_ANALYSIS_PAGE_CORRUPT'});
}));
