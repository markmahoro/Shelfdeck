import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('unknown runtime and another-session changes cannot enable stale Reset confirmation',async({page})=>{
  let mode='stopped',revision=1;
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/admin/runtime'){
      if(revision===1)await new Promise(resolve=>setTimeout(resolve,1200));
      return route.fulfill({json:{mode,desiredMode:mode,revision,normalSupplyAllowed:mode==='running',activity:{},operation:null,error:null,recoveryBackup:null}});
    }
    if(url.pathname==='/v1/admin/runtime/reset-preview')return route.fulfill({json:{previewDigest:'c'.repeat(64),ready:true,empty:false,
      items:[{subjectId:'one',displayIdentity:'待清理电影',contentProfile:'movie'}],counts:{subjects:1},protected:{collectionCount:8},blockers:[]}});
    if(url.pathname==='/v1/admin/overview')return route.fulfill({json:{generatedAt:new Date().toISOString(),systemState:{kind:'running',label:'正常运行',href:'/'},
      metrics:[],todos:[],ledger:[],pipeline:{waitingAcceptanceCount:0,organizingCount:0},setup:{activeMaterialFieldCount:1,activeShelfCount:1},backgroundOperations:null}});
    return route.fulfill({json:{items:[],state:'ready'}});
  });
  await page.goto('/');await expect(page.locator('.rail-status')).toHaveText('正在读取运行状态…');
  await expect(page.getByRole('button',{name:'Reset 整理任务'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Reset 整理任务'})).toBeEnabled();await page.getByRole('button',{name:'Reset 整理任务'}).click();
  await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'确认 Reset'})).toBeEnabled();
  mode='running';revision=2;await expect(page.getByRole('button',{name:'确认 Reset'})).toBeDisabled({timeout:7000});
  await expect(page.getByRole('checkbox')).toBeDisabled();mode='stopped';revision=3;
  await expect(page.getByText('运行状态已变化，请重新核对清单。')).toBeVisible({timeout:7000});
  await page.getByRole('button',{name:'重新核对'}).click();await expect(page.getByRole('checkbox')).toBeEnabled();
  await expect(page.getByRole('checkbox')).not.toBeChecked();await expect(page.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
});

test('overview guides safe stop, exact Reset confirmation and resume',async({page},testInfo)=>{
  let mode='running',resetCount=0;
  const activity={inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0};
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/admin/runtime')return route.fulfill({json:{mode,desiredMode:mode==='running'?'running':'stopped',revision:1,normalSupplyAllowed:mode==='running',activity,operation:resetCount?{operationId:'reset',kind:'reset',state:'completed',result:{removedSubjects:2}}:null,error:null,recoveryBackup:null}});
    if(url.pathname.endsWith('/actions/stop')){mode='stopping';setTimeout(()=>{mode='stopped';},1200);return route.fulfill({status:202,json:{state:'pending',kind:'stop'}});}
    if(url.pathname.endsWith('/actions/resume')){mode='running';return route.fulfill({status:202,json:{state:'pending',kind:'resume'}});}
    if(url.pathname==='/v1/admin/runtime/reset-preview'){await new Promise(resolve=>setTimeout(resolve,450));return route.fulfill({json:{previewDigest:'a'.repeat(64),ready:true,empty:false,items:[{subjectId:'one',displayIdentity:'本地测试电影',contentProfile:'movie'},{subjectId:'two',displayIdentity:'本地测试剧集',contentProfile:'series'}],counts:{subjects:2,runs:2,works:2,workspaces:2},protected:{collectionCount:8,endedRunCount:3},blockers:[]}});}
    if(url.pathname.endsWith('/actions/reset')){expect(route.request().postDataJSON()).toMatchObject({previewDigest:'a'.repeat(64),confirmed:true});resetCount++;return route.fulfill({status:202,json:{state:'pending',kind:'reset'}});}
    if(url.pathname==='/v1/admin/overview')return route.fulfill({json:{generatedAt:new Date().toISOString(),systemState:{kind:'running',label:'正常运行',href:'/'},metrics:[],todos:[],ledger:[],pipeline:{waitingAcceptanceCount:0,organizingCount:0},setup:{activeMaterialFieldCount:1,activeShelfCount:1},backgroundOperations:null}});
    return route.fulfill({json:{items:[],state:'ready',completionState:'complete'}});
  });
  await page.goto('/');await expect(page.getByRole('button',{name:'安全停机',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'安全停机',exact:true}).click();await expect(page.getByRole('region',{name:'运行控制'}).getByText('正在安全停机',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reset 整理任务'})).toBeDisabled();
  await page.screenshot({path:testInfo.outputPath('stopping.png')});
  await expect(page.getByRole('region',{name:'运行控制'}).getByText('已安全停机',{exact:true})).toBeVisible();
  await expect(page.locator('.rail-status')).toHaveText('已安全停机');
  await page.getByRole('button',{name:'Reset 整理任务'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('本地测试电影',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const violations=(await new AxeBuilder({page}).include('[role="dialog"]').analyze()).violations;
  expect(violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('reset-confirmation.png')});
  await page.getByRole('checkbox').focus();await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox')).toBeChecked();await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reset 整理任务'})).toBeFocused();expect(resetCount).toBe(0);
  await page.getByRole('button',{name:'Reset 整理任务'}).click();await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'确认 Reset'}).click();await expect(page.getByText('已清理 2 项整理，服务保持停机。')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('reset-completed.png')});
  await page.getByRole('button',{name:'恢复运行',exact:true}).click();await expect(page.getByRole('button',{name:'安全停机',exact:true})).toBeEnabled();expect(resetCount).toBe(1);
});

test('Reset blockers and preview failures have safe reachable recovery',async({page})=>{
  let fail=true;
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/admin/runtime')return route.fulfill({json:{mode:'stopped',desiredMode:'stopped',revision:1,normalSupplyAllowed:false,activity:{},operation:null,error:null,recoveryBackup:null}});
    if(url.pathname==='/v1/admin/runtime/reset-preview'){
      if(fail){fail=false;return route.fulfill({status:409,json:{error:{code:'RESET_WORKSPACE_UNAVAILABLE',message:'工作区暂不可访问，请恢复目录后重试。',correlationId:'test'}}});}
      return route.fulfill({json:{previewDigest:'b'.repeat(64),ready:false,empty:false,items:[{subjectId:'one',displayIdentity:'受保护电影',contentProfile:'movie'}],counts:{subjects:1},protected:{collectionCount:8},blockers:[{code:'RESET_ENDED_HISTORY_OVERLAP',message:'清理闭包包含已结束历史，不能清除。'}]}});
    }
    if(url.pathname==='/v1/admin/overview')return route.fulfill({json:{generatedAt:new Date().toISOString(),systemState:{kind:'running',label:'正常运行',href:'/'},metrics:[],todos:[],ledger:[],pipeline:{waitingAcceptanceCount:0,organizingCount:0},setup:{activeMaterialFieldCount:1,activeShelfCount:1},backgroundOperations:null}});
    return route.fulfill({json:{items:[],state:'ready'}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Reset 整理任务'}).click();
  await expect(page.getByRole('alert')).toContainText('工作区暂不可访问');await expect(page.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
  await page.getByRole('button',{name:'重新核对'}).click();await expect(page.getByText('受保护电影',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('已结束历史');await expect(page.getByRole('button',{name:'确认 Reset'})).toBeDisabled();
  await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toBeEnabled();
});
