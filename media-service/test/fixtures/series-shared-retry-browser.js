'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,expect}=require('../../web/node_modules/@playwright/test');
async function retry({host,apiKey,poster,fanart,output}){
  assert.ok(path.isAbsolute(output));fs.mkdirSync(output,{recursive:true});
  const address=await host.listen({host:'127.0.0.1',port:0}),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],posts=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/formation/acceptance/'))posts.push(request.postDataJSON());});
  try{
    await page.goto(address+'/formation');await page.getByLabel('管理凭据',{exact:true}).fill(apiKey);await page.getByRole('button',{name:'进入管理台',exact:true}).click();
    await expect(page.getByRole('button',{name:'重试任务',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'取消整理任务',exact:true})).toHaveCount(0);await page.screenshot({path:path.join(output,'shared-task-attention.png'),fullPage:true});
    await page.getByRole('button',{name:'重试任务',exact:true}).click();const dialog=page.getByRole('dialog',{name:'重试任务',exact:true});
    await dialog.getByLabel(/剧集海报/).setInputFiles({name:'wrong-wide.jpg',mimeType:'image/jpeg',buffer:fanart});
    await dialog.getByRole('button',{name:'重试任务',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('剧集海报需要竖版图片。');assert.equal(posts.length,0);
    await dialog.getByLabel(/剧集海报/).setInputFiles({name:'show-poster.jpg',mimeType:'image/jpeg',buffer:poster});
    await dialog.getByLabel(/剧集背景/).setInputFiles({name:'show-fanart.jpg',mimeType:'image/jpeg',buffer:fanart});
    await expect(dialog.getByRole('alert')).toHaveCount(0);await page.screenshot({path:path.join(output,'shared-retry-upload-wide.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'重试任务',exact:true})).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:path.join(output,'shared-retry-upload-narrow.png'),fullPage:true});
    await dialog.getByRole('button',{name:'重试任务',exact:true}).focus();
    const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/formation/acceptance/'));
    await page.keyboard.press('Enter');const accepted=await response;assert.equal(accepted.status(),202,await accepted.text());
    await expect(dialog).toHaveCount(0);assert.equal(posts.length,1);assert.equal(posts[0].supplementalImages.length,2);assert.deepEqual(errors,[]);
    return {async complete(){await page.setViewportSize({width:1920,height:1080});await page.goto(address+'/collection');await expect(page.getByText('Demo Show',{exact:true}).first()).toBeVisible();
      await page.screenshot({path:path.join(output,'shared-retry-collected.png'),fullPage:true});assert.deepEqual(errors,[]);},async maintain({entry,fanart}){
      await page.setViewportSize({width:1920,height:1080});await page.goto(address+'/collection');
      await page.getByRole('button',{name:new RegExp('查看 '+entry.displayIdentity+' 详情')}).click();
      const detail=page.getByRole('dialog');await expect(detail.getByRole('button',{name:'重试任务',exact:true})).toBeVisible();
      await page.screenshot({path:path.join(output,'shared-maintenance-attention.png'),fullPage:true});
      await detail.getByRole('button',{name:'重试任务',exact:true}).click();const retry=page.getByRole('dialog',{name:'重试任务',exact:true});
      await expect(page.getByRole('dialog')).toHaveCount(1);await retry.getByLabel(/剧集背景/).setInputFiles({name:'replacement-fanart.jpg',mimeType:'image/jpeg',buffer:fanart});
      await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.screenshot({path:path.join(output,'shared-maintenance-retry-narrow.png'),fullPage:true});
      const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/actions/check'));
      await retry.getByRole('button',{name:'重试任务',exact:true}).focus();await page.keyboard.press('Enter');const accepted=await response;
      assert.equal(accepted.status(),202,await accepted.text());assert.equal(accepted.request().postDataJSON().supplementalImages.length,1);await expect(retry).toHaveCount(0);assert.deepEqual(errors,[]);
    },async healthy(entry){await page.setViewportSize({width:1920,height:1080});await page.goto(address+'/collection');await page.getByRole('button',{name:new RegExp('查看 '+entry.displayIdentity+' 详情')}).click();
      await expect(page.getByRole('dialog').getByRole('button',{name:'立即检查健康',exact:true})).toBeEnabled();await expect(page.getByRole('dialog').locator('.health-lamp strong')).toHaveText('健康',{timeout:30000});
      await page.screenshot({path:path.join(output,'shared-maintenance-healthy.png'),fullPage:true});assert.deepEqual(errors,[]);
    },close:()=>browser.close()};
  }catch(error){await page.screenshot({path:path.join(output,'shared-retry-failure.png'),fullPage:true});await browser.close();throw error;}
}
module.exports=Object.freeze({retry});
