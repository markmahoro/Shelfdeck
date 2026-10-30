'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {createGeneration,MEMBER_NAMES}=require('../../src/helix/contracts/face-catalogue-generation');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {UNAVAILABLE,resolveCatalogueHostConfiguration,assertCatalogueConfigured}=
  require('../../src/helix/domains/libra/application/us-adult-catalogue-host-config');
const {createUsAdultProductCoordinator}=require('../../src/helix/domains/libra/application/us-adult-product-coordinator');
const {createUsAdultCataloguePortFactories}=require('../../src/clean-us-adult-catalogue-ports');

function generation(){
  return createGeneration({datasetVersion:'host-wiring',manifestDigest:D('manifest'),
    members:MEMBER_NAMES.map(name=>({name,bytes:8,sha256:D(name)}))});
}

test('Host catalogue config is absent when no catalogue options are provided',()=>{
  assert.equal(resolveCatalogueHostConfiguration({}),null);
  assert.equal(resolveCatalogueHostConfiguration({catalogueRoot:null,buffaloModelRoot:null}),null);
});

test('partial catalogue options fail closed instead of silent degrade',()=>{
  assert.throws(()=>resolveCatalogueHostConfiguration({catalogueRoot:'/tmp/missing-catalogue'}),
    {code:UNAVAILABLE});
  assert.throws(()=>resolveCatalogueHostConfiguration({buffaloModelRoot:'/tmp/missing-buffalo'}),
    {code:UNAVAILABLE});
});

test('configured catalogue roots require existing directories and a generation',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-catalogue-host-'));
  const catalogueRoot=path.join(root,'catalogue'),buffaloModelRoot=path.join(root,'buffalo');
  fs.mkdirSync(catalogueRoot);fs.mkdirSync(buffaloModelRoot);
  try{
    assert.throws(()=>resolveCatalogueHostConfiguration({catalogueRoot,buffaloModelRoot}),{code:UNAVAILABLE});
    const resolved=resolveCatalogueHostConfiguration({catalogueRoot,buffaloModelRoot,catalogueGeneration:generation()});
    assert.equal(resolved.catalogueRoot,path.resolve(catalogueRoot));
    assert.equal(resolved.buffaloModelRoot,path.resolve(buffaloModelRoot));
    assert.equal(resolved.catalogueConfiguration.catalogueGeneration.datasetId,'stash-sense2-data');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('Host-wired product reconcile fails closed when catalogueRoot is unavailable',()=>{
  const ports=createUsAdultCataloguePortFactories({catalogueHost:null});
  assert.throws(()=>ports.createCatalogueObservationPort({}),{code:UNAVAILABLE});
  assert.throws(()=>ports.createCatalogueFramePort({}),{code:UNAVAILABLE});
  const coordinator=createUsAdultProductCoordinator({
    createCatalogueObservationPort:ports.createCatalogueObservationPort,
    createCatalogueFramePort:ports.createCatalogueFramePort,
    catalogueConfiguration:null,
    usAdultCatalogueStore:{},
    usAdultActorChoiceStore:{current(){return null;}},
    usAdultCatalogueDecisionStore:{getByRun(){return null;}},
    usAdultAnalysisStore:{getByRun(){return null;}},
    usAdultMatchCompletionStore:{getByRun(){return null;}},
    movieProductionReader:{},
    workResultReader:{},
    submit(){return {replayed:false};},
    peopleReferenceQuery:{readUsAdultReferencePage(){return {items:[],nextCursor:null};}},
  });
  assert.throws(()=>coordinator.reconcile(
    {run:{libraRunId:'run',subjectId:'subject',state:'active',executionBasisDigest:D('basis')},spec:{contentProfile:'western_adult'}},
    {factValue:{contentProfile:'western_adult',subjectId:'subject',identityDigest:D('identity')}},
    {libraRunId:'run',state:'active',workspaceId:'workspace'}),
  {code:UNAVAILABLE});
});

test('assertCatalogueConfigured rejects Host ports without configuration',()=>{
  assert.throws(()=>assertCatalogueConfigured({
    createCatalogueFramePort(){},createCatalogueObservationPort(){},usAdultCatalogueStore:{},
  }),{code:UNAVAILABLE});
});

test('LIBRA_ENABLED includes catalogue observe for Host registration',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/composition/create-procurement-execution-runtime.js'),'utf8');
  assert.match(source,/libra\.us_adult\.catalogue\.observe@1/);
  assert.match(source,/capability==='libra\.us_adult\.catalogue\.observe@1'/);
});

test('Clean Host and Libra public wire catalogue stores and ports',()=>{
  const host=fs.readFileSync(path.resolve(__dirname,'../../src/clean-service-host.js'),'utf8');
  const pub=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/public/index.js'),'utf8');
  assert.match(host,/createCatalogueObservationPort/);
  assert.match(host,/catalogueConfiguration/);
  assert.match(pub,/createUsAdultCatalogueStore/);
  assert.match(pub,/createUsAdultCatalogueDecisionStore/);
  assert.match(pub,/libra\.us_adult\.catalogue\.observe@1/);
  assert.match(pub,/createUsAdultAnalysisDispatchPlanner/);
});
