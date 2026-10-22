'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const service=path.resolve(__dirname,'../..'),req=p=>require(path.join(service,p));
const Database=req('node_modules/better-sqlite3');
const {initializeCleanData}=req('scripts/helix-operational-safety');
const {createCleanServiceHost}=req('src/clean-service-host');
const {canonicalDigest}=req('src/helix/contracts/canonical-json');
const {SYSTEM_TEMPLATE_ID}=req('src/helix/domains/arca/model/rule-template-contracts');
for (const scenario of ['normal','technical_failure','invalid_material','no_run','reset','excluded','retired_field']) require('node:test')('ordinary procurement retry and cancellation: '+scenario, {timeout:120000}, async()=>{
 const failPreparationFirst=['technical_failure','retired_field'].includes(scenario);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelfdeck-discard-audit-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),source=path.join(root,'source'),shelf=path.join(root,'shelf');
 for(const dir of [adminDistDir,source,shelf])fs.mkdirSync(dir);
 const browserEnabled=process.env.HELIX_LIFECYCLE_BROWSER==='1'&&['no_run','reset','excluded'].includes(scenario);
 if(browserEnabled)fs.cpSync(path.join(service,'dist/admin'),adminDistDir,{recursive:true});
 else fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div></div>');
 const file=path.join(source,'Unresolved.Movie.2024.mkv');fs.writeFileSync(file,'same original physical input for discard audit');
 const originalStat=fs.statSync(file,{bigint:true}),originalHash=canonicalDigest(fs.readFileSync(file).toString('hex'));
 const secretRoot='isolated-discard-procurement-audit-20261021';
 const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'}),databasePath=path.join(dataDir,'shelfdeck.db');
 const errors=[];let host,browser,page,browserBase,fixtureError,probeAvailable=!failPreparationFirst;
 function sql(query,...args){const db=new Database(databasePath,{readonly:true});try{return db.prepare(query).all(...args);}finally{db.close();}}
 const options={dataDir,secretRoot,adminDistDir,libraWorkspaceRoot:path.join(root,'workspace'),onExecutionRuntimeError:e=>errors.push({code:e.code,message:e.message}),mediaProbe:{async probe(handle){if(!probeAvailable)throw Object.assign(new Error('Fixture probe temporarily unavailable'),{code:'EHOSTUNREACH'});const value={resultKind:scenario==='invalid_material'?'not_media':'probed',sourceHandleDigest:canonicalDigest(handle),durationMs:1000,videoStreams:scenario==='invalid_material'?[]:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};return {...value,payloadDigest:canonicalDigest(value)};}}};
 try{
 host=await createCleanServiceHost(options);
 const auth=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(auth.statusCode,204,auth.body);let cookie=auth.headers['set-cookie'];
 async function request(method,url,payload){const r=await host.inject({method,url,headers:{cookie},payload});assert.ok(r.statusCode>=200&&r.statusCode<300,url+' '+r.body);return r.json();}
 async function until(fn,label){const deadline=Date.now()+45000;while(Date.now()<deadline){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,50));}throw Error(label+' '+JSON.stringify({errors,runs:sql('SELECT state FROM libra_runs'),packages:sql('SELECT state FROM proc_candidate_deliveries')}));}
 if(scenario==='reset') {
  await request('PATCH','/v1/admin/settings/workspaces',{rootPath:path.join(root,'configured-workspace'),expectedConfigRevision:1,idempotencyKey:'configure-reset-workspace'});
  await host.close();host=await createCleanServiceHost(options);
  const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
  assert.equal(login.statusCode,204);cookie=login.headers['set-cookie'];
 }
 const template=SYSTEM_TEMPLATE_ID||'system-movie-default';
 await request('POST','/v1/admin/shelves',{idempotencyKey:'shelf',shelfId:'audit-shelf',name:'Audit',targetRootLocation:shelf,ruleTemplateId:template,expectedTemplateRevision:1,placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
 const fieldId='audit-field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},access={fieldId,revision:1,endpointId:'audit-endpoint',rootLocation:source,mountScopeId:'audit-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/audit-access/v1'};
 await request('POST','/v1/admin/material-fields',{idempotencyKey:'field',fieldId,name:'Audit',contentProfileHint:'movie',policy:{extractionPolicyId:'audit-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:canonicalDigest({extractionPolicyId:'audit-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
 if(!['no_run','reset'].includes(scenario))await request('PATCH','/v1/admin/routing/material-fields/'+fieldId,{idempotencyKey:'routing',fieldId,expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'audit-routing',mode:'direct',targets:[{shelfId:'audit-shelf',rank:1,matchExpression:{nodeKind:'always'}}]}});
 async function scan(key){const field=(await request('GET','/v1/admin/material-fields')).items.find(x=>x.fieldId===fieldId);const r=await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/observe',{idempotencyKey:key,fieldId,expectedAccessRevision:1,expectedObservationRevision:field.currentObservationRevision||0,pageBudget:8});await until(()=>sql('SELECT state FROM fx_supporting_works WHERE work_id=?',r.observation.observationWorkId)[0]?.state==='succeeded','scan complete');return r;}
 await scan('first');
 async function cancelThroughBrowser(excludeSourceFiles){
  const {chromium,expect}=req('web/node_modules/@playwright/test');
  browserBase=await host.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1920,height:1080}});
  const login=await page.request.post(browserBase+'/v1/admin/session',{headers:{'X-Api-Key':initialized.adminApiKey}});assert.equal(login.status(),204);
  await page.goto(browserBase+'/formation');
  await page.getByRole('button',{name:'取消整理任务',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'确认取消整理任务'}),checkbox=dialog.getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();if(excludeSourceFiles)await checkbox.check();
  const output=process.env.HELIX_LIFECYCLE_BROWSER_OUTPUT;assert.ok(output&&path.isAbsolute(output));fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,scenario+'-cancel-wide.png'),fullPage:true});
  await page.setViewportSize({width:980,height:900});await page.screenshot({path:path.join(output,scenario+'-cancel-narrow.png'),fullPage:true});
  await dialog.getByRole('button',{name:'确认取消任务'}).click();await expect(dialog).toBeHidden();
  return {resultKind:'closure_pending'};
 }
 if(scenario==='reset') {
  const subject=await until(()=>sql("SELECT subject_id FROM libra_subjects WHERE status='active'")[0],'accepted subject');
  assert.equal(sql('SELECT count(*) n FROM libra_runs')[0].n,0);
  const historical=Object.fromEntries(['proc_candidate_packages','libra_intake_decisions','libra_handoff_a_receipts'].map(table=>[table,sql('SELECT * FROM '+table)]));
  await request('POST','/v1/admin/runtime/actions/stop',{idempotencyKey:'stop-for-reset'});
  await until(async()=>(await request('GET','/v1/admin/runtime')).mode==='stopped','safe stop');
  const preview=await request('GET','/v1/admin/runtime/reset-preview');
  assert.equal(preview.ready,true,JSON.stringify(preview.blockers)); assert.equal(preview.counts.subjects,1);
  if(browserEnabled){
    const {chromium,expect}=req('web/node_modules/@playwright/test');
    browserBase=await host.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({headless:true});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    const login=await page.request.post(browserBase+'/v1/admin/session',{headers:{'X-Api-Key':initialized.adminApiKey}});assert.equal(login.status(),204);
    await page.goto(browserBase+'/');await page.getByRole('button',{name:'重置工作台',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'重置整理工作台'}),confirm=dialog.getByRole('button',{name:'确认重置',exact:true});
    await expect(dialog.getByText(/将结束 1 项/)).toBeVisible();await expect(confirm).toBeDisabled();
    await dialog.getByLabel('确认词').fill('wrong');await expect(confirm).toBeDisabled();
    const output=process.env.HELIX_LIFECYCLE_BROWSER_OUTPUT;assert.ok(output&&path.isAbsolute(output));fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'reset-confirm-wide.png'),fullPage:true});
    await page.setViewportSize({width:980,height:900});await page.screenshot({path:path.join(output,'reset-confirm-narrow.png'),fullPage:true});
    await dialog.getByLabel('确认词').fill('重置工作台');await expect(confirm).toBeEnabled();
    await confirm.focus();await page.keyboard.press('Enter');await expect(dialog).toBeHidden();
    await expect(page.getByText('已重置工作台，服务保持停机。',{exact:true})).toBeVisible({timeout:45000});
    await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toBeEnabled();
    await expect(page.getByText('暂无待办',{exact:true})).toBeVisible();
    await expect(page.getByText(/等待进入整理 [1-9]/)).toHaveCount(0);
    await page.screenshot({path:path.join(output,'reset-completed-stopped.png'),fullPage:true});
    await page.getByRole('button',{name:'重置工作台',exact:true}).click();
    await expect(page.getByText('没有可重置的当前整理任务。',{exact:true})).toBeVisible();
    await expect(confirm).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  }else await request('POST','/v1/admin/runtime/actions/reset',{idempotencyKey:'retire-workbench',previewDigest:preview.previewDigest,confirmed:true});
  const reset=await until(async()=>{const state=await request('GET','/v1/admin/runtime');
    assert.notEqual(state.operation?.state,'failed',JSON.stringify(state.error));assert.notEqual(state.mode,'error',JSON.stringify(state.error));return state.operation?.state==='completed'&&state;},'reset completed');
  assert.equal(sql('SELECT state FROM proc_candidate_deliveries')[0].state,'accepted');
  assert.equal((await request('GET','/v1/admin/overview')).pipeline.waitingAcceptanceCount,0);
  assert.equal(reset.mode,'stopped');assert.equal(reset.normalSupplyAllowed,false);
  assert.equal(sql('SELECT status FROM libra_subjects WHERE subject_id=?',subject.subject_id)[0].status,'administratively_retired');
  assert.equal(sql('SELECT count(*) n FROM libra_predeck_pipeline_tokens')[0].n,0);
  for(const [table,rows] of Object.entries(historical))assert.deepEqual(sql('SELECT * FROM '+table),rows);
  assert.equal((await request('GET','/v1/admin/formation?section=active&limit=25')).items.length,0);
  const history=await request('GET','/v1/admin/formation?section=ended&limit=25');
  assert.ok(history.items.some(item=>item.subjectId===subject.subject_id&&item.label==='已重置整理任务'));
  await host.close();host=await createCleanServiceHost(options);
  const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(login.statusCode,204);cookie=login.headers['set-cookie'];
  assert.equal((await request('GET','/v1/admin/runtime')).mode,'stopped');
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,1,'Reset and startup must not procure');
  await request('POST','/v1/admin/runtime/actions/resume',{idempotencyKey:'resume-after-reset'});
  await until(async()=>(await request('GET','/v1/admin/runtime')).mode==='running','resume');
  await scan('normal-observation-after-reset');
  await until(()=>sql("SELECT count(*) n FROM libra_subjects WHERE status='active'")[0].n===1,'new accepted subject');
  assert.equal(sql('SELECT count(*) n FROM libra_subjects')[0].n,2);
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,2);
  assert.equal(sql('SELECT status FROM libra_subjects WHERE subject_id=?',subject.subject_id)[0].status,'administratively_retired');
  assert.equal(sql('SELECT count(*) n FROM libra_predeck_pipeline_tokens WHERE subject_id=?',subject.subject_id)[0].n,0);
  const stat=fs.statSync(file,{bigint:true});assert.equal(stat.ino,originalStat.ino);assert.equal(stat.mtimeNs,originalStat.mtimeNs);
  assert.equal(canonicalDigest(fs.readFileSync(file).toString('hex')),originalHash);
  return;
 }
 if(scenario==='no_run'){
  const subject=await until(()=>sql("SELECT subject_id FROM libra_subjects WHERE status='active'")[0],'accepted subject');
  assert.equal(sql('SELECT count(*) n FROM libra_runs')[0].n,0);
  if(browserEnabled)await cancelThroughBrowser(false);
  else await request('POST','/v1/admin/formation/subjects/'+subject.subject_id+'/actions/abandon',{idempotencyKey:'cancel-no-run'});
  await until(()=>sql("SELECT status FROM libra_subjects WHERE subject_id=?",subject.subject_id)[0]?.status==='abandoned','subject abandoned');
  assert.equal(sql("SELECT count(*) n FROM fx_material_controls WHERE owner_domain='libra' AND owner_scope_id=?",subject.subject_id)[0].n,0);
  await until(async()=>{const history=await request('GET','/v1/admin/formation?section=ended&limit=25');
    return history.items.some(item=>item.subjectId===subject.subject_id&&item.libraRunId===null&&item.label==='已取消整理任务');},'cancelled no-run Subject appears in history');
  assert.ok(!(await request('GET','/v1/admin/formation?section=active&limit=25')).items.some(item=>item.subjectId===subject.subject_id));
  assert.deepEqual((await request('GET','/v1/admin/formation/preparation-failures')).items,[]);
  await scan('second-after-no-run-cancellation');
  await until(()=>sql('SELECT count(*) n FROM libra_subjects')[0].n===2,'new subject after no-run cancellation');
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,2);
  assert.equal(fs.statSync(file,{bigint:true}).mtimeNs,originalStat.mtimeNs);
  return;
 }
 if(scenario==='invalid_material'){
  await until(()=>sql("SELECT state FROM proc_procurement_runs WHERE state='sealed'").length===1,'invalid material classified');
  await scan('unchanged-invalid');await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(sql('SELECT count(*) n FROM proc_procurement_runs')[0].n,1);
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,0);
  return;
 }
 if(scenario==='retired_field'){
  await until(()=>sql("SELECT state FROM proc_procurement_runs WHERE state='sealed'").length===1,'failed preparation sealed');
  assert.equal(sql("SELECT count(*) n FROM fx_material_controls WHERE state='controlled' AND owner_scope_id=?",fieldId)[0].n,1);
  await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/deregister',{
    idempotencyKey:'retire',fieldId,expectedAccessRevision:1,expectedPolicyRevision:1});
  await until(()=>sql("SELECT count(*) n FROM fx_material_controls WHERE state='controlled' AND owner_scope_id=?",fieldId)[0].n===0,'retired idle controls released');
  probeAvailable=true;
  const replacement='replacement-field',replacementAccess={...access,fieldId:replacement};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'replacement',fieldId:replacement,name:'Replacement',contentProfileHint:'movie',
    policy:{extractionPolicyId:'replacement-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
      policyDigest:canonicalDigest({extractionPolicyId:'replacement-policy',revision:1,...policy})},
    access:{...replacementAccess,accessDigest:canonicalDigest(replacementAccess)}});
  const replacementField=(await request('GET','/v1/admin/material-fields')).items.find(item=>item.fieldId===replacement);
  const observed=await host.inject({method:'POST',url:'/v1/admin/material-fields/'+replacement+'/actions/observe',headers:{cookie},payload:{
    idempotencyKey:'replacement-scan',fieldId:replacement,expectedAccessRevision:1,
    expectedObservationRevision:replacementField.currentObservationRevision||0,pageBudget:8}});
  if(observed.statusCode===409) {
    // The ordinary startup observer may already own the new Field's first Work.
    assert.equal(observed.json().error.details.reasonCode,'FIELD_OBSERVATION_WORK_DEFERRED',observed.body);
    assert.ok(sql("SELECT work_id FROM fx_supporting_works WHERE owner_domain='procurement' AND process_id=? AND work_kind='field_observation'",replacement).length);
  }else assert.ok(observed.statusCode>=200&&observed.statusCode<300,observed.body);
  await until(()=>sql('SELECT count(*) n FROM libra_subjects')[0].n===1,'same untouched material accepted from replacement field');
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,1);
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
 const result=browserEnabled?await cancelThroughBrowser(scenario==='excluded'):await request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/discard',{expectedRunStateRevision:Number(run.state_revision),expectedRunStateDigest:run.state_digest,idempotencyKey:'discard',excludeSourceFiles:scenario==='excluded'});
 assert.ok(['discarded','closure_pending'].includes(result.resultKind));
 await until(()=>sql('SELECT state FROM libra_runs WHERE libra_run_id=?',run.libra_run_id)[0]?.state==='discarded','one cancellation finishes without another request');
 if(scenario==='excluded'){
  const excluded=await request('GET','/v1/admin/material-fields/'+fieldId+'/extraction-policy');
  assert.equal(excluded.excludedMaterials.length,1);assert.equal(path.normalize(excluded.excludedMaterials[0].location),file);
  await scan('while-excluded');await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,1);
  const old=excluded.extractionPolicy,next={...old.policy,excludedMaterialKeys:[]},revision=old.revision+1;
  if(browserEnabled){
   const {expect}=req('web/node_modules/@playwright/test');await page.goto(browserBase+'/material-fields');
   await page.getByRole('button',{name:'已排除文件 1',exact:true}).click();
   await expect(page.getByRole('button',{name:'撤销排除',exact:true})).toBeVisible();
   await page.screenshot({path:path.join(process.env.HELIX_LIFECYCLE_BROWSER_OUTPUT,'excluded-files.png'),fullPage:true});
   await page.getByRole('button',{name:'撤销排除',exact:true}).click();await expect(page.getByText('没有已排除的文件',{exact:true})).toBeVisible();
  }else await request('PATCH','/v1/admin/material-fields/'+fieldId+'/extraction-policy',{fieldId,idempotencyKey:'revoke-exclusion',
    expectedPolicyId:old.extractionPolicyId,expectedPolicyRevision:old.revision,policy:{extractionPolicyId:old.extractionPolicyId,revision,
      policySchemaRef:old.policySchemaRef,policy:next,policyDigest:canonicalDigest({extractionPolicyId:old.extractionPolicyId,revision,...next})}});
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(sql('SELECT count(*) n FROM proc_candidate_packages')[0].n,1,'revocation does not start another attempt');
  assert.equal(sql('SELECT count(*) n FROM libra_reprocess_intents')[0].n,0);
 }
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
 }catch(error){fixtureError=error;throw error;}finally{await browser?.close();if(host)await host.close();try{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(cleanupError){if(!fixtureError)throw cleanupError;}}
});
