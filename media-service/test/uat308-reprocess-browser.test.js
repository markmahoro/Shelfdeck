'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const sharp=require('sharp');
const {chromium,expect}=require('../web/node_modules/@playwright/test');
const {initializeCleanData}=require('../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../src/clean-service-host');
const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const {createTmdbProviderAdapter}=require('../src/helix/integrations/tmdb-provider-adapter');

const digest=value=>canonicalDigest({value});
function handle(operation='libra.routing.fact.observe@1'){return {schemaRef:'helix://contracts/types/IntegrationHandle/v1',schemaVersion:1,
  handleId:'uat308-handle',integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,secretRef:'fixture-secret',
  allowedOperation:operation,expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:digest(operation)};}

function qualifiedComputeRuntime(){
  const capabilityPayload={supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound'],validatedConcurrentSlots:1,
    validatedVideoPipelines:[{pipelineProfileId:'ordinary_to_hevc@1',inputDynamicRangeKinds:['sdr'],inputPixelFormats:['yuv420p'],
      outputCodec:'hevc',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
      outputColorProfile:{range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'},selfTestDigest:digest('qualified-pipeline')}]};
  const capabilityDigest=canonicalDigest(capabilityPayload),body={deviceId:'uat308-cpu',deviceClass:'software_cpu',probeRevision:1,
    capabilitySchemaRef:'platform.compute-device-capability@1',capabilityPayload,capabilityDigest,enabled:true,state:'ready',workerRef:null};
  const snapshot={...body,snapshotDigest:canonicalDigest(body)},ref={deviceId:body.deviceId,deviceClass:body.deviceClass,probeRevision:1,capabilityDigest};
  return {listReadyDeviceRefs(query){const result={queryDigest:query.queryDigest,resultKind:'available',items:[{...ref,refDigest:canonicalDigest(ref)}]};
      return {...result,resultDigest:canonicalDigest(result)};},readDeviceSnapshot(query){
      assert.equal(query.deviceId,body.deviceId);assert.equal(query.expectedProbeRevision,1);assert.equal(query.expectedCapabilityDigest,capabilityDigest);
      const result={queryDigest:query.queryDigest,resultKind:'found',snapshot};return {...result,resultDigest:canonicalDigest(result)};}};
}

test('UAT-308 shows a real reprocess scan conflict and replays the persisted intent',
  {skip:process.env.HELIX_UAT308_BROWSER!=='1',timeout:180000},async t=>{
  const output=process.env.HELIX_UAT308_OUTPUT;
  assert.ok(output&&path.isAbsolute(output),'Provide an absolute browser evidence directory.');
  fs.mkdirSync(output,{recursive:true});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-uat308-'));
  let host,browser,db,releaseScan,holdScan=false;
  t.after(async()=>{holdScan=false;releaseScan?.();await browser?.close();await host?.close();db?.close();
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-uat308-'));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),sourceRoot=path.join(root,'source');
  const source=path.join(sourceRoot,'Demo Show (2020)','Season 01'),target=path.join(root,'shelf');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(target);
  fs.cpSync(path.resolve(__dirname,'../dist/admin'),adminDistDir,{recursive:true});
  const files=[1,2].map(number=>path.join(source,'Demo Show.S01E0'+number+'.mkv'));
  const protectedFile=path.join(root,'protected.txt');fs.writeFileSync(protectedFile,'outside-settlement-scope');
  files.forEach((file,index)=>fs.writeFileSync(file,'uat308-episode-'+index));
  const before=files.map(file=>({bytes:fs.readFileSync(file),stat:fs.statSync(file)}));
  const sourceIntact=()=>files.forEach((file,index)=>{
    assert.deepEqual(fs.readFileSync(file),before[index].bytes);
    const current=fs.statSync(file);
    for(const key of ['ino','mtimeMs','ctimeMs'])assert.equal(current[key],before[index].stat[key],key);
  });
  const secretRoot='uat308-disposable-secret-root-at-least-32-bytes';
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const adapter=createTmdbProviderAdapter({
    integrationQueryPort:{query:()=>({state:'active',integrationType:'tmdb',integrationId:'tmdb-main',configRevision:1,
      endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_access_token',secretRef:'fixture-secret',settings:{language:'zh-CN'}})},
    integrationHandleResolverPort:{resolve:request=>handle(request.allowedOperation)},
    secretLeaseResolverPort:{resolve:()=>({leaseId:'fixture-lease'})},
    secretLeaseConsumer:{consumeAsync:async(_lease,consume)=>consume(Buffer.from('disposable-secret'))},
    fetchImpl:async url=>{
      const episodes=[1,2].map(number=>({id:63000+number,show_id:1399,season_number:1,episode_number:number,
        name:'Episode '+number,overview:'Episode '+number+' plot',air_date:'2020-01-01'}));
      const value=url.pathname.endsWith('/search/tv')?{results:[{id:1399,name:'Demo Show'}]}:
        url.pathname.includes('/season/')?{id:3623,season_number:1,episodes}:
        {id:1399,name:'Demo Show',original_name:'Demo Show',first_air_date:'2020-01-01',origin_country:['US'],
          genres:[{id:18,name:'Drama'}],overview:'Series plot',credits:{cast:[{id:1001,name:'Fixture Actor'}],crew:[]}};
      return new Response(JSON.stringify(value),{status:200});
    }});
  const poster=await sharp({create:{width:4,height:6,channels:3,background:'#224466'}}).jpeg().toBuffer();
  let runtimeError;
  const nativeEnumerator=require('../src/clean-field-observation-enumerator').createCleanFieldObservationEnumerator();
  host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,
    platformComputeRuntime:qualifiedComputeRuntime(),
    fieldObservationEnumerator:{async enumeratePage(value){if(holdScan)await new Promise(resolve=>{releaseScan=resolve;});return nativeEnumerator.enumeratePage(value);}},
    mediaProbe:{async probe(readHandle){const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),container:'matroska',durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',codecProfile:'main',dispositionDefault:true,width:1920,height:1080,
        pixelFormat:'yuv420p',bitDepth:8,chroma:'4:2:0',colorRange:'limited',colorPrimaries:'bt709',
        colorTransfer:'bt709',colorMatrix:'bt709',dynamicRangeKind:'sdr'}],
      audioStreams:[],subtitleStreams:[],discTopology:null};return {...body,payloadDigest:canonicalDigest(body)};}},
    mediaProductionEffectPort:{async verifyPlayback(){return {samplePointsPercent:[5,50,95],passedSamplePointsPercent:[],decodeDigest:digest('decode')};},
      async executeRemux(){throw new Error('Direct fixture must not Remux.');},async executeTranscode(){throw new Error('Direct fixture must not Transcode.');},
      async verifyTranscodeInput(){throw Object.assign(new Error('Fixture video tool failure'),{code:'LIBRA_MEDIA_FFMPEG_FAILED'});}},
    routingIntegrationHandleResolver:request=>handle(request.operationId),
    routingProviderObservation:request=>adapter.observationPort.execute({operationId:request.operationId||'libra.routing.fact.observe@1',integrationHandle:request.integrationHandle,
      timeoutMs:1000,input:{contentProfile:request.intent.contentProfile,title:request.intent.candidateDisplayTitle,yearHint:request.intent.yearHint,
        strongProviderKey:request.intent.strongProviderAnchor?.providerKey??null,seasonNumber:request.intent.seasonNumber}}),
    productIntegrationHandleResolver:request=>handle(request.operationId),currentProductIntegrationHandleResolver:request=>handle(request.operationId),
    productProviderMetadataFetch:request=>adapter.observationPort.execute({operationId:'libra.product_metadata.fetch@1',
      integrationHandle:request.integrationHandle,timeoutMs:1000,input:{resolvedProviderIdentity:request.metadataFetchIntent.resolvedProviderIdentity,
        requestedFields:request.metadataFetchIntent.requestedFields,...(request.metadataFetchIntent.episodeScope?{episodeScope:request.metadataFetchIntent.episodeScope}:{})}}),
    productProviderArtifactFetch:async request=>({resultKind:'acquired',bytes:poster,artifactKind:request.artifactKind,
      integrationId:request.integrationHandle.integrationId,configRevision:request.integrationHandle.configRevision,
      mediaType:'image/jpeg',resolvedProviderIdentity:request.resolvedProviderIdentity}),onExecutionRuntimeError:error=>{
      runtimeError=error;fs.appendFileSync(path.join(output,'runtime-errors.log'),JSON.stringify({code:error.code,message:error.message})+'\n');}});
  db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
  const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});
  assert.equal(login.statusCode,204);
  const cookie=login.headers['set-cookie'];
  async function request(method,url,payload){const result=await host.inject({method,url,headers:{cookie},payload});
    assert.ok(result.statusCode>=200&&result.statusCode<300,result.body);return result.json();}
  const policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  const access={fieldId:'uat308-field',revision:1,endpointId:'uat308-endpoint',rootLocation:sourceRoot,
    mountScopeId:'uat308-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/uat308-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'uat308-field',fieldId:'uat308-field',name:'UAT-308 source',contentProfileHint:'series',
    policy:{extractionPolicyId:'uat308-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
      policyDigest:canonicalDigest({extractionPolicyId:'uat308-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
  await request('POST','/v1/admin/shelves',{idempotencyKey:'uat308-shelf',shelfId:'uat308-shelf',name:'UAT-308 shelf',targetRootLocation:target,
    ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,
    placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',
      posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  await request('PATCH','/v1/admin/routing/material-fields/uat308-field',{idempotencyKey:'uat308-routing',fieldId:'uat308-field',expectedPolicyId:null,
    expectedRevision:0,policy:{routingPolicyId:'uat308-routing',mode:'sorting',targets:[{shelfId:'uat308-shelf',rank:1,
      matchExpression:{nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2020}}]}});
  await request('PATCH','/v1/admin/formation/defect-authorization',{enabled:true,expectedRevision:0,
    idempotencyKey:'uat308-terminal-policy',acknowledged:true});
  await request('POST','/v1/admin/material-fields/uat308-field/actions/observe',{idempotencyKey:'uat308-observe',fieldId:'uat308-field',
    expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  const until=Date.now()+90000;
  while(!db.prepare("SELECT count(*) n FROM libra_run_outcomes WHERE reason_code='processing_failed'").get().n&&Date.now()<until){
    assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,100));
  }
  const previous=db.prepare("SELECT * FROM libra_run_outcomes WHERE reason_code='processing_failed'").get();
  if(!previous)t.diagnostic(JSON.stringify({runs:db.prepare('SELECT state FROM libra_runs').all(),
    works:db.prepare('SELECT work_kind,state FROM fx_supporting_works').all(),
    failures:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
  assert.ok(previous,'A real failed Run must close through its owning lifecycle.');
  sourceIntact();assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
  const address=await host.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.setDefaultTimeout(15000);
  await page.goto(address+'/formation');await page.getByLabel('管理凭据',{exact:true}).fill(initialized.adminApiKey);
  await page.getByRole('button',{name:'进入管理台',exact:true}).click();
  await page.getByRole('button',{name:/^已结束/}).click();
  const processButton=page.getByRole('button',{name:'查看过程',exact:true});await processButton.focus();await page.keyboard.press('Enter');
  const reprocess=page.getByRole('button',{name:'重新整理',exact:true});await expect(reprocess).toBeVisible();
  holdScan=true;
  const current=(await request('GET','/v1/admin/material-fields')).items.find(item=>item.fieldId==='uat308-field');
  const occupied=await request('POST','/v1/admin/material-fields/uat308-field/actions/observe',{
    idempotencyKey:'uat308-busy-observation',fieldId:'uat308-field',expectedAccessRevision:current.currentAccessRevision,
    expectedObservationRevision:current.currentObservationRevision,pageBudget:8});
  await reprocess.focus();await page.keyboard.press('Enter');
  const confirmation=page.getByRole('dialog',{name:'确认重新整理',exact:true});
  await expect(confirmation).toBeVisible();
  const endpoint='/v1/admin/formation/runs/'+previous.libra_run_id+'/actions/reprocess';
  const pending=page.waitForResponse(value=>new URL(value.url()).pathname===endpoint&&value.request().method()==='POST');
  await confirmation.getByRole('button',{name:'确认重新整理',exact:true}).click();
  const conflict=await pending;
  assert.equal(conflict.status(),409);
  assert.equal((await conflict.json()).error.details.reasonCode,'FIELD_OBSERVATION_WORK_DEFERRED');
  const originalRequest=conflict.request().postDataJSON();
  const intent=db.prepare('SELECT * FROM libra_reprocess_intents').get();
  assert.ok(intent);assert.equal(db.prepare('SELECT count(*) n FROM libra_reprocess_intents').get().n,1);
  assert.equal(intent.idempotency_key,originalRequest.idempotencyKey);
  for(const [name,width,height] of [['desktop',1920,1080],['narrow',390,844]]){
    await page.setViewportSize({width,height});
    await expect(confirmation.getByRole('alert')).toHaveText('来源扫描尚未结束，稍后再试。');
    await expect(confirmation.getByRole('button',{name:'确认重新整理',exact:true})).toBeEnabled();
    assert.ok(await confirmation.evaluate(element=>element.scrollWidth<=element.clientWidth));
    await page.screenshot({path:path.join(output,'01-conflict-'+name+'.png'),fullPage:true});
  }
  await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(reprocess).toBeFocused();
  sourceIntact();assert.deepEqual(db.prepare('SELECT * FROM libra_reprocess_intents').get(),intent);
  holdScan=false;releaseScan?.();
  assert.ok(occupied.observation.observationWorkId);
  await expect.poll(()=>db.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(occupied.observation.observationWorkId)?.state,
    {timeout:30000}).toBe('succeeded');
  await reprocess.focus();await page.keyboard.press('Enter');
  const resumed=page.waitForResponse(value=>new URL(value.url()).pathname===endpoint&&value.request().method()==='POST');
  await confirmation.getByRole('button',{name:'确认重新整理',exact:true}).click();
  const accepted=await resumed;assert.equal(accepted.status(),202);
  assert.deepEqual(accepted.request().postDataJSON(),originalRequest);
  const result=await accepted.json();assert.equal(result.intentId,intent.intent_id);assert.equal(result.replayed,true);
  await expect(page.getByText('已提交重新整理',{exact:true})).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  const replay=await page.request.post(address+endpoint,{data:originalRequest});assert.equal(replay.status(),202);
  const replayResult=await replay.json();assert.equal(replayResult.intentId,intent.intent_id);
  assert.equal(replayResult.observations[0].observationWorkId,result.observations[0].observationWorkId);
  assert.deepEqual(db.prepare('SELECT * FROM libra_reprocess_intents').get(),intent);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_reprocess_intents').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_supporting_works WHERE idempotency_key=?').get('libra-reprocess:'+intent.intent_id).n,1);
  assert.deepEqual(db.prepare('SELECT * FROM libra_run_outcomes WHERE libra_run_id=?').get(previous.libra_run_id),previous);
  sourceIntact();assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
  await page.screenshot({path:path.join(output,'02-replayed-narrow.png'),fullPage:true});
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  t.diagnostic(JSON.stringify({initialStatus:409,replayStatus:202,intents:1,observationWorksForIntent:1,originalSourcePreserved:true}));
});
