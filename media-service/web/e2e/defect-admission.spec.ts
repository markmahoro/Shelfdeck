import {expect,test,type Page} from '@playwright/test';
const GiB=1073741824;
async function fixture(page:Page,mode:'stale'|'unknown'|'measured'|'forecast') {
  const item={formationViewId:'view-us',subjectId:'subject-us',displayIdentity:'测试影片',contentProfile:'western_adult',structureKind:'single',
    classification:'attention_required',status:'active',myRating:null,myRatingSource:'douban',myRatingRevision:null,addedAtMs:1,
    primaryMaterialCount:1,organizingRequirement:'HEVC',organizingAction:'',organizingSteps:[],currentPlan:null,executorIssue:null,
    handoffB:null,productIdentityIssue:null,unresolvedReasonCode:null,targetShelfId:null,targetShelfName:null,routingState:'resolved',
    nextAction:{label:'需要处理',state:'attention_required',progress:null},currentRun:{libraRunId:'run-us',state:'frozen',stateRevision:3,
      stateDigest:'a'.repeat(64),priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:1}};
  const state={submitted:false,changed:false},writes:Array<Record<string,unknown>>=[];
  const summary={totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0,endedCount:0};
  await page.route('**/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(path.endsWith('/defect-admission-candidate')){
      const candidate={eligibility:'eligible',candidateRevision:1,libraRunId:'run-us',frozenRunStateRevision:3,
        frozenRunStateDigest:'a'.repeat(64),terminalEvidenceDigest:'b'.repeat(64),candidateDigest:(state.changed?'d':'c').repeat(64),
        waivedRequirementCodes:['max_size_exceeded'],defects:[{defectCode:'size_cap_exceeded',sourceFailureCode:'size',waivedRequirementCodes:['max_size_exceeded']}],
        sizeForecast:{maxSizeBytes:GiB,predictedBytes:mode==='forecast'?1.5*GiB:9*GiB,overshootBytes:0.5*GiB,
          ...(mode==='forecast'?{}:{measured:true,actualSizeBytes:1.5*GiB,withinLimit:false})}};
      return route.fulfill({json:candidate});
    }
    if(path.endsWith('/actions/admit-with-defects')){
      writes.push(req.postDataJSON());
      if(mode==='stale'&&writes.length===1){state.changed=true;return route.fulfill({status:409,json:{error:{code:'P9_DEFECT_ADMISSION_EVIDENCE_PENDING',message:'成品证据已变化，请重新核对。'}}});}
      if(mode==='unknown'&&writes.length===1)return route.abort('connectionreset');
      state.submitted=true;return route.fulfill({json:{resultKind:'defect_admitted',libraRunId:'run-us',replayed:mode==='unknown'}});
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
  const accept=page.getByRole('button',{name:'接受瑕疵',exact:true});await expect(accept).toBeEnabled();await accept.press('Enter');
  const dialog=page.getByRole('dialog',{name:'确认接受瑕疵入库'});await expect(dialog).toBeVisible();
  return {dialog,writes,state};
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
