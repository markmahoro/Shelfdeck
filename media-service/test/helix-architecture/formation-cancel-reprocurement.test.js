'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const service=path.resolve(__dirname,'../..'),req=p=>require(path.join(service,p));
const Database=req('node_modules/better-sqlite3');
const {initializeCleanData}=req('scripts/helix-operational-safety');
const {createCleanServiceHost}=req('src/clean-service-host');
const {canonicalDigest}=req('src/helix/contracts/canonical-json');
const {SYSTEM_TEMPLATE_ID}=req('src/helix/domains/arca/model/rule-template-contracts');
for (const scenario of ['normal','technical_failure','invalid_material']) require('node:test')('ordinary procurement retry and cancellation: '+scenario, {timeout:120000}, async()=>{
 const failPreparationFirst=scenario==='technical_failure';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelfdeck-discard-audit-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),source=path.join(root,'source'),shelf=path.join(root,'shelf');
 for(const dir of [adminDistDir,source,shelf])fs.mkdirSync(dir);
 fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div></div>');
 const file=path.join(source,'Unresolved.Movie.2024.mkv');fs.writeFileSync(file,'same original physical input for discard audit');
 const originalStat=fs.statSync(file,{bigint:true}),originalHash=canonicalDigest(fs.readFileSync(file).toString('hex'));
 const secretRoot='isolated-discard-procurement-audit-20261021';
 const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'}),databasePath=path.join(dataDir,'shelfdeck.db');
 const errors=[];let host,probeAvailable=!failPreparationFirst;
 function sql(query,...args){const db=new Database(databasePath,{readonly:true});try{return db.prepare(query).all(...args);}finally{db.close();}}
 const options={dataDir,secretRoot,adminDistDir,libraWorkspaceRoot:path.join(root,'workspace'),onExecutionRuntimeError:e=>errors.push({code:e.code,message:e.message}),mediaProbe:{async probe(handle){if(!probeAvailable)throw Object.assign(new Error('Fixture probe temporarily unavailable'),{code:'EHOSTUNREACH'});const value={resultKind:scenario==='invalid_material'?'not_media':'probed',sourceHandleDigest:canonicalDigest(handle),durationMs:1000,videoStreams:scenario==='invalid_material'?[]:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};return {...value,payloadDigest:canonicalDigest(value)};}}};
 try{
 host=await createCleanServiceHost(options);
 const auth=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(auth.statusCode,204,auth.body);let cookie=auth.headers['set-cookie'];
 async function request(method,url,payload){const r=await host.inject({method,url,headers:{cookie},payload});assert.ok(r.statusCode>=200&&r.statusCode<300,url+' '+r.body);return r.json();}
 async function until(fn,label){const deadline=Date.now()+45000;while(Date.now()<deadline){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,50));}throw Error(label+' '+JSON.stringify({errors,runs:sql('SELECT state FROM libra_runs'),packages:sql('SELECT state FROM proc_candidate_deliveries')}));}
 const template=SYSTEM_TEMPLATE_ID||'system-movie-default';
 await request('POST','/v1/admin/shelves',{idempotencyKey:'shelf',shelfId:'audit-shelf',name:'Audit',targetRootLocation:shelf,ruleTemplateId:template,expectedTemplateRevision:1,placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
 const fieldId='audit-field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},access={fieldId,revision:1,endpointId:'audit-endpoint',rootLocation:source,mountScopeId:'audit-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/audit-access/v1'};
 await request('POST','/v1/admin/material-fields',{idempotencyKey:'field',fieldId,name:'Audit',contentProfileHint:'movie',policy:{extractionPolicyId:'audit-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:canonicalDigest({extractionPolicyId:'audit-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
 await request('PATCH','/v1/admin/routing/material-fields/'+fieldId,{idempotencyKey:'routing',fieldId,expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'audit-routing',mode:'direct',targets:[{shelfId:'audit-shelf',rank:1,matchExpression:{nodeKind:'always'}}]}});
 async function scan(key){const field=(await request('GET','/v1/admin/material-fields')).items.find(x=>x.fieldId===fieldId);const r=await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/observe',{idempotencyKey:key,fieldId,expectedAccessRevision:1,expectedObservationRevision:field.currentObservationRevision||0,pageBudget:8});await until(()=>sql('SELECT state FROM fx_supporting_works WHERE work_id=?',r.observation.observationWorkId)[0]?.state==='succeeded','scan complete');return r;}
 await scan('first');
 if(scenario==='invalid_material'){
  await until(()=>sql("SELECT state FROM proc_procurement_runs WHERE state='sealed'").length===1,'invalid material classified');
  await scan('unchanged-invalid');await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(sql('SELECT count(*) n FROM proc_procurement_runs')[0].n,1);
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,0);
  return;
 }
 if(failPreparationFirst){
  await until(()=>sql("SELECT state FROM proc_procurement_runs WHERE state='sealed'").length===1,'failed preparation sealed');
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,0);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(sql('SELECT count(*) n FROM proc_procurement_runs')[0].n,1,'same observation cannot create a retry loop');
  probeAvailable=true;
  await scan('technical-service-restored');
 }
 const run=await until(()=>sql("SELECT * FROM libra_runs WHERE state='active' LIMIT 1")[0],'initial run');
 await until(()=>sql("SELECT state FROM proc_candidate_deliveries WHERE state='accepted'").length===1,'accepted projection');
 let result;
 await until(async()=>{result=await request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/discard',{expectedRunStateRevision:Number(run.state_revision),expectedRunStateDigest:run.state_digest,idempotencyKey:'discard'});return result.resultKind==='discarded';},'discard');
 await new Promise(r=>setTimeout(r,1200));
 await scan('second-unchanged');
 await until(()=>sql('SELECT count(*) n FROM proc_candidate_packages')[0].n===2,'new unchanged package');
 await new Promise(r=>setTimeout(r,2000));
 const afterStat=fs.statSync(file,{bigint:true});
 assert.equal(afterStat.ino,originalStat.ino);assert.equal(afterStat.size,originalStat.size);assert.equal(afterStat.mtimeNs,originalStat.mtimeNs);assert.equal(canonicalDigest(fs.readFileSync(file).toString('hex')),originalHash);
 await until(()=>sql('SELECT count(*) n FROM libra_runs')[0].n===2,'normal second run');
 await until(()=>sql("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='accepted'")[0].n===2,'normal second acceptance');
 assert.equal(sql('SELECT count(*) n FROM libra_subjects')[0].n,2);
 await scan('third-unchanged');await new Promise(r=>setTimeout(r,1500));assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,2);
 await host.close();host=await createCleanServiceHost(options);
 const auth2=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(auth2.statusCode,204);cookie=auth2.headers['set-cookie'];
 await new Promise(r=>setTimeout(r,1200));
 assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,2);assert.equal(sql('SELECT count(*) n FROM libra_runs')[0].n,2);
 assert.equal(sql('SELECT count(*) n FROM libra_reprocess_intents')[0].n,0);
 }finally{if(host)await host.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
