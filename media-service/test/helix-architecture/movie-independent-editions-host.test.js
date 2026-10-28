'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),Database=require('better-sqlite3'),sharp=require('sharp');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

for (const scenario of ['independent_editions','reset_recovery','handoff_read_fence_race']) test('real media collection journey: '+scenario,{timeout:180000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelfdeck-movie-editions-')),dataDir=path.join(root,'data'),source=path.join(root,'source'),target=path.join(root,'shelf'),adminDistDir=path.join(root,'admin');
 for(const dir of [source,target,adminDistDir])fs.mkdirSync(dir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div></div>');
 const secretRoot='independent-movie-editions-fixture-0123456789abcdef';
 const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
 const image=await sharp({create:{width:360,height:540,channels:3,background:'#416380'}}).jpeg().toBuffer();
 const movie={id:550,title:'Collection Movie',original_title:'Collection Movie',release_date:'2024-01-01',overview:'Collection fixture plot',
  genres:[{id:18,name:'Drama'}],poster_path:'/poster.jpg',backdrop_path:'/fanart.jpg',
  credits:{cast:[{id:101,name:'Fixture Actor',character:'Lead',order:0}],crew:[{id:102,name:'Fixture Director',job:'Director',department:'Directing'}]}};
 const calls=[],errors=[];let host,db,incidentKernel,fenceProof=null,fenceInjected=false;
 function encode(filename,audioCodec){const output=path.join(source,filename),ffmpeg=process.env.FFMPEG_PATH||require('ffmpeg-static');
  const result=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=1920x1080:r=24:d=3',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx265','-preset','ultrafast',
   '-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a',audioCodec,output],
   {encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(result.status,0,result.stderr);return output;}
 try {
  const hostOptions={dataDir,secretRoot,adminDistDir,onExecutionRuntimeError:error=>errors.push(error.code||error.message),
   ...(scenario==='handoff_read_fence_race'?{unitOfWorkDecorator:unit=>({...unit,execute(participants,...args){
    if(!fenceInjected&&participants.some(row=>row.participantId==='arca_handoff_b_attempt_terminal')){
     fenceInjected=true;
     const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository'),
      schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
      audit=createRepositoryDefinition({repositoryId:'concurrent_fixture_audit',owner:'execution-foundation',schemaManifest,statements:{
       insert:{kind:'insert',tableId:'fx_audit_records',columns:['audit_id','owner_domain','actor_type','actor_id','action','scope_type','scope_id','occurred_at_ms']}}});
     unit.execute([{participantId:'intervening_libra_command',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[audit],execute(context){
      context.repository(audit.repositoryId).invoke('insert',{audit_id:'intervening-commit',owner_domain:'libra',actor_type:'admin',actor_id:'fixture',
       action:'fixture.concurrent_commit',scope_type:'subject',scope_id:'fixture-subject',occurred_at_ms:context.commitTimeMs});
     }}]);
     const tables=['arca_acceptance_attempts','arca_acceptance_decisions','arca_ondeck_custodies','arca_material_bindings','arca_ondeck_runs',
       'arca_ondeck_commit_receipts','fx_material_controls','fx_material_control_revisions','fx_outbox','fx_commit_markers'],
      snapshot=()=>canonicalDigest(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),before=snapshot();
     try{const result=unit.execute(participants,...args);fenceProof={code:'UNEXPECTED_ACCEPTANCE',before,after:snapshot()};return result;}
     catch(error){fenceProof={code:error.code,before,after:snapshot()};throw error;}
    }
    return unit.execute(participants,...args);
   }})}:{}),integrationFetch:async input=>{
   const url=new URL(input);calls.push(url.pathname);
   if(url.hostname==='image.tmdb.org')return new Response(image,{headers:{'content-type':'image/jpeg'}});
   let body;if(url.pathname.endsWith('/configuration'))body={images:{secure_base_url:'https://image.tmdb.org/t/p/'}};
   else if(url.pathname.endsWith('/search/movie'))body={page:1,results:[{id:550,title:movie.title,original_title:movie.original_title,release_date:movie.release_date}],total_pages:1,total_results:1};
   else if(url.pathname.endsWith('/movie/550'))body=movie;
   else if(url.pathname.endsWith('/movie/550/images'))body={id:550,posters:[{file_path:'/poster.jpg'}],backdrops:[{file_path:'/fanart.jpg'}]};
   else throw new Error('Unexpected TMDB fixture route '+url.pathname);
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  }};
  async function openHost(){return scenario==='reset_recovery'?require('../helpers/fresh-reset-supervisor').createFreshResetTestHost(hostOptions,{
    workspaceRoots:[path.join(root,'workspace'),path.join(root,'configured-workspace')],protectedDirectories:[source,target]}):createCleanServiceHost(hostOptions);}
  host=await openHost();
  db=new Database(path.join(dataDir,'shelfdeck.db'));
  const auth=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(auth.statusCode,204);let cookie=auth.headers['set-cookie'];
  async function request(method,url,payload){const response=await host.inject({method,url,headers:{cookie},payload});assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response.json();}
  const proof=await request('POST','/v1/admin/settings/integrations/tmdb/actions/test',{kind:'tmdb',idempotencyKey:'test-provider',endpoint:'https://api.themoviedb.org/3',credential:{kind:'api_key',value:'disposable-edition-key'},settings:{language:'zh-CN',proxyServer:''},timeoutMs:5000});
  await request('PATCH','/v1/admin/settings/integrations/tmdb',{kind:'tmdb',idempotencyKey:'save-provider',expectedConfigRevision:0,connectionProofId:proof.connectionProofId});
  await request('POST','/v1/admin/shelves',{idempotencyKey:'shelf',shelfId:'shelf',name:'Editions',targetRootLocation:target,ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,
   placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full',{idempotencyKey:'settlement',expectedRevision:0,coverExclusiveRelatedInput:true});
  const fieldId='field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},access={fieldId,revision:1,endpointId:'source',rootLocation:source,mountScopeId:'source-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/edition-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'field',fieldId,name:'Editions',contentProfileHint:'movie',policy:{extractionPolicyId:'policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:canonicalDigest({extractionPolicyId:'policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
  await request('PATCH','/v1/admin/routing/material-fields/'+fieldId,{idempotencyKey:'routing',fieldId,expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'routing',mode:'direct',targets:[{shelfId:'shelf',rank:1,matchExpression:{nodeKind:'always'}}]}});
  async function scan(key){const field=(await request('GET','/v1/admin/material-fields')).items[0];await request('POST','/v1/admin/material-fields/field/actions/observe',{idempotencyKey:key,fieldId,expectedAccessRevision:1,expectedObservationRevision:field.currentObservationRevision||0,pageBudget:8});}
  async function commitCount(count){const deadline=Date.now()+50000;while(Date.now()<deadline){
   if(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===count)return;
   await new Promise(resolve=>setTimeout(resolve,100));}
   assert.fail(JSON.stringify({errors,calls,runs:db.prepare('SELECT state FROM libra_runs').all(),attempts:db.prepare("SELECT failure_code FROM fx_work_attempts WHERE state='failed'").all(),formation:await request('GET','/v1/admin/formation?limit=25')}));}
  if(scenario==='reset_recovery') {
   await request('PATCH','/v1/admin/settings/workspaces',{rootPath:path.join(root,'configured-workspace'),expectedConfigRevision:1,idempotencyKey:'configure-workspace'});
   await host.close();host=await openHost();
   cookie=(await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}})).headers['set-cookie'];
   const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
   const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
   const {createCircuitBreaker}=require('../../src/helix/foundation/diagnostics/pressure-guard');
   const {createExecutorIncidentRegistry}=require('../../src/helix/foundation/execution/executor-incident-registry');
   const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
   const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
   incidentKernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaManifest,schemaDdl:fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8')});
   const unitOfWork=createSqliteUnitOfWork({kernel:incidentKernel}),breaker=createCircuitBreaker({schemaManifest,unitOfWork});
   const registry=createExecutorIncidentRegistry({schemaManifest,unitOfWork,circuitBreaker:breaker});
   const scope={ownerDomain:'libra',processType:'libra_run',workKind:'workspace_media_production',errorCode:'LIBRA_MEDIA_FFMPEG_TIMEOUT'};
   for(let i=0;i<3;i++)registry.recordFailure({...scope,occurrenceId:'fixture-timeout-'+i});
   registry.prepareExecution([scope],'fixture-reservation-gate');
   encode('Collection Movie (2024).mkv','aac');await scan('before-reset');
   const deadline=Date.now()+45000;let work;
   while(Date.now()<deadline){work=db.prepare("SELECT * FROM fx_supporting_works WHERE work_kind='workspace_media_production' AND state='running'").get();if(work)break;await new Promise(resolve=>setTimeout(resolve,50));}
   assert.ok(work,JSON.stringify({errors,runs:db.prepare('SELECT state FROM libra_runs').all()}));
   await request('POST','/v1/admin/runtime/actions/stop',{idempotencyKey:'stop-for-reset'});
   async function waitRuntime(mode,operationComplete=false){const end=Date.now()+45000;while(Date.now()<end){const runtime=await request('GET','/v1/admin/runtime');
    assert.notEqual(runtime.mode,'error',JSON.stringify(runtime.error));if(runtime.mode===mode&&(!operationComplete||runtime.operation?.state==='completed'))return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Runtime did not reach '+mode);}
   await waitRuntime('stopped');
   assert.equal(registry.abandonExecution('fixture-reservation-gate'),1);
   assert.equal(registry.prepareExecution([scope],work.work_id).allowed,true);
   incidentKernel.close();incidentKernel=null;db.close();db=null;
   const preview=await request('GET','/v1/admin/runtime/reset-preview');assert.equal(preview.ready,true,JSON.stringify(preview.blockers));
   await request('POST','/v1/admin/runtime/actions/reset',{idempotencyKey:'reset-recovery-owner',previewDigest:preview.previewDigest,confirmed:true});
   await waitRuntime('stopped',true);
   db=new Database(path.join(dataDir,'shelfdeck.db'));
   assert.equal(db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE work_id=?').get(work.work_id).n,0);
   assert.equal(db.prepare('SELECT count(*) n FROM fx_executor_incidents').get().n,0,'unrelated incident history leaves the online generation');
   assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
   db.close();db=null;await host.close();host=await openHost();db=new Database(path.join(dataDir,'shelfdeck.db'));
   cookie=(await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}})).headers['set-cookie'];
   assert.equal((await request('GET','/v1/admin/runtime')).mode,'stopped');
   assert.equal(db.prepare('SELECT count(*) n FROM proc_candidate_packages').get().n,0,'stopped startup cannot repopulate procurement');
   await request('POST','/v1/admin/runtime/actions/resume',{idempotencyKey:'resume-after-reset'});await waitRuntime('running');
   await scan('after-reset');await commitCount(1);
   assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1,'only a new real media Commit proves recovery');
   assert.equal(db.prepare("SELECT count(*) n FROM fx_workflow_events e JOIN fx_supporting_works w USING(work_id) WHERE w.work_kind='workspace_media_production' AND w.work_id<>? AND e.state='succeeded'").get(work.work_id).n>0,true);
   assert.deepEqual(db.pragma('foreign_key_check'),[]);
   return;
  }
  if(scenario==='handoff_read_fence_race'){
   encode('Collection Movie (2024).mkv','aac');await scan('race');const deadline=Date.now()+60000;
   while(!fenceProof&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
   assert.ok(fenceProof,JSON.stringify({errors,calls}));assert.equal(fenceProof.code,'P3_UOW_READ_FENCE_CHANGED');
   assert.equal(fenceProof.after,fenceProof.before,'Stale cross-Owner view cannot transfer Control or create any Acceptance fact');
   assert.deepEqual(db.pragma('foreign_key_check'),[]);return;
  }
  encode('Collection Movie (2024).mkv','aac');await scan('first');await commitCount(1);
  const first=db.prepare("SELECT m.* FROM arca_inventory_materials m JOIN arca_shelf_entries e USING(shelf_entry_id) WHERE m.inventory_revision=e.current_inventory_revision AND m.role='primary_payload'").get();
  const firstBytes=fs.readFileSync(first.location),firstReceipt=db.prepare('SELECT * FROM arca_ondeck_commit_receipts').get();
  encode('Collection Movie (2024) - 1080p FLAC.mkv','flac');
  fs.writeFileSync(path.join(source,'Collection Movie (2024) - 1080p FLAC.nfo'),'<movie><title>Collection Movie</title><year>2024</year><uniqueid type="tmdb" default="true">550</uniqueid></movie>');
  await scan('second');await commitCount(2);
  const collection=await request('GET','/v1/admin/collection?limit=24');assert.equal(collection.items.length,2);
  assert.equal(db.prepare('SELECT count(DISTINCT subject_id) n FROM libra_runs').get().n,2);
  assert.deepEqual(db.prepare('SELECT * FROM arca_ondeck_commit_receipts WHERE receipt_id=?').get(firstReceipt.receipt_id),firstReceipt);
  assert.deepEqual(fs.readFileSync(first.location),firstBytes);
  const primaries=db.prepare("SELECT m.location FROM arca_inventory_materials m JOIN arca_shelf_entries e USING(shelf_entry_id) WHERE m.inventory_revision=e.current_inventory_revision AND m.role='primary_payload'").all();
  assert.equal(new Set(primaries.map(row=>path.dirname(row.location))).size,2);assert.ok(primaries.some(row=>path.dirname(row.location).includes('1080p FLAC')));
  assert.ok(calls.some(route=>route.endsWith('/search/movie')));assert.ok(calls.some(route=>route.endsWith('/poster.jpg')));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{await host?.close();db?.close();incidentKernel?.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
