'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3'),sharp=require('sharp');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');

async function fixture(t,fields,{secondarySeats=5,holdCode=null,transcodeCode=null,spaceBlocked=false,primarySeats=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'libra-workshop-host-'));
 const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),target=path.join(root,'shelf');
 fs.mkdirSync(adminDistDir);fs.mkdirSync(target);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
 const video=path.join(root,'fixture.mkv');
 const encoded=spawnSync(process.env.FFMPEG_PATH||require('ffmpeg-static'),['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=320x240:r=24:d=3',
  '-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p','-color_range','tv',
  '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',video],{encoding:'utf8',windowsHide:true,timeout:60000});
 assert.equal(encoded.status,0,encoded.stderr);const bytes=fs.readFileSync(video);
 let transcodeBytes=null;
 if(transcodeCode){
  const input=path.join(root,'transcode-input.mkv');
  const generated=spawnSync(process.env.FFMPEG_PATH||require('ffmpeg-static'),['-hide_banner','-nostdin','-y','-f','lavfi','-i',
   'color=c=black:s=1920x1080:r=24:d=240','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
   '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',input],
   {encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(generated.status,0,generated.stderr);transcodeBytes=fs.readFileSync(input);
 }
 const picture=await sharp({create:{width:560,height:800,channels:3,background:{r:80,g:110,b:150}}}).jpeg().toBuffer();
 let releaseHeld,held=false,armed=false,requestError=null,runtimeError=null,host,db,clockOffset=0;
 const spaceChecks=[];
 const gate=new Promise(resolve=>{releaseHeld=resolve;});
 const secretRoot='libra-workshop-host-fixture-0123456789abcdef0123456789';
 const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
 const fetch=async url=>{
  const value=new URL(url),code=value.searchParams.get('q')||'IPX-'+value.pathname.replace('/v/Fair','');
  if(value.hostname==='javdb.com'&&value.pathname==='/search'){
   if(armed&&code===holdCode&&!held){held=true;await gate;}
   return new Response('<div class="movie-list"><div class="item"><a href="/v/Fair'+code.split('-')[1]+'"><strong>'+code+'</strong></a></div></div>',{headers:{'content-type':'text/html; charset=utf-8'}});
  }
  if(value.hostname==='javdb.com'&&value.pathname.startsWith('/v/Fair'))return new Response(
   '<link rel="canonical" href="https://javdb.com'+value.pathname+'"><div class="video-detail"><h2 class="title">'+code+' Fairness fixture '+code+'</h2><div class="movie-panel-info">'+
   '<div class="panel-block"><strong>番號：</strong><span class="value">'+code+'</span></div><div class="panel-block"><strong>日期：</strong><span class="value">2026-10-15</span></div>'+
   '<div class="panel-block"><strong>演員：</strong><span class="value"><a href="/actors/fixture">Fixture Actor</a></span></div></div><img class="video-cover" src="https://c0.jdbstatic.com/'+code+'.jpg"></div>',
   {headers:{'content-type':'text/html; charset=utf-8'}});
  if(value.hostname==='c0.jdbstatic.com')return new Response(picture,{headers:{'content-type':'image/jpeg'}});
  throw Error('Unexpected fixture network request.');
 };
 const start=async()=>createCleanServiceHost({dataDir,adminDistDir,secretRoot,integrationFetch:fetch,now:()=>Date.now()+clockOffset,
  workspaceStatfsSync:(location,options)=>{
   if(armed&&spaceBlocked){spaceChecks.push(Date.now()+clockOffset);return {bsize:4096n,bavail:0n};}
   return fs.statfsSync(location,options);
  },
  onRequestError:error=>{requestError=error;},onExecutionRuntimeError:error=>{runtimeError=error;}});
 t.after(async()=>{releaseHeld();await host?.close();db?.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});
 host=await start();let cookie;
 async function login(){const result=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(result.statusCode,204);cookie=result.headers['set-cookie'];}
 await login();
 async function request(method,url,payload){requestError=null;const result=await host.inject({method,url,headers:{cookie},payload});
  assert.ok(result.statusCode>=200&&result.statusCode<300,result.body+'\n'+(requestError?.stack||''));return result.json();}
 db=new Database(path.join(dataDir,'shelfdeck.db'));
 const diagnostics=()=>JSON.stringify({runtimeError:runtimeError?.stack,
  runs:db.prepare('SELECT libra_run_id,subject_id,state FROM libra_runs').all(),
  placements:db.prepare('SELECT subject_id FROM libra_workshop_placements').all(),
  tokens:db.prepare('SELECT subject_id,source_process_id FROM libra_predeck_pipeline_tokens').all(),
  works:db.prepare('SELECT process_type,process_id,work_kind,state FROM fx_supporting_works').all(),
  failures:db.prepare('SELECT failure_class,failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
  pending:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE state NOT IN ('succeeded','skipped','failed','cancelled')").all()});
 async function wait(predicate,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){assert.equal(runtimeError,null,diagnostics());if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(diagnostics());}
 const proof=await request('POST','/v1/admin/settings/integrations/jav-javdb/actions/test',{kind:'jav-javdb',idempotencyKey:'connection-test',endpoint:'https://javdb.com',credential:{kind:'anonymous'},settings:{networkRoute:{mode:'direct',proxyEndpoint:null}}});
 await request('PATCH','/v1/admin/settings/integrations/jav-javdb',{kind:'jav-javdb',idempotencyKey:'connection-save',expectedConfigRevision:0,connectionProofId:proof.connectionProofId});
 await request('POST','/v1/admin/shelves',{idempotencyKey:'shelf',shelfId:'fixture-shelf',name:'Fixture shelf',targetRootLocation:target,
  ruleTemplateId:'system-jav-recommended',expectedTemplateRevision:1,placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',
   nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
 await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full',{idempotencyKey:'fixture-settlement',expectedRevision:0,coverExclusiveRelatedInput:true});
 await request('PATCH','/v1/admin/libra/workshops/secondary',{secondarySeats,idempotencyKey:'secondary-seats'});
 for(const [fieldId,names]of Object.entries(fields)){
  const source=path.join(root,fieldId);fs.mkdirSync(source);for(const name of names)fs.writeFileSync(path.join(source,name+'.mkv'),name===transcodeCode?transcodeBytes:bytes);
  const access={fieldId,revision:1,endpointId:'endpoint-'+fieldId,rootLocation:source,mountScopeId:'mount-'+fieldId,mountScopeRevision:1,accessSchemaRef:'helix://fixtures/jav-access/v1'};
  const policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},policyId='extract-'+fieldId;
  await request('POST','/v1/admin/material-fields',{idempotencyKey:fieldId,fieldId,name:fieldId,contentProfileHint:'jav',
   access:{...access,accessDigest:canonicalDigest(access)},policy:{extractionPolicyId:policyId,revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',
    policy,policyDigest:canonicalDigest({extractionPolicyId:policyId,revision:1,...policy})}});
  await request('PATCH','/v1/admin/routing/material-fields/'+fieldId,{idempotencyKey:'route-'+fieldId,fieldId,expectedPolicyId:null,expectedRevision:0,
   policy:{routingPolicyId:'route-'+fieldId,mode:'direct',targets:[{shelfId:'fixture-shelf',rank:1,matchExpression:{nodeKind:'always'}}]}});
  await request('PATCH','/v1/admin/libra/material-fields/'+fieldId+'/intake-admission',{predeckPipelineSeats:primarySeats??(names.length===3?1:3),idempotencyKey:'seats-'+fieldId});
 }
 armed=true;
 for(const fieldId of Object.keys(fields))await request('POST','/v1/admin/material-fields/'+fieldId+'/actions/observe',{
  idempotencyKey:'observe-'+fieldId,fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
 return {db,request,wait,releaseHeld,isHeld:()=>held,bytes,spaceChecks,advanceClock:ms=>{clockOffset+=ms;},
  releaseSpace:()=>{spaceBlocked=false;},restart:async()=>{await host.close();host=await start();await login();}};
}

test('real Host parks repeated space shortage, fills the freed source seat and automatically resumes after space recovery',{timeout:180000},async t=>{
 const ctx=await fixture(t,{source:['IPX-177','IPX-178']},{secondarySeats:1,primarySeats:1,spaceBlocked:true});
 await ctx.wait(()=>ctx.spaceChecks.length>=3);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,0,'fast retries cannot park immediately');
 const firstRun=ctx.db.prepare('SELECT libra_run_id,subject_id FROM libra_runs').get();
 assert.ok(firstRun);assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_workspaces').get().n,0);
 const initialChecks=ctx.spaceChecks.length;
 ctx.advanceClock(60000);await ctx.wait(()=>ctx.spaceChecks.length>initialChecks);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,0);
 ctx.advanceClock(60000);
 await ctx.wait(()=>ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n===1&&
  ctx.db.prepare('SELECT count(*) n FROM libra_runs').get().n===2);
 const placement=ctx.db.prepare('SELECT subject_id FROM libra_workshop_placements').get();assert.equal(placement.subject_id,firstRun.subject_id);
 assert.equal((await ctx.request('GET','/v1/admin/libra/material-fields/source/intake-admission')).pipelineTokensHeld,1);
 await ctx.restart();
 assert.deepEqual(ctx.db.prepare('SELECT subject_id FROM libra_workshop_placements').get(),placement);
 ctx.releaseSpace();
 await ctx.wait(()=>ctx.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===2,90000);
 assert.equal(ctx.db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(firstRun.libra_run_id).state,'completed');
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,0);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
});

test('real Host transfers attention under backpressure, persists placement over restart and resumes the same Run in secondary',{timeout:180000},async t=>{
 const ctx=await fixture(t,{source:['Unrecognized-one','Unrecognized-two','Unrecognized-three']},{secondarySeats:2});
 await ctx.wait(()=>ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n===2&&ctx.db.prepare('SELECT count(*) n FROM libra_runs').get().n===3);
 const placements=ctx.db.prepare('SELECT subject_id FROM libra_workshop_placements ORDER BY subject_id').all();
 const identities=ctx.db.prepare('SELECT libra_run_id,subject_id FROM libra_runs ORDER BY libra_run_id').all();
 const policy=await ctx.request('GET','/v1/admin/libra/material-fields/source/intake-admission');assert.equal(policy.pipelineTokensHeld,1);
 await ctx.request('PATCH','/v1/admin/libra/workshops/secondary',{secondarySeats:0,idempotencyKey:'stop-transfers'});
 await ctx.restart();
 assert.deepEqual(ctx.db.prepare('SELECT subject_id FROM libra_workshop_placements ORDER BY subject_id').all(),placements);
 const run=identities.find(row=>row.subject_id===placements[0].subject_id);
 const preview=await ctx.request('GET','/v1/admin/formation/runs/'+run.libra_run_id+'/product-identity-preview?javCode=IPX-177');assert.equal(preview.result,'qualified');
 await ctx.request('POST','/v1/admin/formation/runs/'+run.libra_run_id+'/actions/choose-product-identity',{
  javCode:preview.javCode,previewId:preview.previewId,candidateSetDigest:preview.candidateSetDigest,expectedRunStateRevision:preview.expectedRunStateRevision,
  expectedIdentityRevision:preview.expectedIdentityRevision,expectedSelectionIntentRevision:preview.expectedSelectionIntentRevision,idempotencyKey:'resolve-secondary'});
 assert.ok(ctx.db.prepare('SELECT subject_id FROM libra_workshop_placements WHERE subject_id=?').get(run.subject_id));
 await ctx.wait(()=>ctx.db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(run.libra_run_id).state==='completed'&&
  ctx.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===1,90000);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n,1);
 assert.deepEqual(ctx.db.prepare('SELECT libra_run_id,subject_id FROM libra_runs ORDER BY libra_run_id').all(),identities);
 assert.equal((await ctx.request('GET','/v1/admin/libra/material-fields/source/intake-admission')).pipelineTokensHeld,1);
 await ctx.request('PATCH','/v1/admin/libra/workshops/secondary',{secondarySeats:5,idempotencyKey:'allow-transfers'});
 await ctx.wait(()=>ctx.db.prepare('SELECT count(*) n FROM libra_workshop_placements').get().n===2);
 assert.equal((await ctx.request('GET','/v1/admin/libra/material-fields/source/intake-admission')).pipelineTokensHeld,0);
});

test('three real sources progress with uneven Run counts during a held Capability and real long transcode',{timeout:360000},async t=>{
 const ctx=await fixture(t,{source_a:['IPX-177','IPX-178'],source_b:['IPX-179'],source_c:['IPX-180']},{holdCode:'IPX-177',transcodeCode:'IPX-177'});
 await ctx.wait(()=>ctx.isHeld());
 await ctx.wait(()=>['source_b','source_c'].every(field=>
  ctx.db.prepare('SELECT last_turn_sequence FROM libra_fairness_sources WHERE source_field_id=?').get(field)?.last_turn_sequence>0&&
  ctx.db.prepare("SELECT e.event_id FROM fx_workflow_events e JOIN fx_supporting_works w ON w.work_id=e.work_id JOIN libra_fairness_runs f ON f.libra_run_id=w.process_id WHERE f.source_field_id=? AND e.state='succeeded'").get(field)),15000);
 assert.ok(ctx.db.prepare("SELECT e.event_id FROM fx_workflow_events e JOIN fx_supporting_works w ON w.work_id=e.work_id JOIN libra_runs r ON r.libra_run_id=w.process_id JOIN libra_predeck_pipeline_tokens t ON t.subject_id=r.subject_id WHERE t.source_field_id='source_a' AND e.state='executing'").get());
 for(const field of ['source_b','source_c'])assert.ok(ctx.db.prepare("SELECT e.event_id FROM fx_workflow_events e JOIN fx_supporting_works w ON w.work_id=e.work_id JOIN libra_fairness_runs f ON f.libra_run_id=w.process_id WHERE f.source_field_id=? AND e.state='succeeded'").get(field));
 ctx.releaseHeld();
 let transcode;
 await ctx.wait(()=>{
  transcode=ctx.db.prepare("SELECT e.event_id,a.event_attempt_id FROM fx_workflow_events e JOIN fx_event_attempts a ON a.event_id=e.event_id AND a.state='executing' WHERE e.capability_ref='libra.media.transcode@1' AND e.state='executing'").get();
  return transcode&&ctx.db.prepare('SELECT current_value FROM fx_event_progress WHERE event_id=? AND current_value>0').get(transcode.event_id)&&
   ['source_b','source_c'].every(field=>ctx.db.prepare("SELECT r.libra_run_id FROM libra_runs r JOIN libra_fairness_runs f ON f.libra_run_id=r.libra_run_id WHERE f.source_field_id=? AND r.state='completed'").get(field));
 },120000);
 assert.equal(ctx.db.prepare('SELECT last_event_attempt_id FROM libra_fairness_events WHERE foundation_event_id=?').get(transcode.event_id).last_event_attempt_id,transcode.event_attempt_id);
 await ctx.wait(()=>ctx.db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===4,240000);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM fx_event_attempts WHERE event_id=?').get(transcode.event_id).n,1);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_fairness_sources').get().n,3);
 assert.deepEqual(ctx.db.prepare('SELECT source_field_id,count(*) n FROM libra_fairness_runs GROUP BY source_field_id ORDER BY source_field_id').all(),
  [{source_field_id:'source_a',n:2},{source_field_id:'source_b',n:1},{source_field_id:'source_c',n:1}]);
 assert.equal(ctx.db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
});
