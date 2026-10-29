import {expect,test,type Page} from '@playwright/test';
const GiB=1073741824;
async function fixture(page:Page,mode:'stale'|'unknown'|'measured'|'forecast'|'held'|'unknown-held'|'preview-error'|'preview-ineligible',open=true) {
  const item={formationViewId:'view-us',subjectId:'subject-us',displayIdentity:'测试影片',contentProfile:'western_adult',structureKind:'single',
    classification:'attention_required',status:'active',myRating:null,myRatingSource:'douban',myRatingRevision:null,addedAtMs:1,
    primaryMaterialCount:1,organizingRequirement:'HEVC',organizingAction:'',organizingSteps:[],currentPlan:null,executorIssue:null,
    handoffB:null,productIdentityIssue:null,unresolvedReasonCode:null,targetShelfId:null,targetShelfName:null,routingState:'resolved',
    nextAction:{label:'需要处理',state:'attention_required',progress:null},currentRun:{libraRunId:'run-us',state:'frozen',stateRevision:3,
      stateDigest:'a'.repeat(64),priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:1}};
  const state={submitted:false,changed:false,failPreview:false},writes:Array<Record<string,unknown>>=[];
  let release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0,endedCount:0};
  await page.route('**/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(path.endsWith('/defect-admission-candidate')){
      if(state.failPreview&&mode==='preview-error')return route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE',message:'暂时无法读取预览。'}}});
      if(state.failPreview&&mode==='preview-ineligible')return route.fulfill({json:{eligibility:'ineligible',message:'当前证据不支持瑕疵上架。',ineligibleReasons:['identity'],missingEvidence:[]}});
      const candidate={eligibility:'eligible',candidateRevision:1,libraRunId:'run-us',frozenRunStateRevision:3,
        frozenRunStateDigest:'a'.repeat(64),terminalEvidenceDigest:'b'.repeat(64),candidateDigest:(state.changed?'d':'c').repeat(64),
        waivedRequirementCodes:['max_size_exceeded'],defects:[{defectCode:'size_cap_exceeded',sourceFailureCode:'size',waivedRequirementCodes:['max_size_exceeded']}],
        sizeForecast:{maxSizeBytes:GiB,predictedBytes:mode==='forecast'?1.5*GiB:9*GiB,overshootBytes:0.5*GiB,
          ...(mode==='forecast'?{}:{measured:true,actualSizeBytes:1.5*GiB,withinLimit:false})}};
      return route.fulfill({json:candidate});
    }
    if(path.endsWith('/actions/admit-with-defects')){
      writes.push(req.postDataJSON());
      if(mode==='held'||mode==='unknown-held'&&writes.length===2)await held;
      if(mode==='stale'&&writes.length===1){state.changed=true;return route.fulfill({status:409,json:{error:{code:'P9_DEFECT_ADMISSION_EVIDENCE_PENDING',message:'成品证据已变化，请重新核对。'}}});}
      if((mode==='unknown'||mode==='unknown-held')&&writes.length===1)return route.abort('connectionreset');
      state.submitted=true;return route.fulfill({json:{resultKind:'defect_admitted',libraRunId:'run-us',replayed:mode==='unknown'||mode==='unknown-held'}});
    }
    if(path==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',normalSupplyAllowed:true,revision:1,operation:null,activity:{}}});
    if(path==='/v1/admin/formation'){
      const active=url.searchParams.get('section')==='active',current=state.submitted?{...item,classification:'in_progress',currentRun:{...item.currentRun,state:'active',stateRevision:4},nextAction:{label:'正在整理',state:'running',progress:null}}:item;
      return route.fulfill({json:{items:active?[current]:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:1}}});
    }
    if(path==='/v1/admin/formation/view-us')return route.fulfill({json:item});
    return route.fulfill({json:{items:[],summary,counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/formation');
  const accept=page.getByRole('button',{name:'接受瑕疵',exact:true});await expect(accept).toBeEnabled();
  const dialog=page.getByRole('dialog',{name:'确认接受瑕疵入库'});if(open){await accept.press('Enter');await expect(dialog).toBeVisible();}
  return {dialog,writes,state,release,accept};
}

for(const method of ['escape','scrim','cancel','close'] as const){
  test(`closing an idle dialog by ${method} returns focus to its trigger`,async({page})=>{
    const {dialog,writes,accept}=await fixture(page,'measured');
    if(method==='escape')await page.keyboard.press('Escape');
    if(method==='scrim')await page.locator('.dialog-scrim').click({position:{x:2,y:2}});
    if(method==='cancel')await dialog.getByRole('button',{name:'取消',exact:true}).press('Enter');
    if(method==='close')await dialog.getByRole('button',{name:'关闭'}).press('Enter');
    await expect(dialog).toBeHidden();await expect(accept).toBeFocused({timeout:2000});expect(writes).toHaveLength(0);
    await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
  });
}

test('closing an idle dialog returns focus to a page action if its trigger disappeared',async({page})=>{
  const {dialog,accept}=await fixture(page,'measured');await accept.evaluate(node=>node.remove());
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeFocused({timeout:2000});
});

test('a successful admission focuses its outcome when the trigger is no longer present',async({page})=>{
  const {dialog}=await fixture(page,'measured');await dialog.getByRole('button',{name:'确认接受',exact:true}).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({hasText:'瑕疵已接受，系统正在继续整理'})).toBeFocused({timeout:2000});
});

for(const mode of ['preview-error','preview-ineligible'] as const){
  test(`${mode} keeps focus at the trigger when no dialog opens`,async({page})=>{
    const {dialog,accept,writes,state}=await fixture(page,mode,false);state.failPreview=true;await accept.press('Enter');
    await expect(page.getByRole('alert')).toBeVisible();await expect(dialog).toBeHidden();
    await expect(accept).toBeFocused({timeout:2000});expect(writes).toHaveLength(0);
  });
}

test('measured size and list order are accurate before any confirmation',async({page},info)=>{
  const {dialog,writes}=await fixture(page,'measured'),entry=dialog.locator('ol > li').first();
  await expect(entry).toContainText('上限 1.0 GiB，实际 1.5 GiB，超出 0.5 GiB');
  await expect(entry).not.toContainText('预计');await expect(entry).not.toContainText('9.0 GiB');
  expect(await entry.innerText()).not.toMatch(/^\s*1\.\s/);expect(writes).toHaveLength(0);
  await expect(dialog).toContainText('保留瑕疵记录');await dialog.screenshot({path:info.outputPath('measured.png')});
  await dialog.getByRole('button',{name:'取消',exact:true}).press('Enter');await expect(dialog).toBeHidden();expect(writes).toHaveLength(0);
});

test('a prediction remains labelled as a prediction',async({page})=>{
  const {dialog}=await fixture(page,'forecast');await expect(dialog.locator('ol > li').first()).toContainText('预计 1.5 GiB');
  await expect(dialog.locator('ol > li').first()).not.toContainText('实际');
});

test('a stale confirmation gives an in-dialog error and a new preview is required',async({page},info)=>{
  const {dialog,writes}=await fixture(page,'stale');await dialog.getByRole('button',{name:'确认接受',exact:true}).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('成品证据');await expect(dialog.getByRole('button',{name:'确认接受',exact:true})).toBeDisabled();
  expect(writes).toHaveLength(1);await dialog.screenshot({path:info.outputPath('stale.png')});
  await dialog.getByRole('button',{name:'重新检查',exact:true}).press('Enter');await expect(dialog.getByRole('button',{name:'确认接受',exact:true})).toBeEnabled();
  expect(writes).toHaveLength(1);await dialog.getByRole('button',{name:'确认接受',exact:true}).press('Enter');await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(2);expect(writes[0].expectedDefectCandidateDigest).toBe('c'.repeat(64));expect(writes[1].expectedDefectCandidateDigest).toBe('d'.repeat(64));
  expect(writes[0].idempotencyKey).not.toBe(writes[1].idempotencyKey);
});

test('an uncertain response can be checked with the exact original command',async({page},info)=>{
  const {dialog,writes}=await fixture(page,'unknown');await dialog.getByRole('button',{name:'确认接受',exact:true}).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('提交结果尚未确认');await expect(dialog.getByRole('button',{name:'确认接受',exact:true})).toBeDisabled();
  await dialog.screenshot({path:info.outputPath('unknown.png')});await dialog.getByRole('button',{name:'确认提交结果',exact:true}).press('Enter');
  await expect(dialog).toBeHidden();expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
});

test('keyboard focus remains inside the dialog while a confirmation is pending',async({page},info)=>{
  const {dialog,writes,release}=await fixture(page,'held');
  try{
    const confirm=dialog.getByRole('button',{name:'确认接受',exact:true});await confirm.focus();
    await page.keyboard.press('Enter');await expect(confirm).toBeDisabled();
    expect(writes).toHaveLength(1);
    await expect(dialog).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText('正在处理，请稍候。');
    await expect(dialog.getByRole('button',{name:'关闭'})).toBeDisabled();
    await page.keyboard.press('Tab');await expect(dialog).toBeFocused();
    await page.keyboard.press('Tab');await expect(dialog).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
    await page.locator('.dialog-scrim').click({position:{x:2,y:2}});await expect(dialog).toBeVisible();await expect(dialog).toBeFocused();
    await dialog.getByText('测试影片').click();await expect(dialog).toBeFocused();
    await dialog.screenshot({path:info.outputPath('submitting.png')});
  }finally{release();}
  await expect(dialog).toBeHidden();expect(writes).toHaveLength(1);
});

test('checking an uncertain result keeps focus and reuses the original command',async({page})=>{
  const {dialog,writes,release}=await fixture(page,'unknown-held');
  try{
    await dialog.getByRole('button',{name:'确认接受',exact:true}).press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('提交结果尚未确认');
    await dialog.getByRole('button',{name:'确认提交结果',exact:true}).press('Enter');
    await expect(dialog.getByRole('button',{name:'确认提交结果',exact:true})).toBeDisabled();
    await expect(dialog).toBeFocused();await page.keyboard.press('Tab');await expect(dialog).toBeFocused();
    expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  }finally{release();}
  await expect(dialog).toBeHidden();
});
