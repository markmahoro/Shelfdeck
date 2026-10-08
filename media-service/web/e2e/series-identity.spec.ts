import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Series manual identity preserves the frozen Season from Formation',async({page},testInfo)=>{
  const writes:unknown[]=[];
  const movie={tmdbSeriesId:'639445',seasonNumber:2,displayTitle:'示例剧集',originalTitle:'示例剧集',releaseYear:2020,posterUrl:null};
  const item={formationViewId:'subject',subjectId:'subject',displayIdentity:'示例剧集 (2019)',contentProfile:'series',structureKind:'season',status:'active',classification:'attention_required',myRating:4,myRatingSource:'douban',myRatingRevision:null,
    productIdentityIssue:{result:'not_found',reasonCode:'provider_no_match',candidateSetDigest:'candidate-set',candidates:[] as Array<{providerKey:string;displayTitle:string;originalTitle:string;releaseYear:number}>},executorIssue:null,
    seriesDelivery:{libraRunId:'run',seasonNumber:2,episodeKeys:['E003','E005'],physicalFileCount:3},primaryMaterialCount:3,addedAtMs:1790546002510,organizingRequirement:'HEVC · 不超过 14 GiB · 补齐 nfo、poster',organizingAction:'核对剧集身份',organizingSteps:[],
    nextAction:{label:'暂未找到匹配的媒体身份',state:'attention_required',progress:null},routingState:'resolved',targetShelfId:'shelf',targetShelfName:'电影',completedAtMs:null,handoffB:null,
    currentRun:{libraRunId:'run',state:'active',stateRevision:2,stateDigest:'digest',priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:null}};
  let fail=false;
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url());const path=url.pathname;
    if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());await route.fulfill({json:{selectionIntentId:'intent',libraRunId:'run',providerKey:'639445',intentRevision:1,replayed:false},status:202});return;}
    if(path.endsWith('/product-identity-preview')){
      await new Promise(done=>setTimeout(done,180));
      await route.fulfill(fail?{status:404,json:{error:{code:'LIBRA_IDENTITY_PREVIEW_NOT_FOUND',message:'Not found',correlationId:'test'}}}:{json:movie});return;
    }
    if(path==='/v1/admin/formation/subject'){await route.fulfill({json:item});return;}
    if(path==='/v1/admin/formation'){await route.fulfill({json:{items:url.searchParams.get('section')==='active'?[item]:[],summary:{totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0},nextCursor:null,projection:{status:'ready',asOfMs:1}}});return;}
    await route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/formation');
  const button=page.getByRole('button',{name:'手动选取剧集身份'});
  await expect(button).toBeVisible();
  await expect(page.getByText('第 2 季 · 本批 2 集（E03、E05）· 3 个文件',{exact:true})).toBeVisible();
  await expect(page.getByLabel('为示例剧集 (2019)选择剧集身份')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'确认',exact:true})).toHaveCount(0);
  expect(await page.getByRole('columnheader').count()).toBe(9);
  const widths=await page.getByRole('columnheader').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
  await button.evaluate(node=>{node.style.display='none';});
  const baseline=await page.getByRole('columnheader').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
  await page.locator('button').filter({hasText:'手动选取剧集身份'}).evaluate(node=>{node.style.display='';});
  expect(widths).toEqual(baseline);
  await page.screenshot({path:testInfo.outputPath('list.png'),fullPage:true});
  const processButton=page.getByRole('button',{name:'查看过程',exact:true});
  await processButton.click();
  const processDialog=page.getByRole('dialog');
  await expect(processDialog.getByText('第 2 季 · 本批 2 集（E03、E05）· 3 个文件',{exact:true})).toBeVisible();
  await expect(processDialog.locator('.formation-process-head p')).toHaveCount(1);
  await expect(processDialog.getByText('当前进展', {exact:true})).toHaveCount(0);
  await expect(processDialog.getByText('整理计划暂不可用', {exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('batch-detail.png')});
  await page.keyboard.press('Escape');await expect(processButton).toBeFocused();
  await button.click();const dialog=page.getByRole('dialog',{name:'手动选取剧集身份'});
  await expect(dialog.getByLabel('TMDB 剧集 ID')).toBeFocused();
  await page.screenshot({path:testInfo.outputPath('empty.png')});
  await dialog.getByLabel('TMDB 剧集 ID').fill('639445');await dialog.getByRole('button',{name:'查询',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'确认选取'})).toBeDisabled();
  await page.screenshot({path:testInfo.outputPath('loading.png')});
  await expect(dialog.getByText('2020 · TMDB 639445')).toBeVisible();
  await expect(dialog.getByText('第 2 季',{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).include('[role="dialog"]').analyze()).violations).toEqual([]);
  const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:testInfo.outputPath('preview.png')});
  await dialog.getByRole('button',{name:'取消'}).click();await expect(button).toBeFocused();expect(writes).toHaveLength(0);
  await button.click();fail=true;await dialog.getByLabel('TMDB 剧集 ID').fill('1');await dialog.getByRole('button',{name:'查询',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('未找到这部剧集');await page.screenshot({path:testInfo.outputPath('error.png')});
  fail=false;await dialog.getByLabel('TMDB 剧集 ID').fill('639445');await dialog.getByLabel('TMDB 剧集 ID').press('Enter');
  await expect(dialog.getByText('2020 · TMDB 639445')).toBeVisible();
  await dialog.getByRole('button',{name:'确认选取'}).click();await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({tmdbSeriesId:'639445',expectedRunStateRevision:2});expect(writes[0]).not.toHaveProperty('seasonNumber');expect(writes[0]).not.toHaveProperty('tmdbMovieId');
  await expect(page.getByRole('status')).toContainText('已提交剧集身份');
  item.productIdentityIssue.candidates.push({providerKey:'tmdb:series:639445',displayTitle:'示例剧集',originalTitle:'示例剧集',releaseYear:2020});
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.getByLabel('为示例剧集 (2019)选择剧集身份')).toBeVisible();
  await expect(page.getByRole('button',{name:'确认',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('with-candidates.png'),fullPage:true});
});
