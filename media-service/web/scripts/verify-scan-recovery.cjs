'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../..'),service=path.join(repo,'media-service');
const {chromium,expect}=require(path.join(service,'web/node_modules/@playwright/test'));
const {initializeCleanData}=require(path.join(service,'scripts/helix-operational-safety'));
const {createCleanServiceHost}=require(path.join(service,'src/clean-service-host'));
const {createCleanFieldObservationEnumerator}=require(path.join(service,'src/clean-field-observation-enumerator'));
const {canonicalDigest}=require(path.join(service,'src/helix/contracts/canonical-json'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-scan-browser-'));
const evidence=path.join(repo,'.codex/scan-repair');
fs.mkdirSync(evidence,{recursive:true});
async function main(){
  const dataDir=path.join(root,'data'),source=path.join(root,'source'),secretRoot='isolated-scan-browser-secret-root-20260912';
  fs.mkdirSync(source);for(const name of ['First.Movie.2024.mkv','Second.Movie.2024.mkv'])fs.writeFileSync(path.join(source,name),'isolated material');
  const init=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  let fail=true,release,runtimeError;
  const gate=new Promise(r=>{release=r;});
  const enumerator=createCleanFieldObservationEnumerator({batchLimit:1});
  const host=await createCleanServiceHost({dataDir,secretRoot,adminDistDir:path.join(service,'dist/admin'),
    fieldObservationEnumerator:{async enumeratePage(input){if(fail)throw Object.assign(new Error('Expired fixture handle'),{code:'P7_FIELD_ACCESS_EXPIRED'});await gate;return enumerator.enumeratePage(input);}},
    mediaProbe:{async probe(handle){const result={resultKind:'probed',sourceHandleDigest:canonicalDigest(handle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};return {...result,payloadDigest:canonicalDigest(result)};}},
    onExecutionRuntimeError(error){runtimeError=error;}});
  let browser;
  try{
    const auth=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':init.adminApiKey}});
    const cookie=auth.headers['set-cookie'];
    async function request(method,url,payload){const r=await host.inject({method,url,headers:{cookie},payload});assert.ok(r.statusCode>=200&&r.statusCode<300,r.body);return r.json();}
    const fieldId='scan-browser-field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
    const access={fieldId,revision:1,endpointId:'browser-endpoint',rootLocation:source,mountScopeId:'browser-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/scan-access/v1'};
    await request('POST','/v1/admin/material-fields',{idempotencyKey:'register',fieldId,name:'电影文件来源',contentProfileHint:'movie',
      policy:{extractionPolicyId:'browser-policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:canonicalDigest({extractionPolicyId:'browser-policy',revision:1,...policy})},
      access:{...access,accessDigest:canonicalDigest(access)}});
    await request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{idempotencyKey:'seats',predeckPipelineSeats:0});
    await request('POST',`/v1/admin/material-fields/${fieldId}/actions/observe`,{idempotencyKey:'initial-failure',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:256});
    await expect.poll(async()=>(await request('GET','/v1/admin/material-fields')).items[0].procurementStatus.observationScan.state,{timeout:20000}).toBe('failed');
    const address=await host.listen({host:'127.0.0.1',port:0});
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080}});
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(address+'/admin/material-fields');
    await page.getByLabel('管理凭据').fill(init.adminApiKey);await page.getByRole('button',{name:'进入管理台',exact:true}).click();
    await page.getByRole('link',{name:'文件来源',exact:true}).click();
    const summary=page.locator('.source-operating-detail summary');await expect(summary).toContainText('扫描失败');
    await summary.focus();await page.keyboard.press('Enter');
    await expect(page.getByText('扫描超时',{exact:true})).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(1);
    await page.screenshot({path:path.join(evidence,'scan-failed-desktop.png'),fullPage:true});
    fail=false;const scan=page.getByRole('button',{name:'扫描新文件',exact:true});await scan.focus();await page.keyboard.press('Enter');
    await expect(summary).toContainText('正在扫描');await expect(scan).toBeDisabled();await expect(page.getByText('扫描超时',{exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(evidence,'scan-running-desktop.png'),fullPage:true});
    release();await expect(summary).toContainText('已扫描完成',{timeout:20000});await expect(scan).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByText('2 页',{exact:true})).toBeVisible();
    await page.screenshot({path:path.join(evidence,'scan-complete-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await scan.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await expect(scan).toBeVisible();await summary.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
    await expect(page.getByText('2 页',{exact:true})).toBeVisible();await page.getByRole('heading',{name:'文件来源',exact:true}).click();
    await page.screenshot({path:path.join(evidence,'scan-complete-narrow.png'),fullPage:true});
    await page.setViewportSize({width:1920,height:1080});
    // The missing-reason presentation is checked with a read-only response fixture.
    // Owner projection coverage for unknown/missing failure codes lives in the service tests.
    await page.route('**/v1/admin/material-fields',async route=>{
      const response=await route.fetch(),body=await response.json();
      body.items[0].procurementStatus.observationScan={state:'failed',pageCount:0,observationRevision:2,inProgress:false,failureCode:'UNRECOGNIZED_SCAN_FAILURE'};
      await route.fulfill({response,json:body});
    });
    await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(summary).toContainText('扫描失败');
    await expect(page.getByText('扫描失败',{exact:true})).toHaveCount(1);await expect(page.getByRole('alert')).toHaveCount(0);await expect(scan).toBeEnabled();
    await page.screenshot({path:path.join(evidence,'scan-unknown-desktop.png'),fullPage:true});
    assert.deepEqual(pageErrors,[]);assert.ifError(runtimeError);
    const result={passed:true,desktop:'1920x1080',narrow:'390x844',states:['failed','scanning','completed'],missingReasonResponseFixture:true,keyboard:true,pageErrors};
    fs.writeFileSync(path.join(evidence,'browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{release();await browser?.close();await host.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
