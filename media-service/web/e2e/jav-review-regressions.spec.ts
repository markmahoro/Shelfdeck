import {expect,test} from '@playwright/test';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
const require=createRequire(import.meta.url),owner=require('../../src/helix/domains/arca/model/rule-template-contracts');
for(const scenario of ['cover-failed','expired-preview'] as const)test(`JAV identity review regression: ${scenario}`,async({page},testInfo)=>{
  const writes:Record<string,unknown>[]=[],cover=await sharp({create:{width:300,height:180,channels:3,background:'#376892'}}).jpeg().toBuffer();let lookups=0;
  const item={formationViewId:'jav-subject',subjectId:'jav-subject',displayIdentity:'未识别影片',contentProfile:'jav',structureKind:'single',status:'active',classification:'attention_required',myRating:null,
    productIdentityIssue:{contentProfile:'jav',result:'not_found',reasonCode:'jav_code_unrecognized',candidateSetDigest:null,candidates:[],claimedCode:null,sourceLocation:'E:/Material/Unknown.mkv'},executorIssue:null,
    primaryMaterialCount:1,addedAtMs:100,organizingRequirement:'HEVC',organizingAction:'确认番号',organizingSteps:[],nextAction:{label:'需要确认番号',state:'attention_required',progress:null},
    routingState:'resolved',targetShelfId:'shelf',targetShelfName:'JAV',handoffB:null,completedAtMs:null,currentRun:{libraRunId:'run',state:'active',stateRevision:1,stateDigest:'run',currentIdentityRevision:null}};
  if(scenario==='cover-failed')await page.route('**/formation',async route=>{if(route.request().resourceType()!=='document')return route.fallback();
    const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"img-src 'none'"}});});
  await page.route('**/v1/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;
    if(path.endsWith('/product-identity-preview')){lookups++;await route.fulfill({json:{result:'qualified',javCode:'FC2-718323',displayTitle:'核对影片',posterUrl:'data:image/jpeg;base64,'+cover.toString('base64'),
      siteRef:'fc2_official',resourceKey:'resource',previewId:'preview-'+lookups,candidateSetDigest:'candidate',expectedRunStateRevision:1,expectedIdentityRevision:0,expectedSelectionIntentRevision:2}});return;}
    if(path.endsWith('/actions/choose-product-identity')){writes.push(route.request().postDataJSON());await route.fulfill(writes.length===1?
      {status:409,json:{error:{code:'LIBRA_JAV_PREVIEW_EXPIRED',message:'private'}}}:{status:202,json:{selectionIntentId:'accepted',intentRevision:3,replayed:false}});return;}
    if(path==='/v1/admin/formation'){await route.fulfill({json:{items:url.searchParams.get('section')==='active'?[item]:[],summary:{totalCount:1,inProgressCount:0,attentionRequiredCount:1,completedCount:0},nextCursor:null,projection:{status:'ready',asOfMs:1}}});return;}
    await route.fulfill({json:{items:[],counts:{},nextCursor:null}});
  });
  await page.goto('/formation');await page.getByRole('button',{name:'确认番号',exact:true}).click();const dialog=page.getByRole('dialog',{name:'确认番号',exact:true});
  await dialog.getByLabel('番号',{exact:true}).fill('FC2-718323');await dialog.getByRole('button',{name:'查询',exact:true}).click();await expect(dialog.getByText('来源 · FC2 官方')).toBeVisible();
  const confirm=dialog.getByRole('button',{name:'确认影片并继续整理'});
  if(scenario==='cover-failed'){await expect(dialog.getByText('封面显示失败')).toBeVisible();await expect(confirm).toBeDisabled();expect(writes).toHaveLength(0);}
  else{
    await confirm.click();await expect(dialog.getByRole('alert')).toHaveText('预览已过期，请重新查询。');await expect(confirm).toBeDisabled();await expect(dialog.getByLabel('影片预览')).toHaveCount(0);
    await dialog.getByRole('button',{name:'查询',exact:true}).click();await expect(confirm).toBeEnabled();await confirm.click();await expect(dialog).toHaveCount(0);
    expect(writes).toHaveLength(2);expect(writes[0].previewId).toBe('preview-1');expect(writes[1].previewId).toBe('preview-2');expect(writes[0].idempotencyKey).not.toBe(writes[1].idempotencyKey);
  }
  await page.screenshot({path:testInfo.outputPath('jav-'+scenario+'.png'),fullPage:true});
});
test('JAV recommended standard has a real summary, naming preview and static copy editor',async({page},testInfo)=>{
  const template={templateId:owner.JAV_TEMPLATE_ID,name:owner.JAV_TEMPLATE_NAME,ownerKind:'system',status:'active',currentRevision:1,
    current:{revision:1,rulesDigest:owner.JAV_RECOMMENDED_RULES_DIGEST,rules:owner.JAV_RECOMMENDED_RULES}};
  await page.route('**/v1/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill({json:path==='/v1/admin/rule-templates'?{items:[template]}:{items:[],authorization:null,counts:{},nextCursor:null}});});
  await page.goto('/shelves');await expect(page.getByRole('heading',{name:'创建收藏架',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'规则模板',exact:true}).selectOption(owner.JAV_TEMPLATE_ID);
  const summary=page.getByRole('region',{name:'JAV整理标准'});await expect(summary.getByText('HEVC · Matroska (.mkv)')).toBeVisible();await expect(summary.getByText('最多 2 GiB')).toBeVisible();
  await expect(summary.getByText('必需资料：标题')).toBeVisible();await expect(summary.getByText('背景图、NFO、海报')).toBeVisible();
  const naming=page.getByLabel('最终命名保存前预览');await expect(naming).toContainText('示例 JAV 影片');await expect(naming).toContainText('.mkv');await expect(naming).not.toContainText('S01E01');
  await page.getByRole('button',{name:'复制模板',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'媒体类型',exact:true})).toHaveValue('jav');
  await expect(dialog.getByRole('checkbox',{name:'HEVC',exact:true})).toBeChecked();await expect(dialog.getByLabel('每部空间上限 GiB')).toHaveValue('2');await expect(dialog.getByText('未评分',{exact:true})).toHaveCount(0);
  expect((await new AxeBuilder({page}).include('.shelf-standard-dialog').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('jav-standard-editor.png'),fullPage:true});
});
