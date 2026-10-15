import { expect, test } from '@playwright/test';

test('shared secondary capacity can stop new transfers and grow again while retaining occupancy', async ({ page }, testInfo) => {
  let seats=5;
  let revision=1;
  await page.route('**/v1/**', async route => {
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',revision:1,operation:null,activity:{}}});
    if(path==='/v1/admin/libra/workshops/secondary') {
      if(request.method()==='PATCH') { seats=request.postDataJSON().secondarySeats;revision++; }
      return route.fulfill({json:{secondarySeats:seats,policyRevision:revision,updatedAtMs:1,held:3,free:Math.max(0,seats-3)}});
    }
    if(path==='/v1/admin/settings/workspaces')return route.fulfill({json:{current:{rootPath:'/workspace',configRevision:1},pending:null,restartRequired:false}});
    if(path.includes('/settings/integrations/'))return route.fulfill({json:{configured:false,configRevision:0,settings:{}}});
    return route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/settings');
  await page.getByRole('tab',{name:'整理空间',exact:true}).click();
  const capacity=page.getByRole('spinbutton',{name:'共享暂存容量（0–32）'});
  await expect(page.getByText('已占用 3 / 5',{exact:true})).toBeVisible();
  await capacity.fill('33');
  await expect(page.getByText('请输入 0–32 的整数。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存暂存容量'})).toBeDisabled();
  await capacity.fill('0');
  await expect(page.getByText('已有 3 项继续保留',{exact:true})).toBeVisible();
  await capacity.press('Tab');
  await page.getByRole('button',{name:'保存暂存容量'}).press('Enter');
  await expect(page.getByText('停止新增转入',{exact:true})).toBeVisible();
  await expect(page.getByText('已占用 3 项',{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('secondary-zero.png'),fullPage:true});
  await capacity.fill('32');
  await page.getByRole('button',{name:'保存暂存容量'}).click();
  await expect(page.getByText('已占用 3 / 32',{exact:true})).toBeVisible();
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({path:testInfo.outputPath('secondary-expanded.png'),fullPage:true});
});
