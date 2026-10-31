'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {createGeneration,MEMBER_NAMES}=require('../../src/helix/contracts/face-catalogue-generation');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {UNAVAILABLE,DEFAULT_BUFFALO_MODEL_ROOT,resolveCatalogueHostConfiguration,assertCatalogueConfigured}=
  require('../../src/helix/domains/libra/application/us-adult-catalogue-host-config');
const {createUsAdultProductCoordinator}=require('../../src/helix/domains/libra/application/us-adult-product-coordinator');
const {createUsAdultCataloguePortFactories}=require('../../src/clean-us-adult-catalogue-ports');

function generation(){
  return createGeneration({datasetVersion:'host-wiring',manifestDigest:D('manifest'),
    members:MEMBER_NAMES.map(name=>({name,bytes:8,sha256:D(name)}))});
}

test('Host catalogue config is absent when no catalogue data options are provided',()=>{
  assert.equal(resolveCatalogueHostConfiguration({}),null);
  assert.equal(resolveCatalogueHostConfiguration({catalogueRoot:null,buffaloModelRoot:null}),null);
});

test('image-baked buffalo alone does not enable catalogue without installed product data',()=>{
  const buffalo=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-buffalo-default-'));
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-data-empty-'));
  try{
    assert.equal(resolveCatalogueHostConfiguration({defaultBuffaloModelRoot:buffalo}),null);
    assert.equal(resolveCatalogueHostConfiguration({defaultBuffaloModelRoot:buffalo,dataDir}),null);
  }finally{
    fs.rmSync(buffalo,{recursive:true,force:true});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});

test('Host resolves installed catalogue under ShelfDeck data without explicit env',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-catalogue-builtin-'));
  const dataDir=path.join(root,'data'),catalogueRoot=path.join(dataDir,'us-adult-catalogue'),bakedBuffalo=path.join(root,'baked');
  fs.mkdirSync(catalogueRoot,{recursive:true});fs.mkdirSync(bakedBuffalo);
  const gen=generation();
  fs.writeFileSync(path.join(catalogueRoot,'generation.json'),JSON.stringify(gen));
  fs.writeFileSync(path.join(catalogueRoot,'performers.db'),'x');
  try{
    const resolved=resolveCatalogueHostConfiguration({
      dataDir,buffaloModelRoot:null,defaultBuffaloModelRoot:bakedBuffalo});
    assert.equal(resolved.catalogueRoot,path.resolve(catalogueRoot));
    assert.equal(resolved.installedUnderData,true);
    assert.equal(resolved.catalogueConfiguration.catalogueGeneration.generationDigest,gen.generationDigest);
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('partial catalogue options fail closed instead of silent degrade',()=>{
  assert.throws(()=>resolveCatalogueHostConfiguration({catalogueRoot:'/tmp/missing-catalogue'}),
    {code:UNAVAILABLE});
  assert.throws(()=>resolveCatalogueHostConfiguration({buffaloModelRoot:'/tmp/missing-buffalo'}),
    {code:UNAVAILABLE});
});

test('explicit catalogueRoot uses image-baked buffalo by default; env override still wins',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-catalogue-host-'));
  const catalogueRoot=path.join(root,'catalogue'),bakedBuffalo=path.join(root,'baked'),overrideBuffalo=path.join(root,'override');
  fs.mkdirSync(catalogueRoot);fs.mkdirSync(bakedBuffalo);fs.mkdirSync(overrideBuffalo);
  try{
    assert.throws(()=>resolveCatalogueHostConfiguration({
      catalogueRoot,buffaloModelRoot:null,defaultBuffaloModelRoot:bakedBuffalo}),{code:UNAVAILABLE});
    const resolved=resolveCatalogueHostConfiguration({
      catalogueRoot,buffaloModelRoot:null,defaultBuffaloModelRoot:bakedBuffalo,catalogueGeneration:generation()});
    assert.equal(resolved.catalogueRoot,path.resolve(catalogueRoot));
    assert.equal(resolved.buffaloModelRoot,path.resolve(bakedBuffalo));
    assert.equal(resolved.installedUnderData,false);
    const overridden=resolveCatalogueHostConfiguration({
      catalogueRoot,buffaloModelRoot:overrideBuffalo,defaultBuffaloModelRoot:bakedBuffalo,catalogueGeneration:generation()});
    assert.equal(overridden.buffaloModelRoot,path.resolve(overrideBuffalo));
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

test('Dockerfile bakes buffalo_l and Host defaults to resources/buffalo-models',()=>{
  const docker=fs.readFileSync(path.resolve(__dirname,'../../Dockerfile'),'utf8');
  const install=fs.readFileSync(path.resolve(__dirname,'../../scripts/install-buffalo-models.js'),'utf8');
  assert.match(docker,/install-buffalo-models\.js/);
  assert.match(docker,/resources\/buffalo-models/);
  assert.match(install,/det_10g\.onnx/);
  assert.match(install,/w600k_r50\.onnx/);
  assert.ok(DEFAULT_BUFFALO_MODEL_ROOT.endsWith(path.join('resources','buffalo-models')));
  assert.ok(fs.existsSync(path.join(path.dirname(DEFAULT_BUFFALO_MODEL_ROOT),'NOTICE'))||
    fs.existsSync(path.join(DEFAULT_BUFFALO_MODEL_ROOT,'NOTICE')));
});

test('People image execution exposes catalogue registration admission and peopleStore for Host inject',()=>{
  const {createPeopleImageExecutionRegistration}=require('../../src/helix/domains/people/public/image-execution-registration');
  const src=fs.readFileSync(path.resolve(__dirname,'../../src/helix/composition/create-procurement-execution-runtime.js'),'utf8');
  assert.match(src,/registerCataloguePerson/);
  assert.match(src,/ensureCatalogueReferenceFeatures/);
  assert.match(src,/createCatalogueRegistrationAdmission/);
  assert.match(src,/peopleStore:peopleImageExecution\.peopleStore/);
  assert.equal(typeof createPeopleImageExecutionRegistration,'function');
});

test('Clean Host wires provider observation and buffalo People preparation for catalogue ensure',()=>{
  const host=fs.readFileSync(path.resolve(__dirname,'../../src/clean-service-host.js'),'utf8');
  assert.match(host,/createCatalogueProviderObservationPort/);
  assert.match(host,/observeUsAdultCatalogueProviderSearch/);
  assert.match(host,/readCatalogueRegistrationImageBytes/);
  assert.match(host,/createBuffaloPeopleReferencePreparation/);
  assert.match(host,/buffaloPreparation/);
  assert.match(host,/hasOpenPeopleCatalogueImagePrep/);
  // Observation must use platformIntegrations.networkFetch / stashbox adapter, not
  // out-of-scope locals from createPlatformIntegrationServices.
  assert.match(host,/platformIntegrations\.networkFetch/);
  assert.match(host,/providerAdapters\.get\('stashbox'\)/);
  assert.doesNotMatch(host,/createCatalogueProviderObservationPort\(\{[\s\S]*fetchImpl:networkFetch/);
});

test('missing catalogue frame proof fails closed and workless settlement does not call terminalWork',()=>{
  const refresh=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/people/application/us-adult-catalogue-buffalo-refresh.js'),'utf8');
  const evidence=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/people/application/us-adult-catalogue-registration-evidence.js'),'utf8');
  const coordinator=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/libra/application/libra-run-coordinator.js'),'utf8');
  assert.match(refresh,/PEOPLE_CATALOGUE_FRAME_PROOF_UNWIRED/);
  assert.match(evidence,/PEOPLE_CATALOGUE_FRAME_PROOF_UNWIRED/);
  assert.doesNotMatch(refresh,/buildFrameImageProof!=='function'\)return pendingResult\(\{pendingCode:'PEOPLE_CATALOGUE_FRAME_PROOF_PENDING'\}/);
  assert.match(coordinator,/closeUsAdultProductStage/);
  assert.match(coordinator,/if\(usAdultStage\.kind==='failed'\)return closeUsAdultProductStage/);
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
