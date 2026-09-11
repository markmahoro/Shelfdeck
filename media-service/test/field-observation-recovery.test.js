'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { createCleanFieldObservationEnumerator } = require('../src/clean-field-observation-enumerator');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { PERIOD_MS } = require('../src/helix/domains/procurement/application/field-observation-automation');

test('UAT-257 partial failure, zero-page failure and restart recover through new ordinary scans', {timeout:120_000}, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-scan-recovery-'));
  const dataDir=path.join(root,'data'),source=path.join(root,'source'),adminDistDir=path.join(root,'admin');
  fs.mkdirSync(source);fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  for(const name of ['First.Movie.2024.mkv','Second.Movie.2024.mkv'])fs.writeFileSync(path.join(source,name),'isolated observation material');
  const secretRoot='isolated-scan-recovery-secret-root-20260912';
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const databasePath=path.join(dataDir,'shelfdeck.db');
  let now=Date.now(),failurePage=1,runtimeError,host,cookie;
  const enumerator=createCleanFieldObservationEnumerator({now:()=>now,batchLimit:1});
  const options={dataDir,secretRoot,adminDistDir,now:()=>now,
    fieldObservationEnumerator:{async enumeratePage(request){
      if(request.pageRequest.pageOrdinal===failurePage)throw Object.assign(new Error('Expired test handle'),{code:'P7_FIELD_ACCESS_EXPIRED'});
      return enumerator.enumeratePage(request);
    }},
    mediaProbe:{async probe(handle){
      const value={resultKind:'probed',sourceHandleDigest:canonicalDigest(handle),durationMs:1000,
        videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],
        audioStreams:[],subtitleStreams:[],discTopology:null};
      return Object.freeze({...value,payloadDigest:canonicalDigest(value)});
    }},onExecutionRuntimeError(error){runtimeError=error;}};
  t.after(async()=>{await host?.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  async function start(){host=await createCleanServiceHost(options);const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(response.statusCode,204);cookie=response.headers['set-cookie'];}
  async function request(method,url,payload){const r=await host.inject({method,url,headers:{cookie},payload});assert.ok(r.statusCode>=200&&r.statusCode<300,r.body);return r.json();}
  function read(sql,...args){const db=new Database(databasePath,{readonly:true});try{return db.prepare(sql).all(...args);}finally{db.close();}}
  const works=()=>read("SELECT work_id,state,created_at_ms FROM fx_supporting_works WHERE work_kind='field_observation' ORDER BY created_at_ms,work_id");
  async function until(predicate){const deadline=Date.now()+40_000;while(Date.now()<deadline){assert.ifError(runtimeError);if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}assert.fail('Scan did not converge: '+JSON.stringify(works()));}
  await start();
  const fieldId='scan-recovery-field';
  const policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  const access={fieldId,revision:1,endpointId:'scan-endpoint',rootLocation:source,mountScopeId:'scan-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/scan-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'register-scan',fieldId,name:'Scan recovery',contentProfileHint:'movie',
    policy:{extractionPolicyId:'scan-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
      policyDigest:canonicalDigest({extractionPolicyId:'scan-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
  await request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{idempotencyKey:'pause-intake',predeckPipelineSeats:0});
  const url=`/v1/admin/material-fields/${fieldId}/actions/observe`;
  const firstRequest={idempotencyKey:'first-manual-scan',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:1};
  const [first,replay]=await Promise.all([request('POST',url,firstRequest),request('POST',url,firstRequest)]);
  assert.equal(first.observation.observationWorkId,replay.observation.observationWorkId);
  await until(()=>works().length===1&&works()[0].state==='failed');
  const originalPages=read('SELECT * FROM proc_field_observations');
  assert.equal(originalPages.length,1);assert.equal(originalPages[0].completed,0);
  assert.equal(read('SELECT count(*) n FROM proc_candidate_packages')[0].n,0);
  assert.equal((await request('POST',url,firstRequest)).observation.observationWorkId,first.observation.observationWorkId);
  const failedField=(await request('GET','/v1/admin/material-fields')).items[0];
  assert.equal(failedField.procurementStatus.observationScan.failureMessage,'扫描超时');
  await host.close();now+=PERIOD_MS+1;failurePage=0;
  await start();await until(()=>works().length===2&&works()[1].state==='failed');
  assert.equal(read('SELECT count(*) n FROM proc_field_observations')[0].n,1);
  assert.equal((await request('GET','/v1/admin/material-fields')).items[0].procurementStatus.observationScan.pageCount,0);
  const failedWorks=works();
  await host.close();await start();
  await new Promise(resolve=>setTimeout(resolve,750));assert.deepEqual(works(),failedWorks,'Restart must not immediately retry a zero-page failure');
  await host.close();now+=PERIOD_MS+1;failurePage=null;
  await start();await until(()=>works().length===3&&works()[2].state==='succeeded'&&read('SELECT count(*) n FROM proc_candidate_packages')[0].n===2);
  assert.deepEqual(read('SELECT * FROM proc_field_observations WHERE revision=1'),originalPages);
  const complete=(await request('GET','/v1/admin/material-fields')).items[0];
  assert.equal(complete.procurementStatus.observationScan.state,'completed');
  assert.equal(complete.procurementStatus.observationScan.failureMessage,undefined);
  assert.equal(complete.procurementStatus.generatedPackageCount,2);
  now+=1000;
  const manual={...firstRequest,idempotencyKey:'new-manual-round',expectedObservationRevision:complete.currentObservationRevision};
  const newer=await request('POST',url,manual);
  assert.notEqual(newer.observation.observationWorkId,first.observation.observationWorkId);
  await until(()=>works().length===4&&works()[3].state==='succeeded');
  await host.close();now+=1000;await start();
  await until(()=>works().length===5&&works()[4].state==='succeeded');
  assert.equal(read('SELECT count(*) n FROM proc_candidate_packages')[0].n,2,
    'Normal startup observation after success must preserve delivery guards');
  assert.ifError(runtimeError);
});
