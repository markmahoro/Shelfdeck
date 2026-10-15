import { expect, test } from '@playwright/test';

test('missing routing policy opens the exact source configuration and clears after publication',async({page},testInfo)=>{
  let published=false;
  const field={fieldId:'series-source',name:'剧集来源',status:'active',currentProfileHintSnapshot:{contentProfileHint:'series'},
    access:{rootLocation:'/media/Series'},policy:{policy:{}},procurementStatus:{stage:'handoff_a_accepted',generatedPackageCount:1,
      acceptedPackageCount:1,waitingAcceptanceCount:0,rejectedPackageCount:0}};
  const shelf={shelfId:'series-shelf',name:'剧集',status:'active'};
  const base={formationViewId:'subject',subjectId:'subject',displayIdentity:'测试剧集 第二季',contentProfile:'series',structureKind:'season',
    status:'active',myRating:null,myRatingSource:'douban',targetShelfId:null,targetShelfName:null,currentRun:null,handoffB:null,
    routingDecisionHeadRevision:null,routingDecisionHeadDigest:null,organizingRequirement:'正在确认整理要求',organizingSteps:[],addedAtMs:1};
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/v1/admin/formation') {
      const ended=url.searchParams.get('section')==='ended'||url.searchParams.get('section')==='completed';
      return route.fulfill({json:{items:ended?[]:[{...base,classification:published?'in_progress':'attention_required',
        routingState:published?'preparing':'unresolved',unresolvedReasonCode:published?null:'routing_policy_unavailable',
        routingConfigurationFieldId:published?null:field.fieldId,
        nextAction:{label:published?'正在确认整理要求':'尚未配置收藏去向',state:published?'pending':'attention_required',progress:null}}],
        summary:{totalCount:1,inProgressCount:published?1:0,attentionRequiredCount:published?0:1,completedCount:0},nextCursor:null}});
    }
    if(path==='/v1/admin/material-fields')return route.fulfill({json:{items:[field]}});
    if(path==='/v1/admin/shelves')return route.fulfill({json:{items:[shelf]}});
    if(path.endsWith('/intake-admission'))return route.fulfill({json:{predeckPipelineSeats:3,pipelineTokensHeld:1,pipelineSeatsFree:2}});
    if(path==='/v1/admin/routing/material-fields/series-source') {
      if(route.request().method()==='PATCH')published=true;
      return route.fulfill({json:{policy:published?{routingPolicyId:'policy',revision:1,mode:'direct',targets:[{shelfId:shelf.shelfId}]}:null}});
    }
    return route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/formation');
  await expect(page.getByText('尚未配置收藏去向')).toBeVisible();
  await expect(page.getByRole('button',{name:'需要处理 1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'配置收藏去向',exact:true}).click();
  await expect(page).toHaveURL(/configureRouting=series-source/);
  await expect(page.getByRole('combobox',{name:'目标收藏架',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('routing-configuration.png'),fullPage:true});
  await page.getByRole('button',{name:'发布策略',exact:true}).click();
  await expect(page.getByText('分拣策略已发布',{exact:true})).toBeVisible();
  await page.goto('/formation');
  await expect(page.getByRole('button',{name:'需要处理 0',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'配置收藏去向',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('routing-ready.png'),fullPage:true});
});
