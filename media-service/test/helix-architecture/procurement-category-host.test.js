'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
test('Procurement Host conserves 1081 category videos across complete Season groups and bounded Runs',{timeout:900000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-procurement-category-')),source=path.join(root,'source'),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),
    secretRoot='disposable-category-host-secret-01234567890123456789',files=[];
  fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  for(let ordinal=0;ordinal<1081;ordinal++){
    const show=Math.floor(ordinal/50),local=ordinal%50,season=Math.floor(local/20)+1,episode=local%20+1,
      parent=path.join(source,'4star','Show '+String(show).padStart(2,'0'),'Season '+String(season).padStart(2,'0'),'Disc '+(episode%2+1));
    fs.mkdirSync(parent,{recursive:true});const file=path.join(parent,'Show '+String(show).padStart(2,'0')+'.S'+String(season).padStart(2,'0')+'E'+String(episode).padStart(2,'0')+'.mkv');
    fs.writeFileSync(file,'fixture-'+ordinal);files.push(file);
  }
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});let runtimeError;
  const host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,onExecutionRuntimeError:error=>{runtimeError=error;},mediaProbe:{async probe(readHandle){
    const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};
    return {...body,payloadDigest:canonicalDigest(body)};
  }}}),db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  try{
    const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}}),cookie=login.headers['set-cookie'];
    async function request(method,url,payload){const response=await host.inject({method,url,headers:{cookie},payload});assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response;}
    const fieldId='category-field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},
      access={fieldId,revision:1,endpointId:'category-endpoint',rootLocation:source,mountScopeId:'category-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/category-access/v1'};
    await request('POST','/v1/admin/material-fields',{idempotencyKey:'category-register',fieldId,name:'Category fixture',contentProfileHint:'series',
      policy:{extractionPolicyId:'category-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
        policyDigest:canonicalDigest({extractionPolicyId:'category-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
    await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/observe',{idempotencyKey:'category-observe',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:32});
    const until=Date.now()+840000;
    while(Date.now()<until){assert.ifError(runtimeError);const runs=db.prepare('SELECT state,seal_outcome FROM proc_procurement_runs').all();
      if(runs.length===2&&runs.every(row=>row.state==='sealed'))break;await new Promise(resolve=>setTimeout(resolve,200));}
    const runs=db.prepare('SELECT * FROM proc_procurement_runs').all();assert.equal(runs.length,2);assert.ok(runs.every(row=>row.state==='sealed'&&row.seal_outcome==='completed'));
    const packages=db.prepare('SELECT * FROM proc_candidate_packages').all(),members=db.prepare('SELECT * FROM proc_candidate_primary_materials').all();
    assert.equal(packages.length,65);assert.equal(members.length,1081);assert.equal(new Set(members.map(row=>row.material_key)).size,1081);
    assert.ok(packages.every(row=>row.structure_kind==='season'&&row.content_profile==='series'));
    const sizes=db.prepare('SELECT procurement_run_id,count(*) n FROM proc_run_materials GROUP BY procurement_run_id').all();assert.ok(sizes.every(row=>row.n<=1024));
    assert.equal(db.prepare('SELECT count(*) n FROM fx_event_attempts WHERE failure_code IS NOT NULL').get().n,0);
    for(const file of files)assert.ok(fs.existsSync(file));assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');
  }finally{await host.close();db.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
