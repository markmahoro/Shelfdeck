import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const preview={contractVersion:'shelfdeck.fresh-formation-reset@1',runtimeRevision:1,previewDigest:'a'.repeat(64),ready:true,
  counts:[{table:'proc_candidate_packages',retained:8,removed:2},{table:'libra_runs',retained:8,removed:3}],
  protectedSummary:{collectionCount:8},expectedReleasedBytes:'1073741824',blockers:[],
  volumeBudget:{volumes:[{device:'isolated-volume',requiredBytes:'2147483648',availableBytes:'4294967296',sufficient:true,
    allocations:[{directory:'/isolated/operations',purpose:'reset',bytes:'2147483648'}]}]}};
type State={mode:string;revision:number;operation:unknown;resetStage?:string;resetRetry?:unknown;error?:unknown;recoveryBackup?:string;};
async function fixture(page:Page,state:State,readPreview:()=>unknown=()=>preview){
  const requests:Array<{path:string;body:Record<string,unknown>}> = [];
  await page.route('**/v1/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/v1/admin/runtime')return route.fulfill({json:{...state,desiredMode:'stopped',normalSupplyAllowed:false,
      activity:{inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0},error:state.error||null,recoveryBackup:state.recoveryBackup||null}});
    if(pathname==='/v1/admin/runtime/reset-preview')return route.fulfill({json:readPreview()});
    if(pathname.endsWith('/actions/reset')){
      requests.push({path:pathname,body:route.request().postDataJSON()});state.mode='resetting';state.resetStage='closed';state.error=null;state.resetRetry=null;
      return route.fulfill({status:202,json:{operationId:'reset-fixture',kind:'reset',state:'pending'}});
    }
    if(pathname==='/v1/admin/overview')return route.fulfill({json:{generatedAt:new Date().toISOString(),systemState:{kind:'running',label:'正常运行',href:'/'},
      metrics:[],todos:[],ledger:[],pipeline:{waitingAcceptanceCount:0,organizingCount:0},setup:{activeMaterialFieldCount:1,activeShelfCount:1},backgroundOperations:null}});
    return route.fulfill({json:{items:[],state:'ready',completionState:'complete'}});
  });
  return requests;
}

test('fresh Reset has one exact confirmation, accessible scope and a stopped completion',async({page},testInfo)=>{
  const state:State={mode:'stopped',revision:1,operation:null},requests=await fixture(page,state);
  await page.goto('/');await page.getByRole('button',{name:'重置工作台',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'重置整理工作台'}),confirm=dialog.getByRole('button',{name:'确认重置',exact:true});
  await expect(dialog.getByText(/将清除 2 个未入藏采购包、3 次/)).toBeVisible();
  await expect(dialog.getByText(/保留 8 条当前及历史收藏/)).toBeVisible();
  await expect(dialog.getByText(/历史仅保存在校验后的离线备份中/)).toBeVisible();
  await expect(dialog.getByLabel('各卷空间预算')).toContainText('需要 2 GiB · 可用 4 GiB');
  await expect(confirm).toBeDisabled();await dialog.getByLabel('确认词').fill('wrong');await expect(confirm).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('fresh-reset-confirmation.png')});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.getByRole('button',{name:'重置工作台',exact:true})).toBeFocused();
  expect(requests).toHaveLength(0);await page.keyboard.press('Enter');await dialog.getByLabel('确认词').fill('重置工作台');
  await confirm.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'整理工作台重置'})).toBeVisible();
  expect(requests).toHaveLength(1);expect(requests[0].body).toMatchObject({previewDigest:preview.previewDigest,confirmed:true});
  await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toHaveCount(0);await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('fresh-reset-cold-progress.png')});
  state.mode='stopped';delete state.resetStage;state.revision=2;state.operation={operationId:'reset-fixture',kind:'reset',state:'completed',result:{phase:'complete'}};
  await expect(page.getByText('已重置工作台，服务保持停机。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toBeEnabled();expect(requests).toHaveLength(1);
  await page.screenshot({path:testInfo.outputPath('fresh-reset-completed-stopped.png')});
});

test('an explicitly stopped first-upgrade management entry offers Reset confirmation but no Resume or business navigation',async({page},testInfo)=>{
  const state:State={mode:'stopped',revision:1,operation:null,resetStage:'awaiting_confirmation'};
  const requests=await fixture(page,state);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'整理工作台重置'})).toBeVisible();
  await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button',{name:'重置工作台',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'重置整理工作台'});
  await expect(dialog.getByRole('button',{name:'确认重置',exact:true})).toBeDisabled();
  await dialog.getByLabel('确认词').fill('重置工作台');
  await page.screenshot({path:testInfo.outputPath('first-upgrade-confirmation.png')});
  await dialog.getByRole('button',{name:'确认重置',exact:true}).click();
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toHaveCount(0);
});

test('insufficient capacity keeps scope unknown and provides a reachable recheck',async({page},testInfo)=>{
  const state:State={mode:'stopped',revision:1,operation:null};let enough=false;
  await fixture(page,state,()=>enough?preview:{...preview,ready:false,counts:null,protectedSummary:null,expectedReleasedBytes:null,selectionStatus:'not_evaluated',
    blockers:[{code:'RESET_OPERATOR_SPACE_INSUFFICIENT'}],volumeBudget:{volumes:[{...preview.volumeBudget.volumes[0],availableBytes:'1073741824',sufficient:false}]}});
  await page.goto('/');await page.getByRole('button',{name:'重置工作台',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('作业空间不足');await expect(page.getByLabel('各卷空间预算')).toContainText('需要 2 GiB · 可用 1 GiB · 空间不足');
  await expect(page.getByLabel('确认词')).toHaveCount(0);await expect(page.getByRole('button',{name:'确认重置',exact:true})).toBeDisabled();
  await page.screenshot({path:testInfo.outputPath('fresh-reset-capacity-blocked.png')});
  enough=true;await page.getByRole('button',{name:'重新核对',exact:true}).click();await expect(page.getByLabel('确认词')).toBeVisible();
});

test('cold failure offers only the original confirmed operation and keeps Resume inaccessible',async({page},testInfo)=>{
  const original={idempotencyKey:'original-confirmed-request',previewDigest:preview.previewDigest,confirmed:true};
  const state:State={mode:'error',revision:2,operation:{operationId:'reset-fixture',kind:'reset',state:'failed'},resetStage:'closed',resetRetry:original,
    error:{code:'RESET_CLEANUP_INCOMPLETE',message:'临时空间清理未完成，系统保持停止。'},recoveryBackup:'verified-fixture-backup'};
  const requests=await fixture(page,state);await page.goto('/formation');
  await expect(page.getByRole('heading',{name:'整理工作台重置'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('清理未完成');
  await expect(page.getByRole('button',{name:'恢复运行',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重置工作台',exact:true})).toHaveCount(0);
  await page.getByText('查看恢复资料',{exact:true}).click();await expect(page.getByText('备份编号：verified-fixture-backup')).toBeVisible();
  expect((await new AxeBuilder({page}).include('main').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('fresh-reset-cold-retry.png')});
  await page.getByRole('button',{name:'继续本次重置',exact:true}).click();await expect(page.getByRole('button',{name:'继续本次重置',exact:true})).toHaveCount(0);
  expect(requests).toHaveLength(1);expect(requests[0].body).toEqual(original);
});

test('another session changing the Runtime revision invalidates an open confirmation',async({page})=>{
  const state:State={mode:'stopped',revision:1,operation:null},requests=await fixture(page,state);
  await page.goto('/');await page.getByRole('button',{name:'重置工作台',exact:true}).click();await page.getByLabel('确认词').fill('重置工作台');
  state.revision=3;
  await expect(page.getByText('运行状态已变化，请重新核对清单。',{exact:true})).toBeVisible({timeout:10000});
  await expect(page.getByRole('button',{name:'确认重置',exact:true})).toBeDisabled();await expect(page.getByLabel('确认词')).toHaveValue('');expect(requests).toHaveLength(0);
});
