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
  handleId:'uat289-handle',integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,secretRef:'fixture-secret',
  allowedOperation:operation,expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:digest(operation)};}

test('UAT-289 guides an actual Series settlement wait to explicit authorization without granting on navigation',
  {skip:process.env.HELIX_UAT289_BROWSER!=='1',timeout:180000},async t=>{
  const output=process.env.HELIX_UAT289_OUTPUT;
  assert.ok(output&&path.isAbsolute(output),'Provide an absolute browser evidence directory.');
  fs.mkdirSync(output,{recursive:true});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-uat289-'));
  let host,browser,db;
  t.after(async()=>{await browser?.close();await host?.close();db?.close();
    assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-uat289-'));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),sourceRoot=path.join(root,'source');
  const source=path.join(sourceRoot,'Demo Show (2020)','Season 01'),target=path.join(root,'shelf');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(target);
  fs.cpSync(path.resolve(__dirname,'../dist/admin'),adminDistDir,{recursive:true});
  const files=[1,2].map(number=>path.join(source,'Demo Show.S01E0'+number+'.mkv'));
  const protectedFile=path.join(root,'protected.txt');fs.writeFileSync(protectedFile,'outside-settlement-scope');
  files.forEach((file,index)=>fs.writeFileSync(file,'uat289-episode-'+index));
  const before=files.map(file=>({bytes:fs.readFileSync(file),stat:fs.statSync(file)}));
  const sourceIntact=()=>files.forEach((file,index)=>{
    assert.deepEqual(fs.readFileSync(file),before[index].bytes);
    const current=fs.statSync(file);
    for(const key of ['ino','mtimeMs','ctimeMs'])assert.equal(current[key],before[index].stat[key],key);
  });
  const secretRoot='uat289-disposable-secret-root-at-least-32-bytes';
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
  host=await createCleanServiceHost({dataDir,adminDistDir,secretRoot,
    mediaProbe:{async probe(readHandle){const body={resultKind:'probed',sourceHandleDigest:canonicalDigest(readHandle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],
      audioStreams:[],subtitleStreams:[],discTopology:null};return {...body,payloadDigest:canonicalDigest(body)};}},
    mediaProductionEffectPort:{async verifyPlayback(){return {samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:digest('decode')};},
      async executeRemux(){throw new Error('Direct fixture must not Remux.');},async executeTranscode(){throw new Error('Direct fixture must not Transcode.');},
      async verifyTranscodeInput(){throw new Error('Direct fixture must not assess Transcode.');}},
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
  const access={fieldId:'uat289-field',revision:1,endpointId:'uat289-endpoint',rootLocation:sourceRoot,
    mountScopeId:'uat289-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/uat289-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'uat289-field',fieldId:'uat289-field',name:'UAT-289 source',contentProfileHint:'series',
    policy:{extractionPolicyId:'uat289-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,
      policyDigest:canonicalDigest({extractionPolicyId:'uat289-policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
  await request('POST','/v1/admin/shelves',{idempotencyKey:'uat289-shelf',shelfId:'uat289-shelf',name:'UAT-289 shelf',targetRootLocation:target,
    ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,
    placementPolicy:{folderTemplate:'{title}',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',
      posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  await request('PATCH','/v1/admin/routing/material-fields/uat289-field',{idempotencyKey:'uat289-routing',fieldId:'uat289-field',expectedPolicyId:null,
    expectedRevision:0,policy:{routingPolicyId:'uat289-routing',mode:'sorting',targets:[{shelfId:'uat289-shelf',rank:1,
      matchExpression:{nodeKind:'predicate',factKind:'release_year',operator:'gte',expectedValue:2020}}]}});
  await request('POST','/v1/admin/material-fields/uat289-field/actions/observe',{idempotencyKey:'uat289-observe',fieldId:'uat289-field',
    expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  const address=await host.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.setDefaultTimeout(15000);
  await page.goto(address+'/formation');
  await page.getByLabel('管理凭据',{exact:true}).fill(initialized.adminApiKey);
  await page.getByRole('button',{name:'进入管理台',exact:true}).click();
  try {
    await expect.poll(()=>{assert.ifError(runtimeError);return db.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='arca.ondeck.input_settlement.delete@1' AND state='waiting_for_external'").get().n;},
      {timeout:90000}).toBeGreaterThan(0);
    await expect(page.getByText('等待自动清理授权',{exact:true}).first()).toBeVisible({timeout:45000});
  }
  catch(error){
    await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});
    t.diagnostic(JSON.stringify({runs:db.prepare('SELECT state FROM libra_runs').all(),
      works:db.prepare('SELECT owner_domain,work_kind,state FROM fx_supporting_works').all(),
      attempts:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()}));
    throw error;
  }
  assert.ifError(runtimeError);
  const waiting=db.prepare("SELECT event_id FROM fx_workflow_events WHERE capability_ref='arca.ondeck.input_settlement.delete@1' AND state='waiting_for_external'").all();
  assert.equal(waiting.length,2);
  const ungranted=()=>{sourceIntact();assert.equal(fs.readFileSync(protectedFile,'utf8'),'outside-settlement-scope');assert.equal(db.prepare('SELECT count(*) n FROM arca_input_settlement_authorizations').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
    for(const event of waiting)assert.equal(db.prepare('SELECT count(*) n FROM fx_event_attempts WHERE event_id=?').get(event.event_id).n,0);};
  ungranted();assert.equal(await page.getByRole('columnheader').count(),9);
  await page.screenshot({path:path.join(output,'01-list-desktop.png'),fullPage:true});
  const processButton=page.getByRole('button',{name:'查看过程',exact:true});await processButton.focus();await page.keyboard.press('Enter');
  const detail=page.getByRole('dialog');await expect(detail).toContainText('等待自动清理授权');
  await page.screenshot({path:path.join(output,'02-detail-desktop.png'),fullPage:true});
  await detail.locator('.formation-plan-node[data-state="running"]').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'02-detail-step-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await detail.locator('.formation-plan-node[data-state="running"]').first().scrollIntoViewIfNeeded();
  assert.ok(await detail.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await page.screenshot({path:path.join(output,'02-detail-step-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1920,height:1080});
  await page.keyboard.press('Escape');await expect(processButton).toBeFocused();
  const configuration=page.getByRole('button',{name:'配置自动清理',exact:true});await configuration.focus();await page.keyboard.press('Enter');
  const authorization=page.getByRole('dialog',{name:'自动清理残留文件',exact:true});await expect(authorization).toBeVisible();
  await expect(authorization.getByRole('button',{name:'授权自动清理',exact:true})).toBeEnabled();
  ungranted();await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'03-authorization-narrow.png'),fullPage:true});
  await page.keyboard.press('Escape');await expect(authorization).toHaveCount(0);ungranted();
  await expect(page.getByRole('button',{name:'自动清理残留文件 未授权'})).toBeFocused();
  await page.getByRole('button',{name:'自动清理残留文件 未授权'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();ungranted();
  await page.getByRole('button',{name:'自动清理残留文件 未授权'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'授权自动清理',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(db.prepare('SELECT count(*) n FROM arca_input_settlement_authorizations').get().n,1);
  await page.goto(address+'/formation');
  const until=Date.now()+70000;
  while(!db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n&&Date.now()<until){assert.ifError(runtimeError);await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
  assert.ok(files.every(file=>!fs.existsSync(file)));
  assert.equal(fs.readFileSync(protectedFile,'utf8'),'outside-settlement-scope');
  await page.reload();await expect(page.getByRole('button',{name:'配置自动清理'})).toHaveCount(0);
  await page.goto(address+'/collection');await page.getByRole('button',{name:/查看.*详情.*第 1 季/}).click();
  await expect(page.getByRole('heading',{name:'第 1 季 · 已收藏 2 集',exact:true})).toBeVisible();
  await page.getByRole('region',{name:'已收藏剧集'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'04-committed-narrow.png'),fullPage:true});
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  t.diagnostic(JSON.stringify({waitingEvents:waiting.length,ungrantedAttempts:0,authorizationCount:1,commitCount:1,episodes:2}));
});
