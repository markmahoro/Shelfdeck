import {expect,test} from '@playwright/test';

test('one global proxy and bulk JAV activation retain partial failures and support retry',async({page},testInfo)=>{
  let networkRevision=0,proxy='',failJavDb=true;const states:Record<string,any>={};const writes:any[]=[];
  await page.route('**/v1/**',async route=>{
    const req=route.request(),p=new URL(req.url()).pathname;
    if(p==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',revision:1,activity:{}}});
    const match=/\/settings\/integrations\/([^/]+)(\/actions\/test)?$/.exec(p);
    if(match){const kind=match[1],body=req.method()==='GET'?null:req.postDataJSON();
      if(kind==='network'){
        if(body){proxy=body.settings.proxyServer;networkRevision++;writes.push({kind,body});}
        return route.fulfill({json:{kind,configured:networkRevision>0,configRevision:networkRevision,settings:{proxyServer:proxy}}});
      }
      if(match[2]){
        expect(body).not.toHaveProperty('settings.networkRoute');
        if(kind==='jav-javdb'&&failJavDb)return route.fulfill({status:502,json:{error:{code:'PLATFORM_INTEGRATION_HTTP_FAILED',message:'upstream-private',details:{reasonCode:'JAV_SOURCE_ACCESS_DENIED',status:403}}}});
        return route.fulfill({json:{connectionProofId:kind,expiresAtMs:Date.now()+60000}});
      }
      if(body){writes.push({kind,body});states[kind]={kind,configured:true,configRevision:(states[kind]?.configRevision||0)+1};}
      return route.fulfill({json:states[kind]||{kind,configured:kind==='tmdb',configRevision:kind==='tmdb'?1:0,endpoint:null,settings:kind==='tmdb'?{language:'zh-CN',proxyServer:'http://proxy.test:7890'}:{}}});
    }
    return route.fulfill({json:{items:[],counts:{},nextCursor:null,completionState:'complete'}});
  });
  await page.goto('/settings');
  await expect(page.getByRole('heading',{name:'网络代理',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'代理服务器',exact:true})).toHaveCount(1);
  const proxyInput=page.getByRole('textbox',{name:'代理服务器',exact:true});await expect(proxyInput).toHaveValue('http://proxy.test:7890');
  await proxyInput.fill('http://user:pass@proxy.test');await expect(page.getByRole('button',{name:'保存网络设置'})).toBeDisabled();
  await proxyInput.fill('http://proxy.test:7890');await proxyInput.press('Tab');await page.getByRole('button',{name:'保存网络设置'}).press('Enter');
  await expect(page.getByText('全站使用代理',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'一键测试并启用'}).click();
  await expect(page.getByText('7 / 8 已启用',{exact:true})).toBeVisible();
  await expect(page.getByText('站点拒绝访问（HTTP 403）',{exact:true})).toBeVisible();
  expect(await page.getByText('upstream-private').count()).toBe(0);
  await page.screenshot({path:testInfo.outputPath('network-jav-partial.png'),fullPage:true});
  failJavDb=false;await page.getByRole('button',{name:'一键测试并启用'}).click();
  await expect(page.getByText('8 / 8 已启用',{exact:true})).toBeVisible();
  expect(writes.filter(x=>x.kind==='network')).toHaveLength(1);
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({path:testInfo.outputPath('network-jav-success.png'),fullPage:true});
});

test('failed settings reads stay unknown and can be retried without claiming disabled sources',async({page},testInfo)=>{
  let failed=true;
  await page.route('**/v1/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',revision:1,activity:{}}});
    if(p.includes('/settings/integrations/')){
      if(failed)return route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Unavailable'}}});
      return route.fulfill({json:{configured:false,configRevision:0,settings:{}}});
    }
    return route.fulfill({json:{items:[],counts:{},nextCursor:null}});
  });
  await page.goto('/settings');const network=page.getByRole('region',{name:'网络代理',exact:true}),jav=page.getByRole('region',{name:'JAV 资料来源',exact:true});
  await expect(network.getByText('读取失败',{exact:true})).toBeVisible();await expect(jav.getByText('状态读取失败',{exact:true})).toBeVisible();
  await expect(jav.getByText('状态未知',{exact:true})).toHaveCount(8);await expect(jav.getByText('0 / 8 已启用')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('network-jav-read-failure.png'),fullPage:true});
  failed=false;await network.getByRole('button',{name:'重新读取'}).click();await jav.getByRole('button',{name:'重新读取'}).click();
  await expect(network.getByText('未配置',{exact:true})).toBeVisible();await expect(jav.getByText('0 / 8 已启用',{exact:true})).toBeVisible();
  await expect(jav.getByRole('button',{name:'一键测试并启用'})).toBeEnabled();
});
