import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fixture(page:Page,confirmation:'success'|'uncertain'|'stale'='success',mode:'cross'|'aligned'='cross'){
  const member=mode==='aligned'
    ?{materialKey:'material-1',localScope:{seasonNumber:1,episodeNumber:1,episodeKey:'E001'},title:'Local.S01E01.mkv',airDate:'1998-06-06'}
    :{materialKey:'material-9',localScope:{seasonNumber:2,episodeNumber:9,episodeKey:'E009'},title:'Local.S02E09.mkv',airDate:null};
  const evidence=mode==='aligned'
    ?{evidenceDigest:'a'.repeat(64),providerEpisode:{provider:'tmdb',providerKey:'999',seasonNumber:1,episodeNumber:1,episodeId:101},
      title:'Aligned Episode One',airDate:'1998-06-06',plot:'Exact coordinate match for batch confirmation.'}
    :{evidenceDigest:'e'.repeat(64),providerEpisode:{provider:'tmdb',providerKey:'999',seasonNumber:0,episodeNumber:1,episodeId:501},
      title:'Fixture Christmas Special',airDate:'2011-12-25',plot:'A synthetic special for explicit mapping verification.'};
  const second=mode==='aligned'?{
    member:{materialKey:'material-2',localScope:{seasonNumber:1,episodeNumber:2,episodeKey:'E002'},title:'Local.S01E02.mkv',airDate:'1998-06-13'},
    evidence:{evidenceDigest:'b'.repeat(64),providerEpisode:{provider:'tmdb',providerKey:'999',seasonNumber:1,episodeNumber:2,episodeId:102},
      title:'Aligned Episode Two',airDate:'1998-06-13',plot:'Second exact match.'},
  }:null;
  const members=second?[member,second.member]:[member];
  const evidences=second?[evidence,second.evidence]:[evidence];
  const item={formationViewId:'subject',subjectId:'subject',displayIdentity:'示例剧集',contentProfile:'series',structureKind:'season',status:'active',
    classification:'attention_required',myRating:4,myRatingSource:'douban',myRatingRevision:null,productIdentityIssue:null,executorIssue:null,
    seriesDelivery:{libraRunId:'run',seasonNumber:member.localScope.seasonNumber,episodeKeys:members.map(entry=>entry.localScope.episodeKey),physicalFileCount:members.length},primaryMaterialCount:members.length,addedAtMs:1790546002510,
    organizingRequirement:'HEVC · 补齐资料',organizingAction:'取得剧集资料',organizingSteps:[],nextAction:{label:'资料取得失败',state:'attention_required',progress:null},
    routingState:'resolved',targetShelfId:'shelf',targetShelfName:'剧集',completedAtMs:null,handoffB:null,
    currentRun:{libraRunId:'run',state:'frozen',stateRevision:3,stateDigest:'digest',priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:1}};
  const writes:Array<{path:string;body:Record<string,unknown>}>=[];
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    if(p==='/v1/admin/runtime')return route.fulfill({json:{mode:'running',desiredMode:'running',normalSupplyAllowed:true,revision:1,error:null,operation:null,
      activity:{inFlightEvents:0,inFlightRecoveries:0,inFlightOwnerReconciliations:0}}});
    if(p.endsWith('/episode-metadata-mapping'))return route.fulfill({json:{libraRunId:'run',providerKey:'999',runStateRevision:3,state:'frozen',packageRevisionHead:0,
      expectedMappingRevision:0,members,currentMapping:null,currentReview:null}});
    if(p.endsWith('/actions/review-episode-metadata')){writes.push({path:p,body:route.request().postDataJSON()});return route.fulfill({json:{reviewRecord:{recordId:'review',review:{reviewDigest:'d'.repeat(64),members,evidence:evidences}}}});}
    if(p.endsWith('/actions/confirm-episode-metadata')){
      writes.push({path:p,body:route.request().postDataJSON()});
      if(confirmation==='stale')return route.fulfill({status:409,json:{error:{code:'LIBRA_EPISODE_REVIEW_STALE',message:'Changed',correlationId:'fixture'}}});
      if(confirmation==='uncertain'&&writes.filter(v=>v.path===p).length===1)return route.abort('connectionreset');
      return route.fulfill({status:202,json:{replayed:confirmation==='uncertain'}});
    }
    if(p==='/v1/admin/formation')return route.fulfill({json:{items:url.searchParams.get('section')==='active'?[item]:[],
      summary:{totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0},nextCursor:null,projection:{status:'ready',asOfMs:1}}});
    return route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  return {writes,member,evidence,members,evidences};
}
async function selectUncertain(page:Page){
  await page.goto('/formation');await page.getByRole('button',{name:'确认季集资料',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'确认季集资料'});
  await dialog.getByLabel('查询 Provider 季号').fill('0');await dialog.getByRole('button',{name:'查询资料',exact:true}).click();
  await expect(dialog.getByText(/已选 0 \/ 1 集 · 高置信 0 · 待核对 1/)).toBeVisible();
  await dialog.getByLabel('为 S02E09 选择 Provider 集').selectOption('e'.repeat(64));
  await dialog.getByRole('button',{name:'加入对应',exact:true}).click();
  await expect(dialog.getByText(/S02E09 → S00E01/)).toBeVisible();
  return dialog;
}

test('explicit mapping retains local coordinates, visible evidence and one consequence confirmation',async({page},testInfo)=>{
  const f=await fixture(page),dialog=await selectUncertain(page),confirm=dialog.getByRole('button',{name:'确认对应并重新整理'});
  await expect(confirm).toBeDisabled();await expect(dialog.getByRole('status')).toContainText('已选 1 / 1 集');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({providerSeasons:[0],expectedRunStateRevision:3,expectedMappingRevision:0});
  await dialog.getByText('查看双方资料',{exact:true}).click();
  await expect(dialog.getByText('A synthetic special for explicit mapping verification.')).toBeVisible();
  await expect(dialog.getByText(/Provider：S00E01.*2011-12-25/)).toBeVisible();
  expect((await new AxeBuilder({page}).include('[role="dialog"]').analyze()).violations).toEqual([]);
  const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:testInfo.outputPath('episode-metadata-selected.png')});
  await dialog.getByRole('checkbox').check();await confirm.click();await expect(dialog).toHaveCount(0);
  expect(f.writes).toHaveLength(2);expect(f.writes[1].body).toMatchObject({reviewId:'review',choices:[{materialKey:'material-9',localScope:f.member.localScope,evidenceDigest:f.evidence.evidenceDigest}]});
  expect(f.writes[1].body).not.toHaveProperty('plot');expect(f.writes[1].body).not.toHaveProperty('providerEpisode');
});

test('high-confidence season rows batch without per-episode clicks',async({page},testInfo)=>{
  const f=await fixture(page,'success','aligned');
  await page.goto('/formation');await page.getByRole('button',{name:'确认季集资料',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'确认季集资料'});
  await dialog.getByLabel('查询 Provider 季号').fill('1');await dialog.getByRole('button',{name:'查询资料',exact:true}).click();
  await expect(dialog.getByText(/已选 0 \/ 2 集 · 高置信 2 · 待核对 0/)).toBeVisible();
  await expect(dialog.getByRole('heading',{name:/待核对/})).toHaveCount(0);
  await dialog.getByRole('button',{name:'加入全部高置信（2）',exact:true}).click();
  await expect(dialog.getByText(/已选 2 \/ 2 集/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('episode-metadata-batch.png')});
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'确认对应并重新整理'}).click();
  await expect(dialog).toHaveCount(0);
  expect(f.writes[1].body).toMatchObject({choices:[
    {materialKey:'material-1',localScope:f.members[0].localScope,evidenceDigest:f.evidences[0].evidenceDigest},
    {materialKey:'material-2',localScope:f.members[1].localScope,evidenceDigest:f.evidences[1].evidenceDigest},
  ]});
});

test('an uncertain confirmation replays the same selection and key',async({page},testInfo)=>{
  const f=await fixture(page,'uncertain'),dialog=await selectUncertain(page);await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'确认对应并重新整理'}).click();await expect(dialog.getByRole('alert')).toContainText('确认结果尚未收到');
  await expect(dialog.getByRole('button',{name:'移除 S02E09 的对应'})).toBeDisabled();await page.screenshot({path:testInfo.outputPath('episode-metadata-uncertain.png')});
  await dialog.getByRole('button',{name:'重试本次确认'}).click();await expect(dialog).toHaveCount(0);
  expect(f.writes[2].body).toEqual(f.writes[1].body);
});

test('a stale selection cannot be resubmitted and Escape restores focus',async({page},testInfo)=>{
  const f=await fixture(page,'stale'),dialog=await selectUncertain(page);await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'确认对应并重新整理'}).click();await expect(dialog.getByRole('alert')).toContainText('依据已变化');
  await expect(dialog.getByRole('button',{name:'重试本次确认'})).toBeDisabled();await page.screenshot({path:testInfo.outputPath('episode-metadata-stale.png')});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'确认季集资料',exact:true})).toBeFocused();
  expect(f.writes).toHaveLength(2);
});

for(const action of ['query','confirm'])test(`pending ${action} keeps keyboard focus inside the dialog`,async({page})=>{
  await fixture(page);
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const endpoint=action==='query'?'review-episode-metadata':'confirm-episode-metadata';
  await page.route(`**/actions/${endpoint}`,async route=>{await pending;await route.fallback();});
  try{
    let dialog;
    if(action==='query'){
      await page.goto('/formation');await page.getByRole('button',{name:'确认季集资料',exact:true}).click();
      dialog=page.getByRole('dialog',{name:'确认季集资料'});
      await dialog.getByRole('button',{name:'查询资料',exact:true}).click();
    }else{
      dialog=await selectUncertain(page);await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button',{name:'确认对应并重新整理'}).click();
    }
    await expect(dialog).toHaveAttribute('aria-busy','true');await expect(dialog).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  }finally{release();}
});
