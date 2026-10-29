import {expect,test,type Page} from '@playwright/test';

const failureCode='P4_EVENT_RECOVERY_OBSERVATION_UNAVAILABLE';
const failed={formationViewId:'subject',subjectId:'subject',displayIdentity:'测试剧集',contentProfile:'series',structureKind:'season',
  status:'active',classification:'attention_required',myRating:null,myRatingSource:'douban',targetShelfId:'shelf',targetShelfName:'剧集',
  organizingRequirement:'补齐资料',organizingSteps:[],addedAtMs:1,routingState:'resolved',unresolvedReasonCode:null,productIdentityIssue:null,
  nextAction:{label:'剧集资料准备失败',state:'attention_required',progress:null},currentRun:null,
  handoffB:{offerId:'offer',state:'published'},executorIssue:{phase:'series_presentation',errorCode:failureCode,canRetry:true,offerId:'offer'},
  processDetail:{contract:'formation_process_actual_plans@1',stages:[{key:'acceptance',label:'验收与上架',summary:'需要处理',description:'',state:'attention',
    plans:[{planId:'plan',title:'剧集资料',state:'attention',nodes:[{nodeId:'publish',label:'写入剧集资料',description:'',state:'failed',
      statusText:'执行失败',progress:null,results:[{label:'失败原因',value:'File reality could not be observed within the original recovery budget.'},
        {label:'失败代码',value:failureCode}],technicalDetail:{summary:'处理详情',fields:[],parameters:[{label:'格式',value:'测试'}]}}]}]}]}};
const ended={historyId:'history',libraRunId:'run',subjectId:'old-subject',displayIdentity:'已结束测试',outcome:'unable_to_on_deck',
  label:'无法上架',endedAtMs:1,stateRevision:4,stateDigest:'state',evidenceDigest:'evidence'};
const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0,endedCount:1};

async function installFixture(page:Page) {
  const writes:string[]=[];
  await page.route('**/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
    if(request.method()!=='GET')writes.push(pathname);
    if(pathname==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',normalSupplyAllowed:true,revision:1,operation:null,activity:{}}});
    if(pathname==='/v1/admin/formation')return route.fulfill({json:{items:url.searchParams.get('section')==='active'?[failed]:
      url.searchParams.get('section')==='ended'?[ended]:[],summary,intakeItems:[],nextCursor:null,projection:{status:'ready',asOfMs:100}}});
    if(pathname==='/v1/admin/formation/subject')return route.fulfill({json:failed});
    if(pathname==='/v1/admin/formation/runs/run/outcome')return route.fulfill({json:{outcome:{libraRunId:'run',outcome:'unable_to_on_deck',
      reasonCode:'processing_failed',outcomeDigest:'digest',committedAtMs:1,terminalReasons:[{failureCode:'required_artifact_missing'}]}}});
    return route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  return writes;
}

test('file observation failure remains actionable and process focus follows visible details in both directions',async({page},info)=>{
  const writes=await installFixture(page);await page.goto('/formation');
  const trigger=page.getByRole('button',{name:'查看过程',exact:true}).first();await trigger.press('Enter');
  const dialog=page.getByRole('dialog',{name:'测试剧集的媒体整理过程'}),close=dialog.getByRole('button',{name:'关闭媒体整理过程卡片'}),
    detail=dialog.getByText('查看处理详情',{exact:true}),nested=dialog.getByText('查看执行参数',{exact:true});
  await expect(dialog.getByText('未能在规定时间内核对文件状态',{exact:true})).toBeVisible();
  await expect(dialog.getByText(failureCode,{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重试上架',exact:true})).toBeEnabled();
  await expect(close).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(detail).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await detail.press('Enter');await expect(nested).toBeVisible();await nested.focus();await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await page.locator('input[aria-label="按片名筛选"]').evaluate((input:HTMLInputElement)=>input.focus());await expect(close).toBeFocused();
  await dialog.screenshot({path:info.outputPath('recovery-feedback.png')});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();expect(writes).toEqual([]);
});

test('native retry confirmation retains its own keyboard handling before returning to the process dialog',async({page})=>{
  const writes=await installFixture(page);await page.goto('/formation');
  await page.getByRole('button',{name:'已结束 1',exact:true}).click();
  const trigger=page.getByRole('button',{name:'查看过程',exact:true});await trigger.press('Enter');
  const outer=page.getByRole('dialog',{name:'已结束测试的媒体整理过程'}),retry=outer.getByRole('button',{name:'重试任务'});
  await retry.press('Enter');const confirmation=page.getByRole('dialog',{name:'确认重试任务'});await expect(confirmation).toBeVisible();
  await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(outer).toBeVisible();await expect(retry).toBeFocused();
  await page.keyboard.press('Escape');await expect(outer).toHaveCount(0);await expect(trigger).toBeFocused();expect(writes).toEqual([]);
});
