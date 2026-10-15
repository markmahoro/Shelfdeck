import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for(const available of [true,false])test(`JAV cancellation stays in the workbench interaction cell: ${available?'safe retry':'unavailable'}`,async({page},testInfo)=>{
  const errors:string[]=[],writes:Record<string,unknown>[]=[],entry={shelfEntryId:'entry',shelfId:'shelf',shelfName:'JAV',structureKind:'single',status:'active',displayIdentity:'原影片',
    year:null,genres:[],people:[],overview:null,hasPoster:false,hasNfo:true,occupancyBytes:2048,primaryVideoBytes:1024,primaryContainer:'matroska',videoCodec:'hevc',videoRaster:'1080p',
    health:{state:'healthy'},provider:'jav',providerKey:'IPX-177',identityKind:'jav_code',currentInventoryRevision:1,currentDeckFactRevision:1,createdAtMs:1,terminalAtMs:null,defectAdmission:null};
  let status={correctionId:'correction',shelfEntryId:'entry',state:'attention_required',stateRevision:3,admissionDigest:'a'.repeat(64),cleanupState:null,
    cancellation:{available,reasonCode:available?null:'no_effect_unproven'},recovery:{available:true,mode:'continue_correction',previousIntentDigest:null},oldJavCode:'IPX-177',newJavCode:'IPX-178',updatedAtMs:100};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/v1/**',async route=>{const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/collection'){await route.fulfill({json:{items:[entry],summary:{currentCount:1,historyCount:0},resultCount:1,nextCursor:null}});return;}
    if(path==='/v1/admin/care/entry'){await route.fulfill({json:{shelfEntryId:'entry',health:{state:'healthy'},basis:{inventoryRevision:1},activeCaseProgress:null,history:{assessments:[],findings:[],cases:[],commits:[]}}});return;}
    if(path.endsWith('/defect-admission-candidate')){await route.fulfill({json:{acceptedGaps:[],unavailableRepairs:[],gaps:[],eligibility:'ineligible',ineligibleReasons:['no_current_gaps']}});return;}
    if(path.endsWith('/jav-correction')){await route.fulfill({json:{correction:status}});return;}
    if(path==='/v1/admin/collection/jav-corrections'){
      const item={...status,taskType:'jav_identity_correction',classification:status.state==='cancelled'?'ended':'attention_required',displayIdentity:'原影片',targetShelfId:'shelf',targetShelfName:'JAV',createdAtMs:1,
        terminalAtMs:status.state==='cancelled'?200:null,processDetail:{contract:'jav_correction_process_actual_plans@1',stages:[]}};
      await route.fulfill({json:{items:[item],counts:{[item.classification]:1},nextCursor:null}});return;
    }
    if(path==='/v1/admin/formation'){await route.fulfill({json:{items:[],summary:{totalCount:0,inProgressCount:0,attentionRequiredCount:0,completedCount:0},nextCursor:null,projection:{status:'ready',asOfMs:1}}});return;}
    if(path.endsWith('/actions/cancel')){writes.push(route.request().postDataJSON());
      if(writes.length===1){await route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'private'}}});return;}
      status={...status,state:'cancelled',stateRevision:4,updatedAtMs:200,cancellation:{available:false,reasonCode:null},recovery:{...status.recovery,available:false}};
      await route.fulfill({json:{state:'cancelled',stateRevision:4,cancelledAtMs:200,replayed:false}});return;
    }
    await route.fulfill({json:{items:[],counts:{},currentRating:null,nextCursor:null}});
  });
  await page.goto('/collection');await page.getByRole('button',{name:/查看 原影片 详情/}).click();await page.getByRole('button',{name:'核对影片',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对影片',exact:true});await expect(dialog.getByText('纠正需要处理')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'取消纠正',exact:true})).toHaveCount(0);
  await dialog.getByRole('link',{name:'查看维护任务'}).click();
  const row=page.getByRole('row').filter({hasText:'IPX-177 → IPX-178'});await expect(row).toBeVisible();
  await row.getByRole('button',{name:'查看过程'}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消纠正'})).toHaveCount(0);
  await page.getByRole('button',{name:'关闭媒体整理过程卡片'}).click();
  if(available){
    const action=row.getByRole('button',{name:'取消纠正',exact:true});await action.scrollIntoViewIfNeeded();await action.click();
    const consent=row.getByRole('checkbox',{name:'结束此次纠正，保留当前影片和视频。'}),cancel=row.getByRole('button',{name:'确认取消',exact:true});
    await expect(cancel).toBeDisabled();await consent.focus();await page.keyboard.press('Space');await expect(cancel).toBeEnabled();
    expect((await new AxeBuilder({page}).include('.formation-table').analyze()).violations).toEqual([]);
    await cancel.scrollIntoViewIfNeeded();await expect(cancel).toBeInViewport();await page.screenshot({path:testInfo.outputPath('jav-workbench-cancel-consequence.png'),fullPage:true});
    await cancel.click();await expect(row.getByRole('alert')).toHaveText('取消未完成，请重试。');await cancel.click();
    await expect(row.getByText('纠正已取消')).toBeVisible();expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);
    expect(writes[0]).toMatchObject({expectedStateRevision:3,expectedAdmissionDigest:status.admissionDigest});
    await page.screenshot({path:testInfo.outputPath('jav-workbench-cancel-completed.png'),fullPage:true});
  }else{
    await expect(row.getByRole('button',{name:'取消纠正',exact:true})).toHaveCount(0);expect(writes).toHaveLength(0);
    await page.screenshot({path:testInfo.outputPath('jav-workbench-cancel-unavailable.png'),fullPage:true});
  }
  expect(errors).toEqual([]);
});
