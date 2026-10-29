import {expect,test} from '@playwright/test';

const item={formationViewId:'jav-subject',subjectId:'jav-subject',displayIdentity:'IPX-177',contentProfile:'jav',structureKind:'single',
  status:'active',classification:'attention_required',myRating:null,myRatingSource:'douban',targetShelfId:'shelf',targetShelfName:'JAV',
  organizingRequirement:'整理影片',organizingSteps:[],addedAtMs:1,routingState:'resolved',unresolvedReasonCode:null,productIdentityIssue:null,
  nextAction:{label:'目标目录已存在，已停止上架',state:'attention_required',progress:null},currentRun:null,
  handoffB:{offerId:'offer-jav',state:'published'},executorIssue:{phase:'on_deck_execution',errorCode:'CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED',
    canRetry:false,canRecheck:true,offerId:'offer-jav',onDeckRunId:'run-jav'},
  failureDiagnostics:[{eventId:'stage',code:'CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED',diagnostics:{sourceDirectory:'/media/JAV/IPX-177 short'}}],
  processDetail:{contract:'formation_process_actual_plans@1',stages:[]}};
const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0,endedCount:0};

test('shortened JAV target conflict shows its location and submits a recheck',async({page},info)=>{
  const writes:string[]=[];
  await page.route('**/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(request.method()!=='GET')writes.push(pathname);
    if(pathname==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',normalSupplyAllowed:true,revision:1,operation:null,activity:{}}});
    if(pathname==='/v1/admin/formation')return route.fulfill({json:{items:url.searchParams.get('section')==='active'?[item]:[],summary,
      intakeItems:[],nextCursor:null,projection:{status:'ready',asOfMs:100}}});
    if(pathname==='/v1/admin/formation/jav-subject')return route.fulfill({json:item});
    return route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/formation');
  await expect(page.getByText('目标目录已存在，已停止上架',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'重试上架',exact:true})).toHaveCount(0);
  const trigger=page.getByRole('button',{name:'查看过程',exact:true});await trigger.press('Enter');
  const dialog=page.getByRole('dialog',{name:'IPX-177的媒体整理过程'});
  await expect(dialog.getByText('/media/JAV/IPX-177 short',{exact:true})).toBeVisible();
  await dialog.screenshot({path:info.outputPath('jav-short-target-conflict.png')});
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  const recheck=page.getByRole('button',{name:'重新检查',exact:true});await recheck.press('Enter');
  await expect(page.getByText('已提交重新检查',{exact:true})).toBeVisible();
  expect(writes).toEqual(['/v1/admin/formation/acceptance/offer-jav/actions/retry']);
});
