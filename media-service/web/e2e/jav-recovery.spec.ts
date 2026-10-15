import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for(const submitted of [false,true])test(`JAV recovery confirmation follows ${submitted?'the unknown submitted request':'the current unsubmitted consequence'}`,async({page},testInfo)=>{
  let cleanup=false;const writes:Record<string,unknown>[]=[];
  await page.route('**/v1/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/v1/admin/collection/jav-corrections'){
      await route.fulfill({json:{items:[{taskType:'jav_identity_correction',correctionId:'correction',shelfEntryId:'entry',state:cleanup?'committed':'attention_required',
        cleanupState:cleanup?'attention_required':null,stateRevision:cleanup?5:3,admissionDigest:'a'.repeat(64),cancellation:{available:false,reasonCode:'no_effect_unproven'},
        recovery:{available:true,mode:cleanup?'continue_cleanup':'continue_correction',previousIntentDigest:cleanup?'b'.repeat(64):null},oldJavCode:'IPX-177',newJavCode:'IPX-178',
        updatedAtMs:cleanup?200:100,classification:'attention_required',displayIdentity:'待核对影片',targetShelfName:'JAV',targetShelfId:'shelf',createdAtMs:1,terminalAtMs:null,
        processDetail:{contract:'jav_correction_process_actual_plans@1',stages:[]}}],counts:{attention_required:1},nextCursor:null}});return;
    }
    if(pathname.endsWith('/actions/recover')){writes.push(route.request().postDataJSON());await route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'unknown'}}});return;}
    await route.fulfill({json:{items:[],counts:{},nextCursor:null}});
  });
  await page.goto('/formation?correctionId=correction');const row=page.getByRole('row').filter({hasText:'IPX-177 → IPX-178'});
  await row.getByRole('button',{name:'继续纠正',exact:true}).click();await row.getByRole('checkbox').check();
  if(submitted){await row.getByRole('button',{name:'继续纠正',exact:true}).click();await expect(row.getByRole('alert')).toHaveText('尚未确认继续请求，请重试。');}
  cleanup=true;await expect(row.getByText('身份已更新 · 清理需要处理',{exact:true})).toBeVisible({timeout:15000});
  if(submitted){
    await expect(row.getByRole('checkbox')).toBeChecked();await expect(row.getByRole('checkbox')).toHaveAccessibleName('继续按已确认的番号更新资料和文件位置，保留视频。');
    await row.getByRole('button',{name:'继续纠正',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual(writes[0]);
  }else{
    await expect(row.getByRole('checkbox')).not.toBeChecked();await expect(row.getByRole('button',{name:'继续清理',exact:true})).toBeDisabled();expect(writes).toHaveLength(0);
    await row.getByRole('checkbox').check();await row.getByRole('button',{name:'继续清理',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
    expect(writes[0]).toMatchObject({expectedStateRevision:5,expectedCleanupState:'attention_required',expectedRecoveryIntentDigest:'b'.repeat(64)});
  }
  await page.screenshot({path:testInfo.outputPath('jav-recovery-consent-change.png'),fullPage:true});
});
for(const scenario of ['correction','cleanup','conflict'] as const)test(`JAV recovery in the workbench: ${scenario}`,async({page},testInfo)=>{
  const writes:Record<string,unknown>[]=[],errors:string[]=[],cleanup=scenario==='cleanup';
  let status={correctionId:'correction',shelfEntryId:'entry',state:cleanup?'committed':'attention_required',cleanupState:cleanup?'attention_required':null as string|null,
    stateRevision:3,admissionDigest:'a'.repeat(64),cancellation:{available:false,reasonCode:'no_effect_unproven'},
    recovery:{available:true,mode:cleanup?'continue_cleanup':'continue_correction',previousIntentDigest:null as string|null},oldJavCode:'IPX-177',newJavCode:'IPX-178',updatedAtMs:100};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/v1/**',async route=>{const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/collection/jav-corrections'){
      const classification=status.cleanupState==='completed'?'completed':status.state==='attention_required'||status.cleanupState==='attention_required'?'attention_required':'in_progress';
      await route.fulfill({json:{items:[{...status,taskType:'jav_identity_correction',classification,displayIdentity:'待核对影片',targetShelfId:'shelf',targetShelfName:'JAV',createdAtMs:1,
        terminalAtMs:classification==='completed'?300:null,processDetail:{contract:'jav_correction_process_actual_plans@1',stages:[]}}],counts:{[classification]:1},nextCursor:null}});return;
    }
    if(path.endsWith('/actions/recover')){
      writes.push(route.request().postDataJSON());
      if(scenario==='conflict'){await route.fulfill({status:409,json:{error:{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN',message:'private',details:{reasonCode:'file_changed',locations:['E:/Shelf/poster.jpg']}}}});return;}
      if(writes.length===1){await route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'private'}}});return;}
      status={...status,state:cleanup?'committed':'active',cleanupState:cleanup?'active':null,stateRevision:cleanup?3:4,
        recovery:{available:false,mode:cleanup?'continue_cleanup':'continue_correction',previousIntentDigest:'b'.repeat(64)}};
      await route.fulfill({status:202,json:{correctionId:status.correctionId,shelfEntryId:status.shelfEntryId,state:status.state,stateRevision:status.stateRevision,
        admissionDigest:status.admissionDigest,cleanupState:status.cleanupState,recoveryIntentDigest:'b'.repeat(64),updatedAtMs:200,replayed:false}});return;
    }
    await route.fulfill({json:{items:[],counts:{},nextCursor:null}});
  });
  await page.goto('/formation?correctionId=correction');const row=page.getByRole('row').filter({hasText:'IPX-177 → IPX-178'});await expect(row).toBeVisible();
  const label=cleanup?'继续清理':'继续纠正';await row.getByRole('button',{name:'查看过程'}).click();
  await expect(page.getByRole('dialog').getByRole('button',{name:label,exact:true})).toHaveCount(0);await page.getByRole('button',{name:'关闭媒体整理过程卡片'}).click();
  await row.getByRole('button',{name:label,exact:true}).click();const proceed=row.getByRole('button',{name:label,exact:true}),consent=row.getByRole('checkbox');
  await expect(proceed).toBeDisabled();await consent.focus();await page.keyboard.press('Space');await expect(proceed).toBeEnabled();
  expect((await new AxeBuilder({page}).include('.formation-table').analyze()).violations).toEqual([]);
  await proceed.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('jav-recovery-consequence.png'),fullPage:true});await proceed.click();
  if(scenario==='conflict'){
    await expect(row.getByRole('alert')).toHaveText('文件与处理记录不一致，请核对后重试。');await expect(row.getByText('E:/Shelf/poster.jpg')).toBeVisible();
    await expect(row.getByRole('checkbox')).toHaveCount(0);await expect(row.getByText('纠正需要处理',{exact:true})).toBeVisible();expect(writes).toHaveLength(1);
    await page.screenshot({path:testInfo.outputPath('jav-recovery-conflict.png'),fullPage:true});
  }else{
    await expect(row.getByRole('alert')).toHaveText('尚未确认继续请求，请重试。');await proceed.click();
    await expect(row.getByText(cleanup?'身份已更新 · 正在清理':'正在纠正',{exact:true})).toBeVisible();expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({expectedStateRevision:3,expectedAdmissionDigest:'a'.repeat(64),expectedCleanupState:cleanup?'attention_required':null,expectedRecoveryIntentDigest:null});
    status={...status,state:'committed',cleanupState:'completed',recovery:{...status.recovery,available:false}};
    await expect(row.getByText('已完成',{exact:true})).toBeVisible({timeout:10000});await expect(row.getByRole('button',{name:label,exact:true})).toHaveCount(0);
    expect(await page.getByRole('row').filter({hasText:'IPX-177 → IPX-178'}).count()).toBe(1);
    await page.screenshot({path:testInfo.outputPath('jav-recovery-completed.png'),fullPage:true});
  }
  expect(errors).toEqual([]);
});
